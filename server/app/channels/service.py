"""渠道写操作：保存渠道时同步重建能力表并刷新数据面缓存。"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import bump
from app.core.errors import AppError
from app.core.security import encrypt_secret, mask_secret
from app.models.channel import CH_ENABLED, CHANNEL_TYPES, Ability, Channel, ChannelKey
from app.relay.catalog import DOMAIN_CHANNELS
from app.security_utils import validate_upstream_url


def split_keys(raw: str | list[str]) -> list[str]:
    """批量粘贴：按行拆分，去空去重。以 [ 开头时按 JSON 数组解析。"""
    import orjson

    if isinstance(raw, list):
        items = raw
    else:
        raw = raw.strip()
        if raw.startswith("["):
            items = [k if isinstance(k, str) else orjson.dumps(k).decode() for k in orjson.loads(raw)]
        else:
            items = raw.splitlines()
    seen, out = set(), []
    for k in items:
        k = k.strip()
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


async def rebuild_abilities(s: AsyncSession, ch: Channel) -> None:
    await s.execute(delete(Ability).where(Ability.channel_id == ch.id))
    enabled = ch.status == CH_ENABLED
    for g in sorted(set(ch.groups or [])):
        for m in sorted(set(ch.models or [])):
            s.add(Ability(group=g, model=m, channel_id=ch.id, enabled=enabled, priority=ch.priority, weight=ch.weight))


async def add_keys(s: AsyncSession, channel_id: int, keys: list[str]) -> int:
    existing = (await s.execute(select(ChannelKey).where(ChannelKey.channel_id == channel_id))).scalars().all()
    from app.core.security import decrypt_secret

    have = set()
    for k in existing:
        try:
            have.add(decrypt_secret(k.key_enc))
        except Exception:  # noqa: BLE001
            pass
    n = 0
    for k in keys:
        if k in have:
            continue
        s.add(ChannelKey(channel_id=channel_id, key_enc=encrypt_secret(k), key_mask=mask_secret(k)))
        n += 1
    return n


CHANNEL_FIELDS = ("name", "type", "base_url", "models", "model_mapping", "groups", "priority", "weight",
                  "multi_key_mode", "auto_ban", "test_model", "cost_ratio", "cost_time_rules", "param_override",
                  "header_override", "tag", "remark")


async def save_channel(s: AsyncSession, data: dict, channel: Channel | None = None,
                       keys: list[str] | None = None, replace_keys: bool = False) -> Channel:
    if data.get("type") and data["type"] not in CHANNEL_TYPES:
        raise AppError(f"不支持的渠道类型 {data['type']}")
    if data.get("base_url"):
        await validate_upstream_url(data["base_url"])
    if data.get("cost_time_rules") is not None:
        from app.billing.pricing import validate_time_rules

        try:
            data["cost_time_rules"] = validate_time_rules(data["cost_time_rules"])
        except (ValueError, KeyError) as e:
            raise AppError(f"采购时段规则不合法：{e}") from e
    if channel is None:
        if not keys:
            raise AppError("至少需要一个 Key")
        channel = Channel(status=CH_ENABLED)
        s.add(channel)
    for f in CHANNEL_FIELDS:
        if f in data and data[f] is not None:
            setattr(channel, f, data[f])
    if "status" in data and data["status"] is not None:
        channel.status = data["status"]
        channel.status_changed_at = datetime.now(UTC)
        if data["status"] == CH_ENABLED:
            channel.status_reason = ""
    channel.models = sorted(set(channel.models or []))
    channel.groups = sorted(set(channel.groups or ["default"]))
    await s.flush()
    if replace_keys and keys is not None:
        await s.execute(delete(ChannelKey).where(ChannelKey.channel_id == channel.id))
    if keys:
        await add_keys(s, channel.id, keys)
    await rebuild_abilities(s, channel)
    await s.flush()
    return channel


async def after_channel_change() -> None:
    await bump(DOMAIN_CHANNELS)
