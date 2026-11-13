"""中转主链路。

  鉴权 → 限流 → 模型/价格快照 → 预估用量 → 额度预扣(Lua) → 选渠道 → 调上游(失败换渠道重试)
  → 计量(上游 usage 优先，缺失则估算) → 结算(Lua，与计量事件原子写入 Stream) → worker 异步落库
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

import anyio
import orjson
from fastapi import Request
from fastapi.responses import Response, StreamingResponse
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from app.billing.pricing import PackageRule, PriceSnapshot, Usage, match_time_rules
from app.channels import health
from app.core import runtime_settings as rs
from app.core.config import settings
from app.core.errors import InsufficientQuota, RelayError
from app.core.redis import redis
from app.models.logs import CALL_CLIENT_ABORT, CALL_FAILED, CALL_SUCCESS
from app.quota import fallback_pg
from app.quota.engine import USAGE_STREAM, QuotaError, Reservation
from app.quota.service import get_engine
from app.relay import tokenizer
from app.relay.auth import Identity, authenticate, client_ip
from app.relay.catalog import ChannelKeyRT, ChannelRT, catalog_cache, channel_cache
from app.relay.selector import cooldown, select_channel
from app.relay.upstream import NonStreamResult, StreamSession, UpstreamCall, UpstreamError, dispatch

log = logging.getLogger("relay")
REDIS_DOWN = (RedisConnectionError, RedisTimeoutError, ConnectionError, OSError)


@dataclass
class RelayContext:
    rid: str
    endpoint: str  # chat / messages / embeddings
    ident: Identity
    model: str
    vendor: str | None
    price: PriceSnapshot
    body: dict
    stream: bool
    ip: str
    client_headers: dict[str, str]
    est: Usage
    started: float = field(default_factory=time.monotonic)
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    packages: list[PackageRule] = field(default_factory=list)
    reservation: Reservation | None = None
    pg_reserved: int = 0  # Redis 故障降级时在 PG 冻结的金额
    channel: ChannelRT | None = None
    key: ChannelKeyRT | None = None
    upstream_model: str = ""
    retry_count: int = 0
    pg_mode: bool = False  # Redis 故障，额度走 PG 降级


# ---------------------------------------------------------------- 错误输出
def error_response(ctx_endpoint: str, err: RelayError, rid: str | None = None) -> Response:
    body = err.to_anthropic() if ctx_endpoint == "messages" else err.to_openai()
    headers = {"x-request-id": rid} if rid else None
    return Response(orjson.dumps(body), status_code=err.status, media_type="application/json", headers=headers)


# ---------------------------------------------------------------- 预估
def _requested_max_tokens(body: dict, endpoint: str) -> int | None:
    for k in ("max_completion_tokens", "max_tokens", "max_output_tokens"):
        v = body.get(k)
        if isinstance(v, int) and v > 0:
            return v
    return None


async def _estimate(endpoint: str, body: dict, model_max_out: int) -> Usage:
    if endpoint == "embeddings":
        return Usage(prompt_tokens=tokenizer.count_embedding_input(body))
    cfg = await rs.get_all()
    prompt = (tokenizer.count_anthropic_messages(body) if endpoint == "messages"
              else tokenizer.count_openai_messages(body))
    out = _requested_max_tokens(body, endpoint) or cfg["billing.default_max_tokens"]
    cap = cfg["billing.max_est_output_tokens"]
    if model_max_out:
        cap = min(cap, model_max_out)
    return Usage(prompt_tokens=prompt, completion_tokens=min(out, cap))


# ---------------------------------------------------------------- 限流
async def _rate_limit(ident: Identity) -> None:
    cfg = await rs.get_all()
    minute = int(time.time() // 60)
    checks = []
    if ident.rpm_limit > 0:
        checks.append((f"tm:rl:t:{ident.token_id}:{minute}", ident.rpm_limit, "API Key"))
    if cfg["ratelimit.user_rpm"] > 0:
        checks.append((f"tm:rl:u:{ident.user_id}:{minute}", cfg["ratelimit.user_rpm"], "账户"))
    if cfg["ratelimit.global_rpm"] > 0:
        checks.append((f"tm:rl:g:{minute}", cfg["ratelimit.global_rpm"], "全站"))
    if not checks:
        return
    try:
        pipe = redis.pipeline(transaction=False)
        for k, _, _ in checks:
            pipe.incr(k)
            pipe.expire(k, 120)
        res = await pipe.execute()
    except REDIS_DOWN:
        return  # 限流不可用时放行，额度控制仍由 PG 降级兜底
    for i, (_, limit, name) in enumerate(checks):
        if res[i * 2] > limit:
            raise RelayError(f"{name}请求频率超过限制（{limit} 次/分钟）", status=429,
                             type_="rate_limit_error", code="rate_limit_exceeded")


# ---------------------------------------------------------------- 入口
async def prepare(request: Request, endpoint: str) -> RelayContext:
    rid = "req_" + uuid.uuid4().hex
    try:
        body = orjson.loads(await request.body())
        if not isinstance(body, dict):
            raise ValueError
    except Exception as e:  # noqa: BLE001
        raise RelayError("请求体不是合法的 JSON 对象") from e
    ident = await authenticate(request)
    model = body.get("model")
    if not isinstance(model, str) or not model:
        raise RelayError("缺少 model 参数", code="model_required")
    if ident.model_limits and model not in ident.model_limits:
        raise RelayError(f"该 API Key 无权调用模型 {model}", status=403, type_="permission_error",
                         code="model_not_allowed")
    cat = await catalog_cache.get()
    info = cat.models.get(model)
    if info is None or not info.listed:
        raise RelayError(f"模型 {model} 不存在或未上架", status=404, code="model_not_found")
    price = cat.price_for(model, ident.group, datetime.now(UTC))
    if price is None:
        raise RelayError(f"模型 {model} 暂未定价，暂不可用", status=503, type_="api_error", code="model_not_priced")
    await _rate_limit(ident)
    est = await _estimate(endpoint, body, info.max_output_tokens)
    headers = {k: v for k, v in request.headers.items() if k in ("anthropic-version", "anthropic-beta")}
    return RelayContext(rid=rid, endpoint=endpoint, ident=ident, model=model, vendor=info.vendor, price=price,
                        body=body, stream=bool(body.get("stream")) and endpoint != "embeddings",
                        ip=client_ip(request), client_headers=headers, est=est)


async def reserve(ctx: RelayContext) -> None:
    if ctx.price.is_free:
        return
    engine = get_engine()
    try:
        ctx.packages = await engine.candidate_packages(ctx.ident.user_id, ctx.model, ctx.vendor)
        ctx.reservation = await engine.reserve(
            rid=ctx.rid, uid=ctx.ident.user_id, token_id=ctx.ident.token_id,
            token_limited=not ctx.ident.unlimited, packages=ctx.packages, est=ctx.est, price=ctx.price,
            ctx={"uid": ctx.ident.user_id, "model": ctx.model, "endpoint": ctx.endpoint,
                 "token_name": ctx.ident.token_name, "group": ctx.ident.group, "stream": ctx.stream,
                 "price": ctx.price.to_dict(), "ip": ctx.ip},
        )
    except QuotaError as e:
        if e.code == "token_quota_exceeded":
            raise RelayError("API Key 额度已用尽", status=402, type_="insufficient_quota",
                             code="token_quota_exceeded") from e
        raise InsufficientQuota() from e
    except REDIS_DOWN as e:
        if settings.redis_fail_mode == "fail_closed":
            raise RelayError("计费服务暂不可用，请稍后重试", status=503, type_="api_error") from e
        log.error("redis unavailable, degrade to PG reservation rid=%s", ctx.rid)
        ctx.pg_mode = True
        amount = ctx.price.cost(ctx.est)
        if not await fallback_pg.reserve(ctx.ident.user_id, amount):
            raise InsufficientQuota() from e
        ctx.pg_reserved = amount


# ---------------------------------------------------------------- 结算
def _final_usage(ctx: RelayContext, upstream: Usage | None, output_text: str) -> Usage:
    if upstream and (upstream.prompt_tokens or upstream.completion_tokens):
        return upstream
    # 上游未返回 usage：输入沿用预估，输出按实际文本计数，标记为估算
    return Usage(prompt_tokens=ctx.est.prompt_tokens, completion_tokens=tokenizer.count_text(output_text),
                 estimated=True)


def _event(ctx: RelayContext, *, status: str, http_status: int, usage: Usage, error: str = "",
           first_token_ms: int = 0) -> dict:
    ch = ctx.channel
    sale = ctx.price.cost(usage)
    cost = 0
    if ch is not None:
        hit = match_time_rules(ch.cost_time_rules, ctx.started_at)
        cost = ctx.price.channel_cost(usage, ch.cost_ratio, hit[0] if hit else None)
    return {
        "rid": ctx.rid, "ts": time.time(), "uid": ctx.ident.user_id, "token_id": ctx.ident.token_id,
        "token_name": ctx.ident.token_name, "channel_id": ch.id if ch else None,
        "key_id": ctx.key.id if ctx.key else None, "model": ctx.model, "upstream_model": ctx.upstream_model,
        "group": ctx.ident.group, "endpoint": ctx.endpoint, "stream": ctx.stream, "status": status,
        "http_status": http_status, "error": error[:2000], "usage": usage.to_dict(), "amount": sale,
        "cost": cost, "price": ctx.price.to_dict(), "retry": ctx.retry_count, "ftm": first_token_ms,
        "dur": int((time.monotonic() - ctx.started) * 1000), "ip": ctx.ip,
    }


async def settle(ctx: RelayContext, usage: Usage, *, status: str, http_status: int, error: str = "",
                 first_token_ms: int = 0) -> None:
    """结算。必须在任何退出路径上恰好调用一次；内部吞掉异常，由超时回收任务兜底。"""
    ev = _event(ctx, status=status, http_status=http_status, usage=usage, error=error,
                first_token_ms=first_token_ms)
    charge = usage
    try:
        if ctx.pg_mode:
            await fallback_pg.settle(ctx.ident.user_id, ctx.pg_reserved, ctx.price.cost(charge), ev)
            return
        if ctx.reservation is None:
            # 免费模型：无预扣，直接写计量事件
            ev["settle"] = {"ok": 1, "wallet": 0, "pkgs": [], "shortfall": 0}
            await redis.xadd(USAGE_STREAM, {"d": orjson.dumps(ev)}, maxlen=1_000_000, approximate=True)
            return
        overdraft = await rs.get("billing.overdraft_limit")
        res = await get_engine().settle(rid=ctx.rid, uid=ctx.ident.user_id, token_id=ctx.ident.token_id,
                                        packages=ctx.packages, actual=charge, price=ctx.price,
                                        overdraft=overdraft, event=ev)
        if res.shortfall:
            log.warning("settle shortfall rid=%s uid=%s shortfall=%s", ctx.rid, ctx.ident.user_id, res.shortfall)
    except Exception:  # noqa: BLE001
        log.exception("settle failed rid=%s, reservation will be reaped", ctx.rid)


# ---------------------------------------------------------------- 上游调用与重试
async def call_upstream(ctx: RelayContext) -> NonStreamResult | StreamSession:
    table = await channel_cache.get()
    retry_times = await rs.get("channel.retry_times")
    cooldown_s = await rs.get("channel.cooldown_seconds")
    excluded: set[tuple[int, int]] = set()
    last: UpstreamError | None = None
    for attempt in range(retry_times + 1):
        sel = await select_channel(table, ctx.ident.group, ctx.model, attempt, excluded)
        if sel is None:
            break
        ch, key = sel
        ctx.channel, ctx.key, ctx.retry_count = ch, key, attempt
        ctx.upstream_model = ch.upstream_model(ctx.model)
        call = UpstreamCall(channel=ch, key=key, endpoint=ctx.endpoint, body=ctx.body, model=ctx.model,
                            upstream_model=ctx.upstream_model, stream=ctx.stream,
                            client_headers=ctx.client_headers)
        try:
            return await dispatch(call)
        except UpstreamError as e:
            last = e
            excluded.add((ch.id, key.id))
            log.warning("upstream error rid=%s ch=%s key=%s status=%s msg=%s", ctx.rid, ch.id, key.id,
                        e.status, e.message[:300])
            if ch.auto_ban and not e.connect and await health.should_disable(e.status, e.message):
                asyncio.create_task(health.auto_disable_key(ch.id, key.id, f"[{e.status}] {e.message}"))
            elif e.status == 429 or e.status >= 500:
                await cooldown(ch.id, key.id, cooldown_s)
            if not (await health.should_retry(e.status, e.connect)
                    or await health.should_disable(e.status, e.message)):
                break
    if last is None:
        raise RelayError(f"当前分组 {ctx.ident.group} 下模型 {ctx.model} 无可用渠道", status=503,
                         type_="api_error", code="no_available_channel")
    raise last


def _upstream_to_relay(e: UpstreamError) -> RelayError:
    status = e.status if 400 <= e.status < 600 else 502
    if status in (401, 403):
        # 上游鉴权失败不暴露给用户（是平台渠道问题）
        return RelayError("上游服务暂不可用，请稍后重试", status=503, type_="api_error", code="upstream_error")
    type_ = "invalid_request_error" if 400 <= status < 500 and status != 429 else "api_error"
    return RelayError(e.message, status=status, type_=type_, code="upstream_error")


# ---------------------------------------------------------------- 主流程
async def relay(request: Request, endpoint: str) -> Response:
    try:
        ctx = await prepare(request, endpoint)
        await reserve(ctx)
    except RelayError as e:
        return error_response(endpoint, e)

    try:
        result = await call_upstream(ctx)
    except (RelayError, UpstreamError) as e:
        err = e if isinstance(e, RelayError) else _upstream_to_relay(e)
        await settle(ctx, Usage(), status=CALL_FAILED, http_status=err.status, error=str(e))
        return error_response(endpoint, err, ctx.rid)
    except Exception as e:  # noqa: BLE001
        log.exception("relay crashed rid=%s", ctx.rid)
        await settle(ctx, Usage(), status=CALL_FAILED, http_status=500, error=repr(e))
        return error_response(endpoint, RelayError("服务内部错误", status=500, type_="api_error"), ctx.rid)

    headers = {"x-request-id": ctx.rid}
    if isinstance(result, NonStreamResult):
        text = ""
        if result.usage is None:
            text = orjson.dumps(result.body.get("choices") or result.body.get("content") or "").decode()
        usage = _final_usage(ctx, result.usage, text)
        await settle(ctx, usage, status=CALL_SUCCESS, http_status=200)
        return Response(orjson.dumps(result.body), media_type="application/json", headers=headers)

    return StreamingResponse(_stream(ctx, result), media_type="text/event-stream",
                             headers={**headers, "Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def _stream(ctx: RelayContext, session: StreamSession) -> AsyncIterator[bytes]:
    status, http_status, error = CALL_SUCCESS, 200, ""
    try:
        async for frame in session:
            yield frame
        if not session.finished:
            status, error = CALL_FAILED, "上游流提前结束"
    except UpstreamError as e:
        status, http_status, error = CALL_FAILED, e.status, e.message
        err = RelayError(f"上游流中断: {e.message}", status=502, type_="api_error")
        payload = err.to_anthropic() if ctx.endpoint == "messages" else err.to_openai()
        yield (b"event: error\n" if ctx.endpoint == "messages" else b"") + b"data: " + orjson.dumps(payload) + b"\n\n"
    except (asyncio.CancelledError, GeneratorExit):
        status, http_status, error = CALL_CLIENT_ABORT, 499, "客户端断开连接"
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("stream crashed rid=%s", ctx.rid)
        status, http_status, error = CALL_FAILED, 500, repr(e)
    finally:
        # 客户端断开时当前任务处于取消状态，屏蔽取消以保证关闭上游与结算一定完成
        with anyio.CancelScope(shield=True):
            try:
                await session.aclose()
            except Exception:  # noqa: BLE001
                pass
            if status != CALL_SUCCESS and session.usage is None and session.first_token_at is None:
                usage = Usage()  # 未产生任何输出的失败/断开不计费
            else:
                # 中途失败/断开：已产生的内容照常计费（上游同样按已生成部分向平台收费）
                usage = _final_usage(ctx, session.usage, session.output_text())
            ftm = int((session.first_token_at - ctx.started) * 1000) if session.first_token_at else 0
            await settle(ctx, usage, status=status, http_status=http_status, error=error, first_token_ms=ftm)
