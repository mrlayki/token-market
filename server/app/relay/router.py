import time

import orjson
from fastapi import APIRouter, Request
from fastapi.responses import Response

from app.core.errors import RelayError
from app.relay import tokenizer
from app.relay.auth import authenticate
from app.relay.catalog import catalog_cache, channel_cache
from app.relay.handler import error_response, relay

router = APIRouter(prefix="/v1")


@router.post("/chat/completions")
async def chat_completions(request: Request):
    return await relay(request, "chat")


@router.post("/messages")
async def messages(request: Request):
    return await relay(request, "messages")


@router.post("/embeddings")
async def embeddings(request: Request):
    return await relay(request, "embeddings")


@router.post("/messages/count_tokens")
async def count_tokens(request: Request):
    try:
        await authenticate(request)
        body = orjson.loads(await request.body())
    except RelayError as e:
        return error_response("messages", e)
    except Exception:  # noqa: BLE001
        return error_response("messages", RelayError("请求体不是合法的 JSON"))
    return {"input_tokens": tokenizer.count_anthropic_messages(body)}


@router.get("/models")
async def list_models(request: Request):
    try:
        ident = await authenticate(request)
    except RelayError as e:
        return error_response("chat", e)
    cat = await catalog_cache.get()
    table = await channel_cache.get()
    names = sorted({m for (g, m), abs_ in table.abilities.items() if g == ident.group and abs_})
    if ident.model_limits:
        names = [n for n in names if n in ident.model_limits]
    now = int(time.time())
    data = [
        {"id": n, "object": "model", "created": now, "owned_by": (cat.models[n].vendor or "system")}
        for n in names if n in cat.models and cat.models[n].listed and n in cat.prices
    ]
    return Response(orjson.dumps({"object": "list", "data": data}), media_type="application/json")
