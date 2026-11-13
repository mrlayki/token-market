"""渠道选择：优先级分档 → 档内加权随机 → 多 Key 随机/轮询；失败后切换到下一档。

另有基于 Redis 的短时冷却：上游 429/5xx 后该渠道 Key 冷却 N 秒，冷却中尽量不选。
"""

from __future__ import annotations

import random

from app.core.redis import redis
from app.models.channel import MULTI_KEY_POLLING
from app.relay.catalog import AbilityRT, ChannelKeyRT, ChannelRT, ChannelTable


def _cool_key(channel_id: int, key_id: int) -> str:
    return f"tm:cool:{channel_id}:{key_id}"


async def cooldown(channel_id: int, key_id: int, seconds: int) -> None:
    if seconds > 0:
        try:
            await redis.set(_cool_key(channel_id, key_id), 1, ex=seconds)
        except Exception:  # noqa: BLE001
            pass


async def _cooling(pairs: list[tuple[int, int]]) -> set[tuple[int, int]]:
    if not pairs:
        return set()
    try:
        vals = await redis.mget([_cool_key(c, k) for c, k in pairs])
    except Exception:  # noqa: BLE001
        return set()
    return {p for p, v in zip(pairs, vals, strict=True) if v}


def _weighted_pick(items: list[AbilityRT]) -> AbilityRT:
    # 与常见实现一致：权重 + 基数，避免权重 0 的渠道永远选不到
    weights = [max(a.weight, 0) + 10 for a in items]
    return random.choices(items, weights=weights, k=1)[0]


async def _pick_key(ch: ChannelRT, excluded_keys: set[int]) -> ChannelKeyRT | None:
    keys = [k for k in ch.keys if k.id not in excluded_keys]
    if not keys:
        return None
    cooling = await _cooling([(ch.id, k.id) for k in keys])
    warm = [k for k in keys if (ch.id, k.id) not in cooling] or keys
    if ch.multi_key_mode == MULTI_KEY_POLLING and len(warm) > 1:
        try:
            n = await redis.incr(f"tm:poll:{ch.id}")
        except Exception:  # noqa: BLE001
            n = random.randint(0, 1 << 30)
        return warm[n % len(warm)]
    return random.choice(warm)


async def select_channel(table: ChannelTable, group: str, model: str, attempt: int,
                         excluded: set[tuple[int, int]]) -> tuple[ChannelRT, ChannelKeyRT] | None:
    """attempt=0 使用最高优先级档；之后逐档下降，最后一档重复使用。excluded 为本次请求已失败的 (渠道, Key)。"""
    tiers = table.tiers(group, model)
    if not tiers:
        return None
    start = min(attempt, len(tiers) - 1)
    # 从目标档开始向下找，找不到再回头找更高档（避免某档全部失败时直接放弃）
    order = list(range(start, len(tiers))) + list(range(0, start))
    for ti in order:
        candidates = list(tiers[ti])
        while candidates:
            ab = _weighted_pick(candidates)
            ch = table.channels[ab.channel_id]
            ex_keys = {k for c, k in excluded if c == ch.id}
            key = await _pick_key(ch, ex_keys)
            if key is not None:
                return ch, key
            candidates.remove(ab)
    return None
