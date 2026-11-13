"""额度相关后台任务：outbox 重试、超时预扣回收、套餐过期。"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

from sqlalchemy import select, update

from app.billing.accounting import apply_outbox_row, remove_packages
from app.core.db import SessionLocal
from app.core.redis import redis
from app.models.billing import BIZ_EXPIRE, PKG_ACTIVE, PKG_EXPIRED, LedgerEntry, QuotaOutbox, UserPackage
from app.models.logs import CALL_FAILED
from app.quota.engine import RSV_DEADLINE
from app.quota.service import get_engine

log = logging.getLogger("worker.quota")


async def retry_outbox() -> None:
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(QuotaOutbox).where(QuotaOutbox.applied.is_(False)).order_by(QuotaOutbox.id).limit(500)
        )).scalars().all()
        for ob in rows:
            try:
                await apply_outbox_row(ob)
                ob.applied = True
            except Exception:  # noqa: BLE001
                ob.attempts += 1
                log.warning("outbox retry failed id=%s attempts=%s", ob.id, ob.attempts)
                break  # Redis 仍不可用，按顺序等待下一轮
        await s.commit()


async def reap_reservations() -> None:
    """回收超时未结算的预扣（中转进程崩溃等）。按预估用量保守结算，并标记为 reaped 供人工复核。"""
    engine = get_engine()
    due = await redis.zrangebyscore(RSV_DEADLINE, 0, time.time(), start=0, num=200)
    for member in due:
        uid_s, rid = member.split(":", 1)
        uid = int(uid_s)
        ctx = await engine.get_reservation_ctx(uid, rid)
        if ctx is None:
            await redis.zrem(RSV_DEADLINE, member)
            continue
        ev = {
            "rid": rid, "ts": time.time(), "uid": uid, "token_id": ctx.get("token_id"),
            "token_name": ctx.get("token_name", ""), "channel_id": None, "key_id": None,
            "model": ctx.get("model", ""), "upstream_model": "", "group": ctx.get("group", ""),
            "endpoint": ctx.get("endpoint", "chat"), "stream": ctx.get("stream", False), "status": CALL_FAILED,
            "http_status": 0, "error": "预扣超时未结算，已按预估用量回收（reaped）", "usage": {"estimated": True},
            "amount": ctx.get("est_cost", 0), "cost": 0, "price": ctx.get("price", {}), "retry": 0, "ftm": 0,
            "dur": 0, "ip": ctx.get("ip", ""),
        }
        res = await engine.settle_raw(rid=rid, uid=uid, token_id=ctx.get("token_id"),
                                      act_pkgs=ctx.get("est_pkgs") or {}, act_cost=int(ctx.get("est_cost") or 0),
                                      overdraft=0, event=ev)
        log.warning("reaped reservation uid=%s rid=%s ok=%s wallet=%s", uid, rid, res.ok, res.wallet)


async def expire_packages() -> None:
    now = datetime.now(UTC)
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(UserPackage).where(UserPackage.status == PKG_ACTIVE, UserPackage.expires_at <= now).limit(500)
        )).scalars().all()
        outbox: list[int] = []
        for p in rows:
            await s.execute(update(UserPackage).where(UserPackage.id == p.id).values(status=PKG_EXPIRED))
            if p.remaining_tokens > 0:
                s.add(LedgerEntry(user_id=p.user_id, bucket_type="package", bucket_key=f"pkg:{p.id}",
                                  package_id=p.id, amount=-p.remaining_tokens, balance_after=0,
                                  biz_type=BIZ_EXPIRE, biz_id=f"pkg:{p.id}", remark=f"{p.name} 到期失效"))
            outbox.append(await remove_packages(s, p.user_id, [p.id], "expire"))
        await s.commit()
    if outbox:
        from app.billing.accounting import flush_outbox

        await flush_outbox(outbox)


async def ensure_partitions() -> None:
    """预建当月及之后 2 个月的 call_log 分区。默认分区兜底。"""
    from sqlalchemy import text

    now = datetime.now(UTC)
    async with SessionLocal() as s:
        for i in range(3):
            y, m = now.year + (now.month - 1 + i) // 12, (now.month - 1 + i) % 12 + 1
            ny, nm = y + m // 12, m % 12 + 1
            name = f"call_log_{y}{m:02d}"
            exists = (await s.execute(text("SELECT to_regclass(:n)"), {"n": name})).scalar()
            if exists:
                continue
            # 默认分区中若已有该月数据，无法直接创建分区；此时跳过并告警（运维迁移）
            cnt = (await s.execute(text(
                "SELECT count(*) FROM call_log_default WHERE created_at >= :a AND created_at < :b"),
                {"a": datetime(y, m, 1, tzinfo=UTC), "b": datetime(ny, nm, 1, tzinfo=UTC)})).scalar()
            if cnt:
                log.warning("default partition holds %s rows for %s, skip creating partition", cnt, name)
                continue
            await s.execute(text(
                f"CREATE TABLE {name} PARTITION OF call_log FOR VALUES FROM ('{y}-{m:02d}-01') TO ('{ny}-{nm:02d}-01')"
            ))
            log.info("created partition %s", name)
        await s.commit()
