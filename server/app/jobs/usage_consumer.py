"""消费计量事件 Stream，幂等落库。消费者组 + 待确认重领 + 死信。"""

from __future__ import annotations

import asyncio
import logging
import os
import socket

import orjson
from redis.exceptions import ResponseError

from app.billing.usage_writer import persist_usage_event
from app.core.db import SessionLocal
from app.core.redis import redis, redis_blocking
from app.models.ops import Notification
from app.quota.engine import USAGE_STREAM

log = logging.getLogger("worker.usage")
GROUP = "tm-usage"
DLQ = USAGE_STREAM + ":dlq"
MAX_DELIVERIES = 10
CONSUMER = f"{socket.gethostname()}-{os.getpid()}"


async def ensure_group() -> None:
    try:
        await redis.xgroup_create(USAGE_STREAM, GROUP, id="0", mkstream=True)
    except ResponseError as e:
        if "BUSYGROUP" not in str(e):
            raise


async def _process(msg_id: str, fields: dict) -> None:
    ev = orjson.loads(fields["d"])
    async with SessionLocal() as s:
        await persist_usage_event(s, ev)
        await s.commit()
    await redis.xack(USAGE_STREAM, GROUP, msg_id)


async def _handle_batch(entries) -> None:
    for msg_id, fields in entries:
        try:
            await _process(msg_id, fields)
        except Exception:  # noqa: BLE001
            log.exception("persist usage event failed id=%s (will retry)", msg_id)


async def _reclaim() -> None:
    """重领超过 60s 未确认的消息；投递次数过多的移入死信并告警。"""
    pending = await redis.xpending_range(USAGE_STREAM, GROUP, min="-", max="+", count=100, idle=60_000)
    for p in pending:
        if p["times_delivered"] >= MAX_DELIVERIES:
            msgs = await redis.xrange(USAGE_STREAM, p["message_id"], p["message_id"])
            for mid, fields in msgs:
                await redis.xadd(DLQ, fields)
                async with SessionLocal() as s:
                    s.add(Notification(user_id=None, kind="usage_dlq", title="计量事件落库失败进入死信",
                                       content=f"message_id={mid} data={fields.get('d', '')[:1500]}"))
                    await s.commit()
            await redis.xack(USAGE_STREAM, GROUP, p["message_id"])
            log.error("usage event moved to DLQ id=%s", p["message_id"])
    res = await redis.xautoclaim(USAGE_STREAM, GROUP, CONSUMER, min_idle_time=60_000, start_id="0-0", count=100)
    claimed = res[1] if res else []
    if claimed:
        await _handle_batch(claimed)


async def run(stop: asyncio.Event) -> None:
    await ensure_group()
    last_reclaim = 0.0
    loop = asyncio.get_running_loop()
    while not stop.is_set():
        try:
            resp = await redis_blocking.xreadgroup(GROUP, CONSUMER, {USAGE_STREAM: ">"}, count=200, block=2000)
            for _, entries in resp or []:
                await _handle_batch(entries)
            if loop.time() - last_reclaim > 30:
                last_reclaim = loop.time()
                await _reclaim()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("usage consumer loop error")
            await asyncio.sleep(2)
