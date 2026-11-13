"""渠道健康：根据上游错误自动禁用 Key / 渠道，测试成功后自动启用。"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import func, select, update

from app.core import runtime_settings as rs
from app.core.cache import bump
from app.core.db import SessionLocal
from app.models.channel import CH_AUTO_DISABLED, CH_ENABLED, Channel, ChannelKey
from app.models.ops import Notification
from app.relay.catalog import DOMAIN_CHANNELS

log = logging.getLogger(__name__)


async def should_disable(status: int, message: str) -> bool:
    cfg = await rs.get_all()
    if not cfg["channel.auto_disable"]:
        return False
    if rs.code_in(status, rs.parse_code_ranges(cfg["channel.disable_status_codes"])):
        return True
    low = (message or "").lower()
    return any(k and k.lower() in low for k in cfg["channel.disable_keywords"])


async def should_retry(status: int, connect: bool) -> bool:
    if connect:
        return True
    cfg = await rs.get_all()
    return rs.code_in(status, rs.parse_code_ranges(cfg["channel.retry_status_codes"]))


async def auto_disable_key(channel_id: int, key_id: int, reason: str) -> None:
    now = datetime.now(UTC)
    async with SessionLocal() as s:
        res = await s.execute(
            update(ChannelKey).where(ChannelKey.id == key_id, ChannelKey.status == CH_ENABLED)
            .values(status=CH_AUTO_DISABLED, status_reason=reason[:255], status_changed_at=now)
        )
        if res.rowcount == 0:
            return  # 已被禁用（并发重复触发）
        left = (await s.execute(
            select(func.count()).select_from(ChannelKey)
            .where(ChannelKey.channel_id == channel_id, ChannelKey.status == CH_ENABLED)
        )).scalar_one()
        ch = await s.get(Channel, channel_id)
        title = f"渠道「{ch.name if ch else channel_id}」Key #{key_id} 已自动禁用"
        if left == 0 and ch and ch.status == CH_ENABLED:
            ch.status = CH_AUTO_DISABLED
            ch.status_reason = f"全部 Key 不可用：{reason[:200]}"
            ch.status_changed_at = now
            title = f"渠道「{ch.name}」已自动禁用（全部 Key 不可用）"
        s.add(Notification(user_id=None, kind="channel_disabled", title=title, content=reason[:2000]))
        await s.commit()
    log.warning("%s: %s", title, reason)
    await bump(DOMAIN_CHANNELS)


async def auto_enable_channel(channel_id: int) -> bool:
    """测试成功后恢复被「自动」禁用的渠道及其 Key（手动禁用的不动）。"""
    if not await rs.get("channel.auto_enable"):
        return False
    now = datetime.now(UTC)
    async with SessionLocal() as s:
        ch = await s.get(Channel, channel_id)
        if not ch:
            return False
        changed = False
        r = await s.execute(
            update(ChannelKey).where(ChannelKey.channel_id == channel_id, ChannelKey.status == CH_AUTO_DISABLED)
            .values(status=CH_ENABLED, status_reason="", status_changed_at=now)
        )
        changed = r.rowcount > 0
        if ch.status == CH_AUTO_DISABLED:
            ch.status = CH_ENABLED
            ch.status_reason = ""
            ch.status_changed_at = now
            changed = True
            s.add(Notification(user_id=None, kind="channel_enabled", title=f"渠道「{ch.name}」已自动恢复"))
        await s.commit()
    if changed:
        await bump(DOMAIN_CHANNELS)
    return changed
