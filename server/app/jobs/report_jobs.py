"""订单超时关闭、账单生成、对账。"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert

from app.core.db import SessionLocal
from app.core.redis import redis
from app.models.commerce import ORDER_CLOSED, ORDER_PENDING, Order
from app.models.ops import ReconReport, Statement
from app.quota.engine import USAGE_STREAM, k_wallet

log = logging.getLogger("worker.report")


async def expire_orders() -> None:
    async with SessionLocal() as s:
        r = await s.execute(update(Order).where(Order.status == ORDER_PENDING, Order.expires_at < datetime.now(UTC))
                            .values(status=ORDER_CLOSED, remark="支付超时自动关闭"))
        await s.commit()
        if r.rowcount:
            log.info("closed %s expired orders", r.rowcount)


# ---------------------------------------------------------------- 账单
STATEMENT_SQL = text("""
WITH l AS (
  SELECT user_id,
    COALESCE(SUM(amount) FILTER (WHERE bucket_type='wallet' AND amount>0 AND biz_type<>'refund'),0) AS recharged,
    COALESCE(-SUM(amount) FILTER (WHERE bucket_type='wallet' AND biz_type='consume'),0) AS consumed,
    COALESCE(SUM(amount) FILTER (WHERE bucket_type='wallet' AND biz_type='refund'),0) AS refunded,
    COALESCE(-SUM(amount) FILTER (WHERE bucket_type='package' AND biz_type='consume'),0) AS pkg_tokens,
    COALESCE(SUM(amount) FILTER (WHERE bucket_type='wallet'),0) AS net
  FROM ledger_entry WHERE created_at >= :a AND created_at < :b GROUP BY user_id
), u AS (
  SELECT user_id, SUM(requests) AS requests, SUM(prompt_tokens) AS pt, SUM(completion_tokens) AS ct,
         jsonb_object_agg(model, amt) AS by_model
  FROM (SELECT user_id, model, SUM(requests) AS requests, SUM(prompt_tokens) AS prompt_tokens,
               SUM(completion_tokens) AS completion_tokens,
               jsonb_build_object('requests', SUM(requests), 'prompt_tokens', SUM(prompt_tokens),
                                  'completion_tokens', SUM(completion_tokens), 'amount', SUM(amount),
                                  'wallet_amount', SUM(wallet_amount), 'package_tokens', SUM(package_tokens)) AS amt
        FROM usage_hourly WHERE hour >= :a AND hour < :b GROUP BY user_id, model) x
  GROUP BY user_id
), c AS (
  SELECT user_id, COALESCE(SUM(amount),0) AS closing FROM ledger_entry
  WHERE bucket_type='wallet' AND created_at < :b GROUP BY user_id
)
SELECT COALESCE(l.user_id, u.user_id) AS user_id, COALESCE(l.recharged,0) recharged, COALESCE(l.consumed,0) consumed,
       COALESCE(l.refunded,0) refunded, COALESCE(l.pkg_tokens,0) pkg_tokens, COALESCE(l.net,0) net,
       COALESCE(u.requests,0) requests, COALESCE(u.pt,0) pt, COALESCE(u.ct,0) ct,
       COALESCE(u.by_model,'{}'::jsonb) by_model, COALESCE(c.closing,0) closing
