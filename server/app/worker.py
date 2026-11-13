"""后台任务进程：计量落库消费者 + 周期任务调度。"""

from __future__ import annotations

import asyncio
import logging
import signal
from collections.abc import Awaitable, Callable

from app.core.logging import setup_logging
from app.core.redis import redis
from app.jobs import quota_jobs, usage_consumer

log = logging.getLogger("worker")


async def periodic(name: str, fn: Callable[[], Awaitable[None]], interval: float, stop: asyncio.Event,
                   lock_ttl: int | None = None) -> None:
    """周期执行；多 worker 实例时用 Redis 锁保证同一时刻只有一个实例执行。"""
    while not stop.is_set():
        try:
            got = await redis.set(f"tm:joblock:{name}", "1", nx=True, ex=lock_ttl or max(int(interval), 5))
            if got:
                await fn()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("job %s failed", name)
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            pass


async def main() -> None:
    setup_logging()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    from app.jobs import channel_jobs, report_jobs

    tasks = [
        asyncio.create_task(usage_consumer.run(stop)),
        asyncio.create_task(periodic("outbox", quota_jobs.retry_outbox, 5, stop)),
        asyncio.create_task(periodic("reaper", quota_jobs.reap_reservations, 30, stop)),
        asyncio.create_task(periodic("pkg_expire", quota_jobs.expire_packages, 60, stop)),
        asyncio.create_task(periodic("partitions", quota_jobs.ensure_partitions, 3600, stop)),
        asyncio.create_task(periodic("channel_autotest", channel_jobs.auto_test_tick, 60, stop)),
        asyncio.create_task(periodic("balance_snapshot", channel_jobs.balance_snapshot_tick, 60, stop)),
        asyncio.create_task(periodic("order_expire", report_jobs.expire_orders, 60, stop)),
        asyncio.create_task(periodic("statements", report_jobs.build_statements, 600, stop)),
        asyncio.create_task(periodic("recon", report_jobs.reconcile, 3600, stop, lock_ttl=1800)),
    ]
    log.info("worker started")
    await stop.wait()
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
