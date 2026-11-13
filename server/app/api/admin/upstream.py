"""上游对账：账单导入、比对、余额快照。"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import delete, select

from app.api.deps import DB, AdminUser, Paging, audit, paginate
from app.billing import upstream_recon as ur
from app.core.errors import AppError
from app.models.channel import Channel, ChannelBalanceSnapshot, UpstreamBill
from app.schemas.common import OK, ORM

router = APIRouter(prefix="/upstream")


class BillOut(ORM):
    id: int
    channel_id: int
    bill_date: date
    model: str
    requests: int
    input_tokens: int
    output_tokens: int
    cache_tokens: int
    amount: int
    raw_amount: Decimal
    currency: str
    source: str
    batch_no: str
    created_at: datetime


class SnapshotOut(ORM):
    id: int
    channel_id: int
    balance: Decimal
    currency: str
    taken_at: datetime
    note: str


@router.get("/channels")
async def recon_channels(_: AdminUser, s: DB):
    """可对账渠道列表，标记是否支持余额快照。"""
    rows = (await s.execute(select(Channel).order_by(Channel.id))).scalars().all()
    return [{"id": c.id, "name": c.name, "type": c.type, "status": c.status,
             "balance_supported": c.type in ur.BALANCE_TYPES} for c in rows]


@router.get("/bills/template")
async def template(_: AdminUser):
    return Response("﻿" + ur.CSV_TEMPLATE, media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=upstream_bill_template.csv"})


@router.post("/bills/import")
async def import_bills(request: Request, user: AdminUser, s: DB, channel_id: int = Form(...),
                       currency: str = Form("CNY"), file: UploadFile = File(...)):
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise AppError("文件不能超过 10MB")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("gbk", errors="replace")
    res = await ur.import_bill_csv(channel_id, text, currency)
    await audit(s, request, user, "upstream.import", "channel", channel_id,
                {"file": file.filename, "imported": res["imported"], "errors": len(res["errors"])})
    await s.commit()
    return res


@router.get("/bills")
async def bills(_: AdminUser, s: DB, paging: Paging, channel_id: int | None = None, start: date | None = None,
                end: date | None = None):
    q = select(UpstreamBill)
    if channel_id:
        q = q.where(UpstreamBill.channel_id == channel_id)
    if start:
        q = q.where(UpstreamBill.bill_date >= start)
    if end:
        q = q.where(UpstreamBill.bill_date <= end)
    page = await paginate(s, q.order_by(UpstreamBill.bill_date.desc(), UpstreamBill.model), paging)
    page["items"] = [BillOut.model_validate(b) for b in page["items"]]
    return page


@router.delete("/bills", response_model=OK)
async def delete_bills(request: Request, user: AdminUser, s: DB, channel_id: int, start: date, end: date):
    r = await s.execute(delete(UpstreamBill).where(UpstreamBill.channel_id == channel_id,
                                                   UpstreamBill.bill_date >= start, UpstreamBill.bill_date <= end))
    await audit(s, request, user, "upstream.delete_bills", "channel", channel_id,
                {"start": start.isoformat(), "end": end.isoformat(), "rows": r.rowcount})
    await s.commit()
    return OK(message=f"已删除 {r.rowcount} 行")


@router.get("/compare")
async def compare(_: AdminUser, channel_id: int, start: date, end: date):
    if (end - start).days > 92:
        raise AppError("单次最多比对 93 天")
    res = await ur.compare_bill(channel_id, start, end)
    return {"rows": res.rows, "summary": res.summary, "mismatched": res.mismatched}


class ReconIn(BaseModel):
    channel_id: int
    start: date
    end: date


@router.post("/recon")
async def recon(body: ReconIn, request: Request, user: AdminUser, s: DB):
    r = await ur.reconcile_bill(body.channel_id, body.start, body.end)
    await audit(s, request, user, "upstream.recon", "channel", body.channel_id, body.model_dump(mode="json"))
    await s.commit()
    return {"id": r.id, "status": r.status, "checked": r.checked, "mismatched": r.mismatched, "summary": r.summary}


@router.get("/snapshots")
async def snapshots(_: AdminUser, s: DB, paging: Paging, channel_id: int):
    q = select(ChannelBalanceSnapshot).where(ChannelBalanceSnapshot.channel_id == channel_id)
    page = await paginate(s, q.order_by(ChannelBalanceSnapshot.taken_at.desc()), paging)
    page["items"] = [SnapshotOut.model_validate(x) for x in page["items"]]
    return page


class SnapIn(BaseModel):
    channel_id: int


@router.post("/snapshots", response_model=SnapshotOut)
async def take_snapshot(body: SnapIn, _: AdminUser):
    return await ur.take_balance_snapshot(body.channel_id)


@router.get("/balance-compare")
async def balance_compare(_: AdminUser, channel_id: int, from_id: int, to_id: int):
    return await ur.compare_balance(channel_id, from_id, to_id)


class BalanceReconIn(BaseModel):
    channel_id: int
    from_id: int
    to_id: int


@router.post("/balance-recon")
async def balance_recon(body: BalanceReconIn, request: Request, user: AdminUser, s: DB):
    r = await ur.reconcile_balance(body.channel_id, body.from_id, body.to_id)
    await audit(s, request, user, "upstream.balance_recon", "channel", body.channel_id, body.model_dump())
    await s.commit()
    return {"id": r.id, "status": r.status, "summary": r.summary}