FROM l FULL OUTER JOIN u ON l.user_id = u.user_id
LEFT JOIN c ON c.user_id = COALESCE(l.user_id, u.user_id)
""")


async def build_statement(period_type: str, start: date) -> int:
    a = datetime(start.year, start.month, start.day, tzinfo=UTC)
    if period_type == "day":
        b = a + timedelta(days=1)
    else:
        b = datetime(start.year + start.month // 12, start.month % 12 + 1, 1, tzinfo=UTC)
    n = 0
    async with SessionLocal() as s:
        rows = (await s.execute(STATEMENT_SQL, {"a": a, "b": b})).mappings().all()
        for r in rows:
            stmt = insert(Statement).values(
                user_id=r["user_id"], period_type=period_type, period_start=start,
                opening_balance=r["closing"] - r["net"], closing_balance=r["closing"], recharged=r["recharged"],
                consumed=r["consumed"], refunded=r["refunded"], package_tokens=r["pkg_tokens"],
                requests=r["requests"], prompt_tokens=r["pt"], completion_tokens=r["ct"],
                detail={"by_model": r["by_model"]},
            ).on_conflict_do_nothing(constraint="uq_statement_period")
            n += (await s.execute(stmt)).rowcount
        await s.commit()
    return n


async def build_statements() -> None:
    """账单在周期结束后生成且不可变：日账单生成昨天，月账单在每月初生成上月。"""
    today = datetime.now(UTC).date()
    y = today - timedelta(days=1)
    async with SessionLocal() as s:
        done = (await s.execute(select(func.count()).select_from(Statement).where(
            Statement.period_type == "day", Statement.period_start == y))).scalar()
    if not done:
        n = await build_statement("day", y)
        log.info("built %s daily statements for %s", n, y)
    first = today.replace(day=1)
    last_month = (first - timedelta(days=1)).replace(day=1)
    async with SessionLocal() as s:
        done = (await s.execute(select(func.count()).select_from(Statement).where(
            Statement.period_type == "month", Statement.period_start == last_month))).scalar()
    if not done:
        await build_statement("month", last_month)


# ---------------------------------------------------------------- 对账
async def _report(kind: str, checked: int, diffs: list[dict], summary: dict,
                  period: tuple[datetime, datetime] | None = None) -> ReconReport:
    async with SessionLocal() as s:
        r = ReconReport(kind=kind, status="ok" if not diffs else "mismatch", checked=checked,
                        mismatched=len(diffs), diffs=diffs[:500], summary=summary,
                        period_start=period[0] if period else None, period_end=period[1] if period else None)
        s.add(r)
        await s.commit()
        return r


async def recon_wallet_vs_ledger() -> ReconReport:
    """钱包余额 = 钱包流水之和；套餐剩余 = 套餐流水之和。"""
    async with SessionLocal() as s:
        w = (await s.execute(text("""
            SELECT w.user_id, w.balance, COALESCE(SUM(l.amount),0) AS ledger
            FROM wallet w LEFT JOIN ledger_entry l ON l.user_id=w.user_id AND l.bucket_type='wallet'
            GROUP BY w.user_id, w.balance"""))).mappings().all()
        p = (await s.execute(text("""
            SELECT p.id, p.user_id, p.remaining_tokens, p.status, COALESCE(SUM(l.amount),0) AS ledger
            FROM user_package p LEFT JOIN ledger_entry l ON l.package_id=p.id AND l.bucket_type='package'
            GROUP BY p.id"""))).mappings().all()
    diffs = [{"type": "wallet", "user_id": r["user_id"], "db": r["balance"], "ledger": int(r["ledger"]),
              "diff": r["balance"] - int(r["ledger"])} for r in w if r["balance"] != int(r["ledger"])]
    for r in p:
        expect = int(r["ledger"])
        actual = r["remaining_tokens"] if r["status"] != "expired" else 0
        if actual != expect:
            diffs.append({"type": "package", "package_id": r["id"], "user_id": r["user_id"], "db": actual,
                          "ledger": expect, "diff": actual - expect})
    return await _report("ledger_vs_balance", len(w) + len(p), diffs, {"wallets": len(w), "packages": len(p)})


async def recon_calllog_vs_ledger(hours: int = 25) -> ReconReport:
    """调用流水的扣费金额与账务流水逐笔核对。"""
    b = datetime.now(UTC) - timedelta(minutes=5)
    a = b - timedelta(hours=hours)
    async with SessionLocal() as s:
        rows = (await s.execute(text("""
            SELECT c.request_id, c.user_id, c.wallet_amount, c.package_tokens,
                   COALESCE(-SUM(l.amount) FILTER (WHERE l.bucket_type='wallet'),0) AS lw,
                   COALESCE(-SUM(l.amount) FILTER (WHERE l.bucket_type='package'),0) AS lp
            FROM call_log c LEFT JOIN ledger_entry l ON l.biz_type='consume' AND l.biz_id=c.request_id
            WHERE c.created_at >= :a AND c.created_at < :b AND (c.wallet_amount > 0 OR c.package_tokens > 0)
            GROUP BY c.request_id, c.user_id, c.wallet_amount, c.package_tokens"""), {"a": a, "b": b})).mappings().all()
        sums = (await s.execute(text("""
            SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(wallet_amount),0) AS wallet,
                   COALESCE(SUM(cost),0) AS cost FROM call_log WHERE created_at >= :a AND created_at < :b"""),
            {"a": a, "b": b})).mappings().one()
    diffs = [{"request_id": r["request_id"], "user_id": r["user_id"], "call_wallet": r["wallet_amount"],
              "ledger_wallet": int(r["lw"]), "call_pkg": r["package_tokens"], "ledger_pkg": int(r["lp"])}
             for r in rows if r["wallet_amount"] != int(r["lw"]) or r["package_tokens"] != int(r["lp"])]
    summary = {k: int(v) for k, v in sums.items()}
    return await _report("calllog_vs_ledger", len(rows), diffs, summary, (a, b))


async def recon_redis_vs_db() -> ReconReport:
    """热数据与 PG 核对：仅在计量流无积压时进行，差异提示管理员一键重建。"""
    try:
        groups = await redis.xinfo_groups(USAGE_STREAM)
        lag = sum(int(g.get("pending", 0)) + int(g.get("lag") or 0) for g in groups)
    except Exception:  # noqa: BLE001
        lag = -1
    if lag != 0:
        return await _report("redis_vs_db", 0, [], {"skipped": True, "reason": f"计量流存在积压（{lag}）"})
    async with SessionLocal() as s:
        rows = (await s.execute(text("""
            SELECT w.user_id, w.balance FROM wallet w
            WHERE NOT EXISTS (SELECT 1 FROM quota_outbox o WHERE o.user_id=w.user_id AND NOT o.applied)""")
        )).all()
    diffs = []
    checked = 0
    for uid, bal in rows:
        h = await redis.hgetall(k_wallet(uid))
        if not h:
            continue
        checked += 1
        hot = int(h.get("bal", 0)) + int(h.get("frz", 0))
        if hot != bal:
            diffs.append({"user_id": uid, "db": bal, "redis_available": int(h.get("bal", 0)),
                          "redis_frozen": int(h.get("frz", 0)), "diff": hot - bal})
    return await _report("redis_vs_db", checked, diffs, {"loaded_users": checked})


async def reconcile() -> None:
    for fn in (recon_wallet_vs_ledger, recon_calllog_vs_ledger, recon_redis_vs_db):
        r = await fn()
        log.info("recon %s status=%s checked=%s mismatched=%s", r.kind, r.status, r.checked, r.mismatched)
