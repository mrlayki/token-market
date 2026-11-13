from __future__ import annotations

import csv
import io
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text, update

from app.api.deps import DB, AdminUser, Paging, RootUser, audit, paginate
from app.core import runtime_settings as rs
from app.core.config import settings
from app.core.errors import AppError, NotFound
from app.core.redis import redis
from app.jobs import report_jobs
from app.models.billing import LedgerEntry, QuotaOutbox, Wallet
from app.models.channel import CH_ENABLED, Channel
from app.models.commerce import ORDER_FULFILLED, Order
from app.models.logs import AuditLog, CallLog, UsageHourly
from app.models.ops import Announcement, Notification, ReconReport, Statement
from app.models.user import User
from app.quota.engine import USAGE_STREAM
from app.schemas.common import OK, ORM, AdminCallLogOut, LedgerOut, StatementOut

router = APIRouter()


# ---------------------------------------------------------------- 数据看板
@router.get("/dashboard")
async def dashboard(_: AdminUser, s: DB, days: int = Query(7, ge=1, le=90)):
    now = datetime.now(UTC)
    since = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    U = UsageHourly
    sums = (func.coalesce(func.sum(U.requests), 0), func.coalesce(func.sum(U.failed), 0),
            func.coalesce(func.sum(U.prompt_tokens), 0), func.coalesce(func.sum(U.completion_tokens), 0),
            func.coalesce(func.sum(U.amount), 0), func.coalesce(func.sum(U.wallet_amount), 0),
            func.coalesce(func.sum(U.cost), 0), func.coalesce(func.sum(U.package_tokens), 0))

    def pack(r) -> dict:
        return {"requests": r[0], "failed": r[1], "prompt_tokens": r[2], "completion_tokens": r[3], "amount": r[4],
                "wallet_amount": r[5], "cost": r[6], "package_tokens": r[7], "gross_profit": r[4] - r[6]}

    total = pack((await s.execute(select(*sums).where(U.hour >= since))).one())
    today_s = pack((await s.execute(select(*sums).where(U.hour >= today))).one())
    bucket = func.date_trunc("hour" if days == 1 else "day", U.hour).label("t")
    trend = [{"t": r[0].isoformat(), **pack(r[1:])} for r in (await s.execute(
        select(bucket, *sums).where(U.hour >= since).group_by(bucket).order_by(bucket))).all()]
    top_models = [{"model": r[0], **pack(r[1:])} for r in (await s.execute(
        select(U.model, *sums).where(U.hour >= since).group_by(U.model).order_by(func.sum(U.amount).desc()).limit(10))).all()]
    top_users = [{"user_id": r[0], "username": r[1], **pack(r[2:])} for r in (await s.execute(
        select(U.user_id, User.username, *sums).join(User, User.id == U.user_id).where(U.hour >= since)
        .group_by(U.user_id, User.username).order_by(func.sum(U.amount).desc()).limit(10))).all()]
    top_channels = [{"channel_id": r[0], "name": r[1], **pack(r[2:])} for r in (await s.execute(
        select(U.channel_id, Channel.name, *sums).join(Channel, Channel.id == U.channel_id).where(U.hour >= since)
        .group_by(U.channel_id, Channel.name).order_by(func.sum(U.amount).desc()).limit(10))).all()]
    revenue = (await s.execute(select(func.coalesce(func.sum(Order.pay_amount), 0), func.count()).where(
        Order.status == ORDER_FULFILLED, Order.paid_at >= since))).one()
    revenue_today = (await s.execute(select(func.coalesce(func.sum(Order.pay_amount), 0)).where(
        Order.status == ORDER_FULFILLED, Order.paid_at >= today))).scalar()
    users = (await s.execute(select(func.count(), func.count().filter(User.created_at >= today)).select_from(User))).one()
    balance_total = (await s.execute(select(func.coalesce(func.sum(Wallet.balance), 0)))).scalar()
    ch = (await s.execute(select(func.count(), func.count().filter(Channel.status == CH_ENABLED)).select_from(Channel))).one()
    minute_ago = now - timedelta(minutes=1)
    rpm = (await s.execute(select(func.count(), func.coalesce(func.sum(CallLog.prompt_tokens + CallLog.completion_tokens), 0))
                           .where(CallLog.created_at >= minute_ago))).one()
    unread = (await s.execute(select(func.count()).select_from(Notification).where(
        Notification.user_id.is_(None), Notification.read.is_(False)))).scalar()
    return {
        "range_days": days, "total": total, "today": today_s, "trend": trend, "top_models": top_models,
        "top_users": top_users, "top_channels": top_channels,
        "orders": {"paid_amount": revenue[0], "paid_count": revenue[1], "paid_amount_today": revenue_today},
        "users": {"total": users[0], "new_today": users[1]}, "wallet_balance_total": balance_total,
        "channels": {"total": ch[0], "enabled": ch[1]}, "realtime": {"rpm": rpm[0], "tpm": rpm[1]},
        "unread_notifications": unread,
    }


