import asyncio
import logging
import time

from sqlalchemy import select

from app.channels.tester import test_channel
from app.core import runtime_settings as rs
from app.core.db import SessionLocal
from app.core.redis import redis
from app.models.channel import CH_AUTO_DISABLED, CH_ENABLED, Channel

log = logging.getLogger("worker.channel")


async def test_channels(ids: list[int], concurrency: int = 8) -> list[dict]:
    sem = asyncio.Semaphore(concurrency)

    async def one(cid: int) -> dict:
        async with sem:
            try:
                return {"channel_id": cid, **(await test_channel(cid))}
            except Exception as e:  # noqa: BLE001
                return {"channel_id": cid, "ok": False, "message": repr(e)}

    return await asyncio.gather(*(one(i) for i in ids))


async def auto_test_tick() -> None:
    minutes = await rs.get("channel.auto_test_minutes")
    if not minutes:
        return
    last = float(await redis.get("tm:channel:autotest:last") or 0)
    if time.time() - last < minutes * 60:
        return
    await redis.set("tm:channel:autotest:last", time.time())
    async with SessionLocal() as s:
        ids = list((await s.execute(
            select(Channel.id).where(Channel.status.in_([CH_ENABLED, CH_AUTO_DISABLED]))
        )).scalars())
    results = await test_channels(ids)
    failed = [r for r in results if not r.get("ok")]
    log.info("channel auto test done: total=%s failed=%s", len(results), len(failed))


async def balance_snapshot_tick() -> None:
    """按配置间隔为支持余额查询的渠道记录余额快照（上游余额对账的数据源）。"""
    from app.billing.upstream_recon import snapshot_all_balances

    minutes = await rs.get("recon.balance_snapshot_minutes")
    if not minutes:
        return
    last = float(await redis.get("tm:channel:balance_snapshot:last") or 0)
    if time.time() - last < minutes * 60:
        return
    await redis.set("tm:channel:balance_snapshot:last", time.time())
    n = await snapshot_all_balances()
    log.info("balance snapshots taken: %s", n)
