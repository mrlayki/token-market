"""Mock 上游：OpenAI / Anthropic 兼容，用于压测与故障注入。

故障注入（三选一方式，优先级从高到低）：
  1. 请求头 x-mock-fault
  2. 模型名后缀，如 mock-gpt@500、mock-gpt@slow、mock-gpt@nousage、mock-gpt@cut
  3. 全局：POST /_mock/fault {"fault": "...", "count": N}（N 次后自动恢复）

fault 取值：
  401 / 402 / 429 / 500 / 503   直接返回对应状态码
  timeout                        挂起 120s
  slow                           每个流式块间隔 300ms
  nousage                        不返回 usage
  cut                            流式输出一半后断开连接（无结束标志）
"""

import asyncio
import json
import os
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI(title="mock-upstream")
STATE = {"fault": None, "count": 0, "requests": 0, "usage": {"prompt": 0, "completion": 0}}
DELAY = float(os.getenv("MOCK_CHUNK_DELAY", "0.02"))
WORDS = ("Token Market 是一个大模型 API 经营平台，支持多厂商统一接入、按量与套餐包计费、额度管控与对账。" * 3)


def _fault(request: Request, model: str) -> str | None:
    if request.headers.get("x-mock-fault"):
        return request.headers["x-mock-fault"]
    if "@" in model:
        return model.split("@", 1)[1]
    if STATE["fault"] and STATE["count"] > 0:
        STATE["count"] -= 1
        f = STATE["fault"]
        if STATE["count"] == 0:
            STATE["fault"] = None
        return f
    return None


def _prompt_tokens(body: dict) -> int:
    n = 0
    for m in body.get("messages") or []:
        c = m.get("content")
        n += len(c) if isinstance(c, str) else len(json.dumps(c, ensure_ascii=False))
    return max(n // 2, 1)


def _completion_len(body: dict) -> int:
    mt = body.get("max_tokens") or body.get("max_completion_tokens") or 64
    return max(1, min(int(mt), len(WORDS)))


def _error(status: int):
    msgs = {401: "Incorrect API key provided (mock)", 402: "insufficient_quota (mock)",
            429: "Rate limit reached (mock)", 500: "Internal server error (mock)", 503: "Service overloaded (mock)"}
    return JSONResponse({"error": {"message": msgs.get(status, "error"), "type": "mock_error"}}, status_code=status)


async def _pre(fault: str | None):
    if fault and fault.isdigit():
        return _error(int(fault))
    if fault == "timeout":
        await asyncio.sleep(120)
    return None


@app.post("/_mock/fault")
async def set_fault(request: Request):
    j = await request.json()
    STATE["fault"], STATE["count"] = j.get("fault"), int(j.get("count", 1))
    return STATE


@app.get("/_mock/stats")
async def stats():
    return STATE


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": m, "object": "model"} for m in ("mock-gpt", "mock-claude", "mock-embed")]}


@app.post("/v1/chat/completions")
async def chat(request: Request):
    body = await request.json()
    model = body.get("model", "mock")
    fault = _fault(request, model)
    if (r := await _pre(fault)):
        return r
    STATE["requests"] += 1
    pt, n = _prompt_tokens(body), _completion_len(body)
    STATE["usage"]["prompt"] += pt
    STATE["usage"]["completion"] += n
    cid = "chatcmpl-" + uuid.uuid4().hex[:12]
    usage = {"prompt_tokens": pt, "completion_tokens": n, "total_tokens": pt + n,
             "prompt_tokens_details": {"cached_tokens": 0}}
    if not body.get("stream"):
        out = {"id": cid, "object": "chat.completion", "created": int(time.time()), "model": model,
               "choices": [{"index": 0, "message": {"role": "assistant", "content": WORDS[:n]}, "finish_reason": "stop"}]}
        if fault != "nousage":
            out["usage"] = usage
        return out
    include_usage = (body.get("stream_options") or {}).get("include_usage")

    async def gen():
        delay = 0.3 if fault == "slow" else DELAY
        for i in range(n):
            if fault == "cut" and i >= n // 2:
                return
            chunk = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": model,
                     "choices": [{"index": 0, "delta": {"content": WORDS[i]}, "finish_reason": None}]}
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            await asyncio.sleep(delay)
        end = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": model,
               "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        yield f"data: {json.dumps(end)}\n\n"
        if include_usage and fault != "nousage":
            yield f"data: {json.dumps({'id': cid, 'object': 'chat.completion.chunk', 'model': model, 'choices': [], 'usage': usage})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/v1/embeddings")
async def embeddings(request: Request):
    body = await request.json()
    inp = body.get("input")
    items = inp if isinstance(inp, list) else [inp]
    pt = sum(max(len(str(x)) // 2, 1) for x in items)
    return {"object": "list", "model": body.get("model"),
            "data": [{"object": "embedding", "index": i, "embedding": [0.01] * 8} for i in range(len(items))],
            "usage": {"prompt_tokens": pt, "total_tokens": pt}}


@app.post("/v1/messages")
async def messages(request: Request):
    body = await request.json()
    model = body.get("model", "mock")
    fault = _fault(request, model)
    if (r := await _pre(fault)):
        return r
    STATE["requests"] += 1
    pt, n = _prompt_tokens(body), _completion_len(body)
    mid = "msg_" + uuid.uuid4().hex[:12]
    if not body.get("stream"):
        out = {"id": mid, "type": "message", "role": "assistant", "model": model,
               "content": [{"type": "text", "text": WORDS[:n]}], "stop_reason": "end_turn"}
        if fault != "nousage":
            out["usage"] = {"input_tokens": pt, "output_tokens": n}
        return out

    def ev(name, data):
        return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    async def gen():
        delay = 0.3 if fault == "slow" else DELAY
        start_usage = {"input_tokens": pt, "output_tokens": 1} if fault != "nousage" else {}
        yield ev("message_start", {"type": "message_start", "message": {
            "id": mid, "type": "message", "role": "assistant", "model": model, "content": [], "usage": start_usage}})
        yield ev("content_block_start", {"type": "content_block_start", "index": 0,
                                         "content_block": {"type": "text", "text": ""}})
        for i in range(n):
            if fault == "cut" and i >= n // 2:
                return
            yield ev("content_block_delta", {"type": "content_block_delta", "index": 0,
                                             "delta": {"type": "text_delta", "text": WORDS[i]}})
            await asyncio.sleep(delay)
        yield ev("content_block_stop", {"type": "content_block_stop", "index": 0})
        delta = {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}
        if fault != "nousage":
            delta["usage"] = {"output_tokens": n}
        yield ev("message_delta", delta)
        yield ev("message_stop", {"type": "message_stop"})

    return StreamingResponse(gen(), media_type="text/event-stream")
