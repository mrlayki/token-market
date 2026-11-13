"""上游适配：同协议直通（httpx），跨协议经 LiteLLM SDK 转换。

  请求协议 \\ 渠道      OpenAI 兼容(openai/deepseek/dashscope/...)    Anthropic                 其他(gemini...)
  /v1/chat/completions   OpenAIPassthrough                            LiteLLMChat               LiteLLMChat
  /v1/messages           LiteLLMMessages                              AnthropicPassthrough      LiteLLMMessages
  /v1/embeddings         OpenAIPassthrough                            -                         LiteLLM(不支持)

所有适配器都必须在返回 StreamSession 之前确认上游已成功响应（状态码 200），
这样失败可以在向客户端写出任何字节之前切换渠道重试。
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx
import orjson

from app.billing.pricing import Usage
from app.core.config import settings
from app.relay.catalog import ChannelKeyRT, ChannelRT
from app.relay.sse import SSEParser, encode

OPENAI_COMPAT = {"openai", "deepseek", "dashscope"}

_client: httpx.AsyncClient | None = None


def http_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.relay_timeout_seconds, connect=settings.relay_connect_timeout_seconds),
            limits=httpx.Limits(max_connections=2000, max_keepalive_connections=200, keepalive_expiry=60),
            follow_redirects=False,
        )
    return _client


async def close_http_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


class UpstreamError(Exception):
    def __init__(self, status: int, message: str, *, body: str | None = None, connect: bool = False):
        super().__init__(message)
        self.status = status
        self.message = message
        self.body = body
        self.connect = connect  # 连接/超时类错误


@dataclass(slots=True)
class UpstreamCall:
    channel: ChannelRT
    key: ChannelKeyRT
    endpoint: str  # chat / messages / embeddings
    body: dict
    model: str  # 对外模型名
    upstream_model: str
    stream: bool
    client_headers: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class NonStreamResult:
    body: dict
    usage: Usage | None


class StreamSession:
    """包装上游流：产出发给客户端的 SSE 字节，同时累计 usage 与输出文本。"""

    def __init__(self) -> None:
        self.usage: Usage | None = None
        self.output_parts: list[str] = []
        self.first_token_at: float | None = None
        self.finished = False  # 是否收到上游正常结束标志

    def mark_token(self) -> None:
        if self.first_token_at is None:
            self.first_token_at = time.monotonic()

    def output_text(self) -> str:
        return "".join(self.output_parts)

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self.iterate()

    async def iterate(self) -> AsyncIterator[bytes]:  # pragma: no cover - 子类实现
        raise NotImplementedError
        yield b""

    async def aclose(self) -> None:  # pragma: no cover
        pass


# ---------------------------------------------------------------- 工具
def _merge_override(body: dict, override: dict) -> dict:
    if not override:
        return body
    out = dict(body)
    out.update(override)
    return out


def _openai_usage(u: dict | None) -> Usage | None:
    if not u:
        return None
    details = u.get("prompt_tokens_details") or {}
    cache_read = details.get("cached_tokens") or u.get("prompt_cache_hit_tokens") or 0
    return Usage(
        prompt_tokens=int(u.get("prompt_tokens") or 0),
        completion_tokens=int(u.get("completion_tokens") or 0),
        cache_read_tokens=int(cache_read or 0),
        cache_write_tokens=int(u.get("cache_creation_input_tokens") or 0),
    )


def _anthropic_usage(u: dict | None) -> Usage | None:
    if not u:
        return None
    cr = int(u.get("cache_read_input_tokens") or 0)
    cw = int(u.get("cache_creation_input_tokens") or 0)
    inp = int(u.get("input_tokens") or 0)
    return Usage(prompt_tokens=inp + cr + cw, completion_tokens=int(u.get("output_tokens") or 0),
                 cache_read_tokens=cr, cache_write_tokens=cw)


async def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code == 200:
        return
    raw = (await resp.aread()).decode("utf-8", errors="replace")[:4000]
    await resp.aclose()
    msg = raw
    try:
        j = orjson.loads(raw)
        err = j.get("error") if isinstance(j, dict) else None
        if isinstance(err, dict):
            msg = err.get("message") or raw
        elif isinstance(err, str):
            msg = err
        elif isinstance(j, dict) and j.get("message"):
            msg = j["message"]
    except Exception:  # noqa: BLE001
        pass
    raise UpstreamError(resp.status_code, msg, body=raw)


async def _send(req: httpx.Request) -> httpx.Response:
    try:
        return await http_client().send(req, stream=True)
    except httpx.TimeoutException as e:
        raise UpstreamError(504, f"上游超时: {type(e).__name__}", connect=True) from e
    except httpx.HTTPError as e:
        raise UpstreamError(502, f"上游连接失败: {type(e).__name__}: {e}", connect=True) from e


# ---------------------------------------------------------------- OpenAI 直通
class OpenAIStream(StreamSession):
    def __init__(self, resp: httpx.Response, model: str, want_usage: bool):
        super().__init__()
        self.resp = resp
        self.model = model
        self.want_usage = want_usage

    async def iterate(self) -> AsyncIterator[bytes]:
        parser = SSEParser()
        try:
            async for chunk in self.resp.aiter_bytes():
                for ev in parser.feed(chunk):
                    out = self._handle(ev.data)
                    if out:
                        yield out
            for ev in parser.flush():
                out = self._handle(ev.data)
                if out:
                    yield out
        except httpx.HTTPError as e:
            raise UpstreamError(502, f"上游流中断: {type(e).__name__}", connect=True) from e

    def _handle(self, data: str) -> bytes | None:
        if data.strip() == "[DONE]":
            self.finished = True
            return b"data: [DONE]\n\n"
        try:
            j = orjson.loads(data)
        except Exception:  # noqa: BLE001
            return encode(data)
        if j.get("usage"):
            self.usage = _openai_usage(j["usage"])
        choices = j.get("choices") or []
        for c in choices:
            d = c.get("delta") or {}
            for k in ("content", "reasoning_content"):
                if d.get(k):
                    self.mark_token()
                    self.output_parts.append(d[k])
            for tc in d.get("tool_calls") or []:
                fn = tc.get("function") or {}
                if fn.get("arguments") or fn.get("name"):
                    self.mark_token()
                    self.output_parts.append((fn.get("name") or "") + (fn.get("arguments") or ""))
            if c.get("finish_reason"):
                self.finished = True
        if not choices and j.get("usage") and not self.want_usage:
            return None  # 客户端未要求 usage，吞掉仅含 usage 的末包
        if not self.want_usage and "usage" in j and choices:
            j.pop("usage", None)
        if "model" in j:
            j["model"] = self.model
        return b"data: " + orjson.dumps(j) + b"\n\n"

    async def aclose(self) -> None:
        await self.resp.aclose()


async def openai_passthrough(call: UpstreamCall) -> NonStreamResult | StreamSession:
    ch = call.channel
    path = {"chat": "/chat/completions", "embeddings": "/embeddings"}[call.endpoint]
    body = _merge_override(dict(call.body), ch.param_override)
    body["model"] = call.upstream_model
    want_usage = False
    if call.stream:
        so = dict(body.get("stream_options") or {})
        want_usage = bool(so.get("include_usage"))
        so["include_usage"] = True
        body["stream_options"] = so
    headers = {"Authorization": f"Bearer {call.key.key}", "Content-Type": "application/json",
               **ch.header_override}
    req = http_client().build_request("POST", ch.base_url + path, content=orjson.dumps(body), headers=headers)
    resp = await _send(req)
    await _raise_for_status(resp)
    if call.stream:
        return OpenAIStream(resp, call.model, want_usage)
    try:
        data = orjson.loads(await resp.aread())
    finally:
        await resp.aclose()
    usage = _openai_usage(data.get("usage"))
    if "model" in data:
        data["model"] = call.model
    return NonStreamResult(body=data, usage=usage)


# ---------------------------------------------------------------- Anthropic 直通
class AnthropicStream(StreamSession):
    def __init__(self, resp: httpx.Response, model: str):
        super().__init__()
        self.resp = resp
        self.model = model
        self._u: dict[str, int] = {}

    async def iterate(self) -> AsyncIterator[bytes]:
        parser = SSEParser()
        try:
            async for chunk in self.resp.aiter_bytes():
                for ev in parser.feed(chunk):
                    yield self._handle(ev.event, ev.data, ev.raw)
            for ev in parser.flush():
                yield self._handle(ev.event, ev.data, ev.raw)
        except httpx.HTTPError as e:
            raise UpstreamError(502, f"上游流中断: {type(e).__name__}", connect=True) from e

    def _handle(self, event: str | None, data: str, raw: bytes) -> bytes:
        try:
            j = orjson.loads(data)
        except Exception:  # noqa: BLE001
            return raw
        t = j.get("type")
        if t == "message_start":
            msg = j.get("message") or {}
            self._u.update({k: v for k, v in (msg.get("usage") or {}).items() if isinstance(v, int)})
            msg["model"] = self.model
            raw = encode(orjson.dumps(j).decode(), event)
        elif t == "content_block_delta":
            d = j.get("delta") or {}
            txt = d.get("text") or d.get("thinking") or d.get("partial_json")
            if txt:
                self.mark_token()
                self.output_parts.append(txt)
        elif t == "message_delta":
            self._u.update({k: v for k, v in (j.get("usage") or {}).items() if isinstance(v, int)})
        elif t == "message_stop":
            self.finished = True
        if self._u:
            self.usage = _anthropic_usage(self._u)
        return raw

    async def aclose(self) -> None:
        await self.resp.aclose()


async def anthropic_passthrough(call: UpstreamCall) -> NonStreamResult | StreamSession:
    ch = call.channel
    body = _merge_override(dict(call.body), ch.param_override)
    body["model"] = call.upstream_model
    headers = {
        "x-api-key": call.key.key,
        "anthropic-version": call.client_headers.get("anthropic-version") or "2023-06-01",
        "content-type": "application/json",
        **ch.header_override,
    }
    if call.client_headers.get("anthropic-beta"):
        headers["anthropic-beta"] = call.client_headers["anthropic-beta"]
    base = ch.base_url[:-3] if ch.base_url.endswith("/v1") else ch.base_url
    req = http_client().build_request("POST", base + "/v1/messages", content=orjson.dumps(body), headers=headers)
    resp = await _send(req)
    await _raise_for_status(resp)
    if call.stream:
        return AnthropicStream(resp, call.model)
    try:
        data = orjson.loads(await resp.aread())
    finally:
        await resp.aclose()
    data["model"] = call.model
    return NonStreamResult(body=data, usage=_anthropic_usage(data.get("usage")))


# ---------------------------------------------------------------- LiteLLM 转换
def _litellm_error(e: Exception) -> UpstreamError:
    status = getattr(e, "status_code", None) or 502
    msg = getattr(e, "message", None) or str(e)
    connect = type(e).__name__ in ("APIConnectionError", "Timeout", "InternalServerError")
    return UpstreamError(int(status), msg[:2000], connect=connect)


def _litellm_target(call: UpstreamCall) -> tuple[str, dict[str, Any]]:
    from app.models.channel import CHANNEL_TYPES

    ch = call.channel
    default_base = CHANNEL_TYPES.get(ch.type, {}).get("base_url", "")
    kw: dict[str, Any] = {"api_key": call.key.key, "max_retries": 0, "timeout": settings.relay_timeout_seconds}
    if ch.base_url and ch.base_url.rstrip("/") != default_base.rstrip("/"):
        kw["api_base"] = ch.base_url
    if ch.header_override:
        kw["extra_headers"] = dict(ch.header_override)
    return f"{ch.provider}/{call.upstream_model}", kw


class LiteLLMChatStream(StreamSession):
    def __init__(self, it: Any, model: str, want_usage: bool):
        super().__init__()
        self.it = it
        self.model = model
        self.want_usage = want_usage

    async def iterate(self) -> AsyncIterator[bytes]:
        try:
            async for chunk in self.it:
                j = chunk.model_dump(exclude_none=True) if hasattr(chunk, "model_dump") else dict(chunk)
                if j.get("usage"):
                    self.usage = _openai_usage(j["usage"])
                choices = j.get("choices") or []
                for c in choices:
                    d = c.get("delta") or {}
                    for k in ("content", "reasoning_content"):
                        if d.get(k):
                            self.mark_token()
                            self.output_parts.append(d[k])
                    for tc in d.get("tool_calls") or []:
                        fn = tc.get("function") or {}
                        if fn.get("arguments"):
                            self.mark_token()
                            self.output_parts.append(fn["arguments"])
                    if c.get("finish_reason"):
                        self.finished = True
                if not choices and not self.want_usage:
                    continue
                if not self.want_usage:
                    j.pop("usage", None)
                j["model"] = self.model
                yield b"data: " + orjson.dumps(j) + b"\n\n"
            self.finished = True
            yield b"data: [DONE]\n\n"
        except UpstreamError:
            raise
        except Exception as e:  # noqa: BLE001
            raise _litellm_error(e) from e

    async def aclose(self) -> None:
        close = getattr(self.it, "aclose", None)
        if close:
            try:
                await close()
            except Exception:  # noqa: BLE001
                pass


async def litellm_chat(call: UpstreamCall) -> NonStreamResult | StreamSession:
    import litellm

    model, kw = _litellm_target(call)
    body = _merge_override(dict(call.body), call.channel.param_override)
    body.pop("model", None)
    want_usage = bool((body.get("stream_options") or {}).get("include_usage"))
    if call.stream:
        body["stream_options"] = {"include_usage": True}
    try:
        resp = await litellm.acompletion(model=model, **body, **kw)
    except Exception as e:  # noqa: BLE001
        raise _litellm_error(e) from e
    if call.stream:
        return LiteLLMChatStream(resp, call.model, want_usage)
    data = resp.model_dump(exclude_none=True)
    data["model"] = call.model
    return NonStreamResult(body=data, usage=_openai_usage(data.get("usage")))


class LiteLLMMessagesStream(StreamSession):
    """LiteLLM Anthropic 统一接口的流：元素可能是 SSE bytes 或事件 dict，统一转为 Anthropic SSE。"""

    def __init__(self, it: Any, model: str):
        super().__init__()
        self.it = it
        self.inner = AnthropicStream.__new__(AnthropicStream)
        StreamSession.__init__(self.inner)
        self.inner.model = model
        self.inner._u = {}

    async def iterate(self) -> AsyncIterator[bytes]:
        parser = SSEParser()
        try:
            async for item in self.it:
                if isinstance(item, bytes | bytearray | str):
                    data = item.encode() if isinstance(item, str) else bytes(item)
                    for ev in parser.feed(data):
                        yield self.inner._handle(ev.event, ev.data, ev.raw)
                else:
                    j = item if isinstance(item, dict) else (item.model_dump() if hasattr(item, "model_dump") else dict(item))
                    s = orjson.dumps(j).decode()
                    yield self.inner._handle(j.get("type"), s, encode(s, j.get("type")))
                self._sync()
            for ev in parser.flush():
                yield self.inner._handle(ev.event, ev.data, ev.raw)
            self._sync()
        except UpstreamError:
            raise
        except Exception as e:  # noqa: BLE001
            raise _litellm_error(e) from e

    def _sync(self) -> None:
        self.usage = self.inner.usage
        self.output_parts = self.inner.output_parts
        self.first_token_at = self.inner.first_token_at
        self.finished = self.inner.finished

    async def aclose(self) -> None:
        close = getattr(self.it, "aclose", None)
        if close:
            try:
                await close()
            except Exception:  # noqa: BLE001
                pass


async def litellm_messages(call: UpstreamCall) -> NonStreamResult | StreamSession:
    from litellm.anthropic_interface import messages as anth

    model, kw = _litellm_target(call)
    body = _merge_override(dict(call.body), call.channel.param_override)
    body.pop("model", None)
    body["stream"] = call.stream
    try:
        resp = await anth.acreate(model=model, **body, **kw)
    except Exception as e:  # noqa: BLE001
        raise _litellm_error(e) from e
    if call.stream:
        return LiteLLMMessagesStream(resp, call.model)
    data = resp if isinstance(resp, dict) else resp.model_dump()
    data["model"] = call.model
    return NonStreamResult(body=data, usage=_anthropic_usage(data.get("usage")))


async def dispatch(call: UpstreamCall) -> NonStreamResult | StreamSession:
    provider = call.channel.provider
    if call.endpoint == "embeddings":
        if provider not in OPENAI_COMPAT:
            raise UpstreamError(400, "该渠道不支持 embeddings")
        return await openai_passthrough(call)
    if call.endpoint == "chat":
        if provider in OPENAI_COMPAT:
            return await openai_passthrough(call)
        return await litellm_chat(call)
    if call.endpoint == "messages":
        if provider == "anthropic":
            return await anthropic_passthrough(call)
        return await litellm_messages(call)
    raise UpstreamError(400, f"unsupported endpoint {call.endpoint}")
