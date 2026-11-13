"""进程内缓存 + Redis 版本号失效。

控制面修改数据后调用 bump(domain)，各进程最多 check_interval 秒后感知并重新加载；
Redis 不可用时继续使用旧数据（无数据时直接加载），保证数据面可用性。
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Generic, TypeVar

from app.core.redis import redis

log = logging.getLogger(__name__)
T = TypeVar("T")


def _ver_key(domain: str) -> str:
    return f"tm:ver:{domain}"


async def bump(*domains: str) -> None:
    for d in domains:
        try:
            await redis.incr(_ver_key(d))
        except Exception:  # noqa: BLE001
            log.warning("bump cache version failed: %s", d)


class VersionedCache(Generic[T]):
    def __init__(self, domain: str, loader: Callable[[], Awaitable[T]], check_interval: float = 1.0,
                 max_age: float = 60.0):
        self.domain = domain
        self.loader = loader
        self.check_interval = check_interval
        self.max_age = max_age
        self._data: T | None = None
        self._ver: str | None = None
        self._checked = 0.0
        self._loaded = 0.0
        self._lock = asyncio.Lock()

    async def get(self) -> T:
        now = time.monotonic()
        if self._data is not None and now - self._checked < self.check_interval and now - self._loaded < self.max_age:
            return self._data
        async with self._lock:
            now = time.monotonic()
            if self._data is not None and now - self._checked < self.check_interval and now - self._loaded < self.max_age:
                return self._data
            try:
                ver = await redis.get(_ver_key(self.domain))
            except Exception:  # noqa: BLE001
                ver = self._ver
            self._checked = now
            if self._data is None or ver != self._ver or now - self._loaded >= self.max_age:
                self._data = await self.loader()
                self._ver = ver
                self._loaded = now
            return self._data

    def invalidate_local(self) -> None:
        self._data = None