# ---------------------------------------------------------------- 日志
def _log_query(start, end, user_id, model, channel_id, status, request_id, token_name):
    end = end or datetime.now(UTC) + timedelta(minutes=1)
    start = start or end - timedelta(days=7)
    q = select(CallLog).where(CallLog.created_at >= start, CallLog.created_at < end)
    for col, v in ((CallLog.user_id, user_id), (CallLog.model, model), (CallLog.channel_id, channel_id),
                   (CallLog.status, status), (CallLog.request_id, request_id), (CallLog.token_name, token_name)):
        if v not in (None, ""):
            q = q.where(col == v)
    return q


@router.get("/logs")
async def call_logs(_: AdminUser, s: DB, paging: Paging, start: datetime | None = None, end: datetime | None = None,
                    user_id: int | None = None, model: str | None = None, channel_id: int | None = None,
                    status: str | None = None, request_id: str | None = None, token_name: str | None = None):
    q = _log_query(start, end, user_id, model, channel_id, status, request_id, token_name)
    page = await paginate(s, q.order_by(CallLog.created_at.desc()), paging)
    uids = {r.user_id for r in page["items"]}
    names = dict((await s.execute(select(User.id, User.username).where(User.id.in_(uids)))).all()) if uids else {}
    page["items"] = [{**AdminCallLogOut.model_validate(r).model_dump(), "username": names.get(r.user_id, "")}
                     for r in page["items"]]
    sub = q.subquery()
    q_sum = select(func.count(), func.coalesce(func.sum(sub.c.amount), 0), func.coalesce(func.sum(sub.c.cost), 0),
                   func.coalesce(func.sum(sub.c.prompt_tokens), 0), func.coalesce(func.sum(sub.c.completion_tokens), 0))
    c = (await s.execute(q_sum)).one()
    page["summary"] = {"count": c[0], "amount": c[1], "cost": c[2], "prompt_tokens": c[3], "completion_tokens": c[4]}
    return page


