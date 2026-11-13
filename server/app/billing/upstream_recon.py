"""上游对账：平台调用记录 ↔ 厂商账单 / 厂商余额变化。

两种数据源：
  1. 账单导入（通用）：按渠道导入厂商账单 CSV，与平台按「本地日期 × 上游模型」聚合的记录逐行比对。
  2. 余额快照（有余额接口的厂商，如 DeepSeek）：两次快照之间余额减少量 = 上游实际扣费，
     与平台在同一时间窗内对该渠道核算的成本比对。
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert

from app.core import runtime_settings as rs
from app.core.db import SessionLocal
from app.core.errors import AppError, NotFound
from app.models.channel import Channel, ChannelBalanceSnapshot, UpstreamBill
from app.models.logs import CallLog
from app.models.ops import ReconReport

MICRO = Decimal(1_000_000)

CSV_TEMPLATE = (
    "date,model,requests,input_tokens,output_tokens,cache_tokens,amount,currency\n"
    "2026-11-12,deepseek-flash,1520,3200000,860000,1200000,13.85,CNY\n"
)
# 常见厂商导出列名的别名
ALIASES = {
    "date": ("date", "day", "bill_date", "日期", "start_time"),
    "model": ("model", "model_name", "模型"),
    "requests": ("requests", "request_count", "num_requests", "calls", "请求数"),
    "input_tokens": ("input_tokens", "prompt_tokens", "input", "输入tokens", "输入"),
    "output_tokens": ("output_tokens", "completion_tokens", "output", "输出tokens", "输出"),
    "cache_tokens": ("cache_tokens", "cached_tokens", "cache_read_tokens", "input_cached_tokens", "缓存命中"),
    "amount": ("amount", "cost", "fee", "金额", "费用"),
    "currency": ("currency", "币种"),
}


def _col(header: list[str], key: str) -> int | None:
    low = [h.strip().lower() for h in header]
    for alias in ALIASES[key]:
        if alias.lower() in low:
            return low.index(alias.lower())
    return None


def _int(v: str) -> int:
    v = (v or "").replace(",", "").strip()
    return int(Decimal(v)) if v else 0


async def _fx(currency: str) -> Decimal:
    if currency.upper() in ("", "CNY", "RMB"):
        return Decimal(1)
    if currency.upper() == "USD":
        return Decimal(str(await rs.get("recon.usd_cny_rate")))
    raise AppError(f"不支持的币种 {currency}（支持 CNY / USD）")


# ---------------------------------------------------------------- 账单导入
async def import_bill_csv(channel_id: int, content: str, default_currency: str = "CNY") -> dict:
    async with SessionLocal() as s:
        if not await s.get(Channel, channel_id):
            raise NotFound("渠道不存在")
    reader = csv.reader(io.StringIO(content.lstrip("﻿")))
    rows = list(reader)
    if len(rows) < 2:
        raise AppError("CSV 为空")
    header = rows[0]
    idx = {k: _col(header, k) for k in ALIASES}
    if idx["date"] is None or idx["model"] is None:
        raise AppError("CSV 缺少 date / model 列，请参考模板")
    batch = datetime.now(UTC).strftime("U%Y%m%d%H%M%S")
    ok, errors = 0, []
    values = []
    for n, r in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in r):
            continue
        try:
            def get(k: str, row: list[str] = r) -> str:
                i = idx[k]
                return row[i] if i is not None and i < len(row) else ""

            d = date.fromisoformat(get("date").strip()[:10])
            currency = (get("currency") or default_currency).strip().upper() or "CNY"
            raw = Decimal(get("amount").replace(",", "").strip() or "0")
            amount = int((raw * await _fx(currency) * MICRO).to_integral_value(rounding=ROUND_HALF_UP))
            values.append(dict(channel_id=channel_id, bill_date=d, model=get("model").strip(),
                               requests=_int(get("requests")), input_tokens=_int(get("input_tokens")),
                               output_tokens=_int(get("output_tokens")), cache_tokens=_int(get("cache_tokens")),
                               amount=amount, raw_amount=raw, currency=currency, source="csv", batch_no=batch))
            ok += 1
        except (ValueError, InvalidOperation, AppError) as e:
            errors.append(f"第 {n} 行：{e}")
    if values:
        async with SessionLocal() as s:
            stmt = insert(UpstreamBill).values(values)
            stmt = stmt.on_conflict_do_update(constraint="uq_upstream_bill_row", set_={
                c: getattr(stmt.excluded, c) for c in ("requests", "input_tokens", "output_tokens", "cache_tokens",
                                                       "amount", "raw_amount", "currency", "source", "batch_no")})
            await s.execute(stmt)
            await s.commit()
    return {"imported": ok, "errors": errors[:50], "batch_no": batch}


# ---------------------------------------------------------------- 平台侧聚合
async def platform_daily(channel_id: int, start: date, end: date) -> dict[tuple[date, str], dict]:
    """平台记录按「对账时区的本地日期 × 上游模型」聚合（含失败但已产生 token 的调用）。"""
    tz = await rs.get("recon.timezone")
    a = datetime.combine(start, datetime.min.time(), ZoneInfo(tz))
    b = datetime.combine(end + timedelta(days=1), datetime.min.time(), ZoneInfo(tz))
    day = func.date(func.timezone(tz, CallLog.created_at)).label("d")
    mdl = func.coalesce(func.nullif(CallLog.upstream_model, ""), CallLog.model).label("m")
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(day, mdl, func.count(), func.sum(CallLog.prompt_tokens), func.sum(CallLog.completion_tokens),
                   func.sum(CallLog.cache_read_tokens), func.sum(CallLog.cost), func.sum(CallLog.amount),
                   func.count().filter(CallLog.usage_estimated.is_(True)))
            .where(CallLog.channel_id == channel_id, CallLog.created_at >= a, CallLog.created_at < b,
                   (CallLog.prompt_tokens + CallLog.completion_tokens) > 0)
            .group_by(day, mdl)
        )).all()
    return {(r[0], r[1]): {"requests": r[2], "input_tokens": int(r[3] or 0), "output_tokens": int(r[4] or 0),
                           "cache_tokens": int(r[5] or 0), "cost": int(r[6] or 0), "revenue": int(r[7] or 0),
                           "estimated": int(r[8] or 0)} for r in rows}


def _pct(a: int, b: int) -> float | None:
    if b == 0:
        return None if a == 0 else 100.0
    return round((a - b) / b * 100, 2)


@dataclass(slots=True)
class CompareResult:
    rows: list[dict]
    summary: dict
    mismatched: int


async def compare_bill(channel_id: int, start: date, end: date) -> CompareResult:
    tol = float(await rs.get("recon.tolerance_pct"))
    plat = await platform_daily(channel_id, start, end)
    async with SessionLocal() as s:
        bills = (await s.execute(select(UpstreamBill).where(
            UpstreamBill.channel_id == channel_id, UpstreamBill.bill_date >= start, UpstreamBill.bill_date <= end
        ))).scalars().all()
    up = {(b.bill_date, b.model): b for b in bills}
    keys = sorted(set(plat) | set(up), key=lambda k: (k[0], k[1]))
    rows, mism = [], 0
    tot = {"platform_cost": 0, "upstream_amount": 0, "platform_input": 0, "upstream_input": 0,
           "platform_output": 0, "upstream_output": 0}
    for k in keys:
        p = plat.get(k)
        u = up.get(k)
        row = {"date": k[0].isoformat(), "model": k[1],
               "platform": p, "upstream": {
                   "requests": u.requests, "input_tokens": u.input_tokens, "output_tokens": u.output_tokens,
                   "cache_tokens": u.cache_tokens, "amount": u.amount, "raw_amount": str(u.raw_amount),
                   "currency": u.currency} if u else None}
        if p and u:
            diffs = {
                "input_tokens": _pct(p["input_tokens"], u.input_tokens),
                "output_tokens": _pct(p["output_tokens"], u.output_tokens),
                "amount": _pct(p["cost"], u.amount),
                "requests": _pct(p["requests"], u.requests) if u.requests else None,
            }
            row["diff_pct"] = diffs
            bad = [k2 for k2, v in diffs.items() if v is not None and abs(v) > tol]
            row["status"] = "mismatch" if bad else "ok"
            row["mismatch_fields"] = bad
        else:
            row["status"] = "platform_only" if p else "upstream_only"
        if row["status"] != "ok":
            mism += 1
        if p:
            tot["platform_cost"] += p["cost"]
            tot["platform_input"] += p["input_tokens"]
            tot["platform_output"] += p["output_tokens"]
        if u:
            tot["upstream_amount"] += u.amount
            tot["upstream_input"] += u.input_tokens
            tot["upstream_output"] += u.output_tokens
        rows.append(row)
    tot["amount_diff"] = tot["platform_cost"] - tot["upstream_amount"]
    tot["amount_diff_pct"] = _pct(tot["platform_cost"], tot["upstream_amount"])
    tot["tolerance_pct"] = tol
    return CompareResult(rows=rows, summary=tot, mismatched=mism)


async def reconcile_bill(channel_id: int, start: date, end: date) -> ReconReport:
    res = await compare_bill(channel_id, start, end)
    async with SessionLocal() as s:
        ch = await s.get(Channel, channel_id)
        tz = ZoneInfo(await rs.get("recon.timezone"))
        r = ReconReport(
            kind="upstream_bill", status="ok" if res.mismatched == 0 and res.rows else ("mismatch" if res.rows else "error"),
            period_start=datetime.combine(start, datetime.min.time(), tz),
            period_end=datetime.combine(end + timedelta(days=1), datetime.min.time(), tz),
            checked=len(res.rows), mismatched=res.mismatched,
            summary={**res.summary, "channel_id": channel_id, "channel_name": ch.name if ch else "",
                     **({} if res.rows else {"reason": "所选范围内平台与上游均无数据"})},
            diffs=[x for x in res.rows if x["status"] != "ok"][:500])
        s.add(r)
        await s.commit()
        return r


# ---------------------------------------------------------------- 余额快照
async def take_balance_snapshot(channel_id: int) -> ChannelBalanceSnapshot:
    from app.channels.tester import query_balance

    res = await query_balance(channel_id)
    if not res.get("ok"):
        raise AppError(res.get("message") or "余额查询失败")
    async with SessionLocal() as s:
        snap = ChannelBalanceSnapshot(channel_id=channel_id, balance=Decimal(res["balance"]),
                                      currency=res.get("currency", ""), taken_at=datetime.now(UTC))
        s.add(snap)
        await s.commit()
        await s.refresh(snap)
        return snap


async def compare_balance(channel_id: int, from_id: int, to_id: int) -> dict:
    async with SessionLocal() as s:
        a = await s.get(ChannelBalanceSnapshot, from_id)
        b = await s.get(ChannelBalanceSnapshot, to_id)
        if not a or not b or a.channel_id != channel_id or b.channel_id != channel_id:
            raise NotFound("快照不存在")
        if a.taken_at > b.taken_at:
            a, b = b, a
        fx = await _fx(a.currency or "CNY")
        upstream = int(((a.balance - b.balance) * fx * MICRO).to_integral_value(rounding=ROUND_HALF_UP))
        agg = (await s.execute(select(
            func.count(), func.coalesce(func.sum(CallLog.cost), 0), func.coalesce(func.sum(CallLog.amount), 0),
            func.coalesce(func.sum(CallLog.prompt_tokens), 0), func.coalesce(func.sum(CallLog.completion_tokens), 0),
        ).where(and_(CallLog.channel_id == channel_id, CallLog.created_at >= a.taken_at,
                     CallLog.created_at < b.taken_at)))).one()
    tol = float(await rs.get("recon.tolerance_pct"))
    diff = int(agg[1]) - upstream
    pct = _pct(int(agg[1]), upstream)
    # 余额接口的精度（如 DeepSeek 只返回到分）：差额不超过一个精度单位时无法区分，视为一致并说明
    decimals = max(len(str(x).split(".")[1].rstrip("0")) if "." in str(x) else 0 for x in (a.balance, b.balance))
    decimals = max(decimals, 2)
    precision = int((Decimal(1).scaleb(-decimals) * fx * MICRO).to_integral_value())
    note = ""
    if upstream < 0:
        status, note = "mismatch", "上游余额增加，期间可能有充值，请选择不含充值的快照区间"
    elif pct is not None and abs(pct) <= tol:
        status = "ok"
    elif abs(diff) <= precision:
        status = "ok"
        note = (f"差额在余额接口精度（{Decimal(1).scaleb(-decimals)} {a.currency or 'CNY'}）以内，"
                "区间太短无法精确比对，建议选择一天以上的快照区间")
    else:
        status = "mismatch"
    return {
        "channel_id": channel_id, "from": {"id": a.id, "taken_at": a.taken_at.isoformat(), "balance": str(a.balance)},
        "to": {"id": b.id, "taken_at": b.taken_at.isoformat(), "balance": str(b.balance)}, "currency": a.currency,
        "upstream_spend": upstream, "platform_cost": int(agg[1]), "platform_revenue": int(agg[2]),
        "requests": int(agg[0]), "input_tokens": int(agg[3]), "output_tokens": int(agg[4]),
        "diff": diff, "diff_pct": pct, "tolerance_pct": tol, "status": status, "note": note,
    }


async def reconcile_balance(channel_id: int, from_id: int, to_id: int) -> ReconReport:
    res = await compare_balance(channel_id, from_id, to_id)
    async with SessionLocal() as s:
        ch = await s.get(Channel, channel_id)
        r = ReconReport(kind="upstream_balance", status=res["status"],
                        period_start=datetime.fromisoformat(res["from"]["taken_at"]),
                        period_end=datetime.fromisoformat(res["to"]["taken_at"]), checked=res["requests"],
                        mismatched=0 if res["status"] == "ok" else 1,
                        summary={**res, "channel_name": ch.name if ch else ""},
                        diffs=[] if res["status"] == "ok" else [res])
        s.add(r)
        await s.commit()
        return r


BALANCE_TYPES = ("deepseek",)


async def snapshot_all_balances() -> int:
    """worker 周期任务：为支持余额查询的启用渠道记录快照。"""
    async with SessionLocal() as s:
        ids = list((await s.execute(select(Channel.id).where(Channel.type.in_(BALANCE_TYPES),
                                                             Channel.status == 1))).scalars())
    n = 0
    for cid in ids:
        try:
            await take_balance_snapshot(cid)
            n += 1
        except AppError:
            continue
    return n
