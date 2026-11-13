"""渠道测试、余额查询、拉取上游模型列表。测试不计费。"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from decimal import Decimal

import orjson
from sqlalchemy import select

from app.channels import health
from app.core import runtime_settings as rs
from app.core.cache import bump
from app.core.db import SessionLocal
from app.core.security import decrypt_secret
from app.models.catalog import ModelMeta
from app.models.channel import CHANNEL_TYPES, Channel, ChannelKey
from app.relay.catalog import DOMAIN_CHANNELS, ChannelKeyRT, ChannelRT
from app.relay.upstream import NonStreamResult, UpstreamCall, UpstreamError, dispatch, http_client


def _runtime(ch: Channel, keys: list[ChannelKey]) -> ChannelRT:
    meta = CHANNEL_TYPES.get(ch.type, CHANNEL_TYPES["openai_compatible"])
    return ChannelRT(
        id=ch.id, name=ch.name, type=ch.type, provider=meta["provider"],
        base_url=(ch.base_url or meta["base_url"]).rstrip("/"), model_mapping=ch.model_mapping or {},
        multi_key_mode=ch.multi_key_mode, auto_ban=ch.auto_ban, cost_ratio=Decimal(ch.cost_ratio),
        param_override=ch.param_override or {}, header_override=ch.header_override or {},
        keys=[ChannelKeyRT(id=k.id, key=decrypt_secret(k.key_enc)) for k in keys],
    )


async def test_channel(channel_id: int, model: str | None = None, key_id: int | None = None,
                       stream: bool = False) -> dict:
    async with SessionLocal() as s:
        ch = await s.get(Channel, channel_id)
        if ch is None:
            return {"ok": False, "message": "渠道不存在"}
        q = select(ChannelKey).where(ChannelKey.channel_id == channel_id).order_by(ChannelKey.id)
        if key_id:
            q = q.where(ChannelKey.id == key_id)
        keys = (await s.execute(q)).scalars().all()
        if not keys:
            return {"ok": False, "message": "渠道没有可用的 Key"}
        test_model = model or ch.test_model or (ch.models[0] if ch.models else "")
        mode = (await s.execute(select(ModelMeta.mode).where(ModelMeta.name == test_model))).scalar() or "chat"
    rt = _runtime(ch, keys)
    key = rt.keys[0]
    if mode == "embedding":
        endpoint, body = "embeddings", {"model": test_model, "input": "hello"}
    elif rt.provider == "anthropic":
        endpoint, body = "messages", {"model": test_model, "max_tokens": 8, "stream": stream,
                                      "messages": [{"role": "user", "content": "hi"}]}
    else:
        endpoint, body = "chat", {"model": test_model, "max_tokens": 8, "stream": stream,
                                  "messages": [{"role": "user", "content": "hi"}]}
    call = UpstreamCall(channel=rt, key=key, endpoint=endpoint, body=body, model=test_model,
                        upstream_model=rt.upstream_model(test_model), stream=stream)
    t0 = time.monotonic()
    ok, message, status = True, "", 200
    try:
        res = await asyncio.wait_for(dispatch(call), timeout=60)
        if not isinstance(res, NonStreamResult):
            async for _ in res:
                pass
            await res.aclose()
    except UpstreamError as e:
        ok, message, status = False, e.message, e.status
    except TimeoutError:
        ok, message, status = False, "测试超时（60s）", 504
    elapsed = int((time.monotonic() - t0) * 1000)
    slow = await rs.get("channel.slow_threshold_ms")
    if ok and slow and elapsed > slow:
        ok, message = False, f"响应耗时 {elapsed}ms 超过阈值 {slow}ms"

    async with SessionLocal() as s:
        c = await s.get(Channel, channel_id)
        c.response_time_ms = elapsed
        c.tested_at = datetime.now(UTC)
        await s.commit()
    if ok:
        await health.auto_enable_channel(channel_id)
    elif ch.auto_ban and await health.should_disable(status, message):
        await health.auto_disable_key(channel_id, key.id, f"[测试] [{status}] {message}")
    await bump(DOMAIN_CHANNELS)
    return {"ok": ok, "message": message or "测试成功", "status": status, "elapsed_ms": elapsed,
            "model": test_model, "key_id": key.id}


async def query_balance(channel_id: int) -> dict:
    async with SessionLocal() as s:
        ch = await s.get(Channel, channel_id)
        key = (await s.execute(select(ChannelKey).where(ChannelKey.channel_id == channel_id)
                               .order_by(ChannelKey.id).limit(1))).scalar_one_or_none()
        if not ch or not key:
            return {"ok": False, "message": "渠道或 Key 不存在"}
        secret = decrypt_secret(key.key_enc)
        if ch.type != "deepseek":
            return {"ok": False, "message": f"{CHANNEL_TYPES.get(ch.type, {}).get('label', ch.type)} 未提供余额查询接口"}
        try:
            r = await http_client().get("https://api.deepseek.com/user/balance",
                                        headers={"Authorization": f"Bearer {secret}"}, timeout=15)
            j = r.json()
            info = (j.get("balance_infos") or [{}])[0]
            ch.balance = Decimal(str(info.get("total_balance", "0")))
            ch.balance_currency = info.get("currency", "")
            ch.balance_updated_at = datetime.now(UTC)
            await s.commit()
            return {"ok": True, "balance": str(ch.balance), "currency": ch.balance_currency}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "message": f"查询失败: {e}"}


async def fetch_upstream_models(type_: str, base_url: str, key: str) -> list[str]:
    meta = CHANNEL_TYPES.get(type_, CHANNEL_TYPES["openai_compatible"])
    base = (base_url or meta["base_url"]).rstrip("/")
    if meta["provider"] == "anthropic":
        base = base[:-3] if base.endswith("/v1") else base
        r = await http_client().get(base + "/v1/models?limit=1000", timeout=20,
                                    headers={"x-api-key": key, "anthropic-version": "2023-06-01"})
    elif meta["provider"] == "gemini":
        r = await http_client().get(f"https://generativelanguage.googleapis.com/v1beta/models?key={key}", timeout=20)
        r.raise_for_status()
        return sorted(m["name"].split("/")[-1] for m in r.json().get("models", []))
    else:
        r = await http_client().get(base + "/models", timeout=20, headers={"Authorization": f"Bearer {key}"})
    if r.status_code != 200:
        raise UpstreamError(r.status_code, r.text[:500])
    data = orjson.loads(r.content).get("data") or []
    return sorted({m.get("id") for m in data if m.get("id")})