@router.get("/logs/export")
async def export_logs(_: AdminUser, s: DB, start: datetime | None = None, end: datetime | None = None,
                      user_id: int | None = None, model: str | None = None, channel_id: int | None = None,
                      status: str | None = None, request_id: str | None = None, token_name: str | None = None):
    q = _log_query(start, end, user_id, model, channel_id, status, request_id, token_name).order_by(CallLog.created_at).limit(200_000)

    async def gen():
        buf = io.StringIO()
        w = csv.writer(buf)
        cols = ["created_at", "request_id", "user_id", "token_name", "model", "upstream_model", "channel_id", "status",
                "prompt_tokens", "completion_tokens", "cache_read_tokens", "usage_estimated", "amount_yuan",
                "wallet_yuan", "package_tokens", "cost_yuan", "duration_ms"]
        w.writerow(cols)
        yield "﻿" + buf.getvalue()
        result = await s.stream(q)
        async for (r,) in result:
            buf.seek(0)
            buf.truncate()
            w.writerow([r.created_at.isoformat(), r.request_id, r.user_id, r.token_name, r.model, r.upstream_model,
                        r.channel_id, r.status, r.prompt_tokens, r.completion_tokens, r.cache_read_tokens,
                        r.usage_estimated, r.amount / 1e6, r.wallet_amount / 1e6, r.package_tokens, r.cost / 1e6,
                        r.duration_ms])
            yield buf.getvalue()

    return StreamingResponse(gen(), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=call_logs.csv"})


@router.get("/ledger")
async def ledger(_: AdminUser, s: DB, paging: Paging, user_id: int | None = None, biz_type: str | None = None,
                 bucket_type: str | None = None, biz_id: str | None = None):
    q = select(LedgerEntry)
    for col, v in ((LedgerEntry.user_id, user_id), (LedgerEntry.biz_type, biz_type),
                   (LedgerEntry.bucket_type, bucket_type), (LedgerEntry.biz_id, biz_id)):
        if v not in (None, ""):
            q = q.where(col == v)
    page = await paginate(s, q.order_by(LedgerEntry.id.desc()), paging)
    page["items"] = [LedgerOut.model_validate(r) for r in page["items"]]
    return page


class AuditOut(ORM):
    id: int
    operator_id: int | None
    operator_name: str
    action: str
    target_type: str
    target_id: str
    detail: dict
    ip: str
    created_at: datetime


@router.get("/audit-logs")
async def audit_logs(_: AdminUser, s: DB, paging: Paging, action: str | None = None, operator_id: int | None = None):
    q = select(AuditLog)
    if action:
        q = q.where(AuditLog.action.ilike(f"{action}%"))
    if operator_id:
        q = q.where(AuditLog.operator_id == operator_id)
    page = await paginate(s, q.order_by(AuditLog.id.desc()), paging)
    page["items"] = [AuditOut.model_validate(r) for r in page["items"]]
    return page


# ---------------------------------------------------------------- 账单 / 对账
@router.get("/statements")
async def statements(_: AdminUser, s: DB, paging: Paging, period_type: Literal["day", "month"] = "day",
                     user_id: int | None = None):
    q = select(Statement).where(Statement.period_type == period_type)
    if user_id:
        q = q.where(Statement.user_id == user_id)
    page = await paginate(s, q.order_by(Statement.period_start.desc(), Statement.user_id), paging)
    page["items"] = [StatementOut.model_validate(r) for r in page["items"]]
    return page


class ReconOut(ORM):
    id: int
    kind: str
    status: str
    period_start: datetime | None
    period_end: datetime | None
    checked: int
    mismatched: int
    summary: dict
    diffs: list
    resolved: bool
    created_at: datetime


@router.get("/recon")
async def recon_reports(_: AdminUser, s: DB, paging: Paging, kind: str | None = None, status: str | None = None):
    q = select(ReconReport)
    if kind:
        q = q.where(ReconReport.kind == kind)
    if status:
        q = q.where(ReconReport.status == status)
    page = await paginate(s, q.order_by(ReconReport.id.desc()), paging)
    page["items"] = [ReconOut.model_validate(r) for r in page["items"]]
    return page


class ReconRunIn(BaseModel):
    kind: Literal["ledger_vs_balance", "calllog_vs_ledger", "redis_vs_db", "all"] = "all"


@router.post("/recon/run")
async def recon_run(body: ReconRunIn, request: Request, user: AdminUser, s: DB):
    fns = {"ledger_vs_balance": report_jobs.recon_wallet_vs_ledger,
           "calllog_vs_ledger": report_jobs.recon_calllog_vs_ledger, "redis_vs_db": report_jobs.recon_redis_vs_db}
    targets = list(fns.values()) if body.kind == "all" else [fns[body.kind]]
    out = [ReconOut.model_validate(await fn()) for fn in targets]
    await audit(s, request, user, "recon.run", "recon", body.kind)
    await s.commit()
    return out


@router.post("/recon/{rid}/resolve", response_model=OK)
async def recon_resolve(rid: int, request: Request, user: AdminUser, s: DB):
    r = await s.execute(update(ReconReport).where(ReconReport.id == rid).values(resolved=True, resolved_by=user.id))
    if not r.rowcount:
        raise NotFound()
    await audit(s, request, user, "recon.resolve", "recon", rid)
    await s.commit()
    return OK()


class StatementRunIn(BaseModel):
    period_type: Literal["day", "month"]
    period_start: str  # YYYY-MM-DD


@router.post("/statements/build", response_model=OK)
async def build_statements(body: StatementRunIn, request: Request, user: RootUser, s: DB):
    from datetime import date

    d = date.fromisoformat(body.period_start)
    if body.period_type == "month":
        d = d.replace(day=1)
    n = await report_jobs.build_statement(body.period_type, d)
    await audit(s, request, user, "statement.build", "statement", body.period_start, body.model_dump())
    await s.commit()
    return OK(message=f"生成 {n} 条账单（已存在的不会覆盖）")


# ---------------------------------------------------------------- 系统设置
@router.get("/settings")
async def get_settings(_: RootUser):
    values = await rs.get_all()
    return [{"key": k, "value": values[k], "default": d, "group": g, "description": desc}
            for k, (d, g, desc) in rs.DEFAULTS.items()]


class SettingsIn(BaseModel):
    values: dict[str, Any]


@router.put("/settings", response_model=OK)
async def put_settings(body: SettingsIn, request: Request, user: RootUser, s: DB):
    try:
        await rs.update(body.values)
    except (KeyError, ValueError) as e:
        raise AppError(str(e)) from e
    await audit(s, request, user, "settings.update", "settings", "", body.values)
    await s.commit()
    return OK(message="已保存")


# ---------------------------------------------------------------- 公告 / 通知
class AnnouncementIn(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    content: str
    level: Literal["info", "success", "warning", "error"] = "info"
    published: bool = True
    pinned: bool = False


class AnnouncementOut(AnnouncementIn, ORM):
    id: int
    created_at: datetime


@router.get("/announcements", response_model=list[AnnouncementOut])
async def announcements(_: AdminUser, s: DB):
    return (await s.execute(select(Announcement).order_by(Announcement.id.desc()))).scalars().all()


@router.post("/announcements", response_model=AnnouncementOut)
async def create_announcement(body: AnnouncementIn, request: Request, user: AdminUser, s: DB):
    a = Announcement(**body.model_dump())
    s.add(a)
    await s.flush()
    await audit(s, request, user, "announcement.create", "announcement", a.id)
    await s.commit()
    return a


@router.put("/announcements/{aid}", response_model=AnnouncementOut)
async def update_announcement(aid: int, body: AnnouncementIn, request: Request, user: AdminUser, s: DB):
    a = await s.get(Announcement, aid)
    if a is None:
        raise NotFound()
    for k, v in body.model_dump().items():
        setattr(a, k, v)
    await audit(s, request, user, "announcement.update", "announcement", aid)
    await s.commit()
    return a


@router.delete("/announcements/{aid}", response_model=OK)
async def delete_announcement(aid: int, request: Request, user: AdminUser, s: DB):
    a = await s.get(Announcement, aid)
    if a:
        await s.delete(a)
        await audit(s, request, user, "announcement.delete", "announcement", aid)
        await s.commit()
    return OK()


@router.get("/notifications")
async def notifications(_: AdminUser, s: DB, paging: Paging, unread: bool = False):
    q = select(Notification).where(Notification.user_id.is_(None))
    if unread:
        q = q.where(Notification.read.is_(False))
    page = await paginate(s, q.order_by(Notification.id.desc()), paging)
    page["items"] = [{"id": n.id, "kind": n.kind, "title": n.title, "content": n.content, "read": n.read,
                      "created_at": n.created_at} for n in page["items"]]
    return page


@router.post("/notifications/{nid}/read", response_model=OK)
async def read_one(nid: int, _: AdminUser, s: DB):
    await s.execute(update(Notification).where(Notification.id == nid, Notification.user_id.is_(None)).values(read=True))
    await s.commit()
    return OK()


@router.post("/notifications/read-all", response_model=OK)
async def read_all(_: AdminUser, s: DB):
    await s.execute(update(Notification).where(Notification.user_id.is_(None), Notification.read.is_(False))
                    .values(read=True))
    await s.commit()
    return OK()


# ---------------------------------------------------------------- 系统状态
@router.get("/system/health")
async def system_health(_: AdminUser, s: DB):
    out: dict[str, Any] = {}
    try:
        await s.execute(text("SELECT 1"))
        out["postgres"] = {"ok": True}
    except Exception as e:  # noqa: BLE001
        out["postgres"] = {"ok": False, "error": str(e)}
    try:
        info = await redis.info("memory")
        groups = await redis.xinfo_groups(USAGE_STREAM)
        out["redis"] = {"ok": True, "used_memory_human": info.get("used_memory_human")}
        out["usage_stream"] = {"length": await redis.xlen(USAGE_STREAM),
                               "groups": [{"name": g["name"], "pending": g["pending"], "lag": g.get("lag")} for g in groups],
                               "dlq": await redis.xlen(USAGE_STREAM + ":dlq")}
        out["reservations_inflight"] = await redis.zcard("tm:rsv:deadline")
    except Exception as e:  # noqa: BLE001
        out["redis"] = {"ok": False, "error": str(e)}
    out["outbox_pending"] = (await s.execute(select(func.count()).select_from(QuotaOutbox)
                                             .where(QuotaOutbox.applied.is_(False)))).scalar()
    out["config"] = {"quota_mode": settings.quota_mode, "redis_fail_mode": settings.redis_fail_mode}
    return out

