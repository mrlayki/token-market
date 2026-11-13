"""把一条计量事件幂等落库：调用流水 + 账务流水 + 钱包/套餐/令牌/渠道统计 + 小时聚合。

幂等闸门：call_log (request_id, created_at) 唯一。事件重复投递时插入冲突，直接跳过后续写入。
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing import (
    BIZ_CONSUME,
    BUCKET_PACKAGE,
    BUCKET_WALLET,
    PKG_ACTIVE,
    PKG_EXHAUSTED,
    LedgerEntry,
    UserPackage,
    Wallet,
)
from app.models.channel import Channel, ChannelKey
from app.models.logs import CallLog, UsageHourly
from app.models.token import ApiToken
from app.models.user import User


async def persist_usage_event(s: AsyncSession, ev: dict, *, wallet_applied: bool = False) -> bool:
    """返回 True 表示本次写入，False 表示重复事件已跳过。调用方负责提交事务。"""
    created = datetime.fromtimestamp(ev["ts"], UTC)
    usage = ev.get("usage") or {}
    st = ev.get("settle") or {}
    wallet_amt = int(st.get("wallet") or 0)
    pkgs = [p for p in (st.get("pkgs") or []) if isinstance(p, dict)]
    pkg_tokens = sum(int(p.get("used") or 0) for p in pkgs)
    uid = int(ev["uid"])

    stmt = insert(CallLog).values(
        created_at=created, request_id=ev["rid"], user_id=uid, token_id=ev.get("token_id"),
        token_name=ev.get("token_name") or "", channel_id=ev.get("channel_id"), channel_key_id=ev.get("key_id"),
        model=ev["model"], upstream_model=ev.get("upstream_model") or "", group=ev.get("group") or "",
        endpoint=ev.get("endpoint") or "chat", is_stream=bool(ev.get("stream")), status=ev["status"],
        http_status=int(ev.get("http_status") or 0), error=ev.get("error") or "",
        prompt_tokens=int(usage.get("prompt_tokens") or 0), completion_tokens=int(usage.get("completion_tokens") or 0),
        cache_read_tokens=int(usage.get("cache_read_tokens") or 0),
        cache_write_tokens=int(usage.get("cache_write_tokens") or 0),
        usage_estimated=bool(usage.get("estimated")), amount=int(ev.get("amount") or 0), wallet_amount=wallet_amt,
        package_tokens=pkg_tokens, cost=int(ev.get("cost") or 0),
        price_snapshot={**(ev.get("price") or {}), "shortfall": int(st.get("shortfall") or 0),
                        "packages": pkgs},
        retry_count=int(ev.get("retry") or 0), first_token_ms=int(ev.get("ftm") or 0),
        duration_ms=int(ev.get("dur") or 0), client_ip=ev.get("ip") or "",
    ).on_conflict_do_nothing(index_elements=["request_id", "created_at"]).returning(CallLog.id)
    inserted = (await s.execute(stmt)).scalar_one_or_none()
    if inserted is None:
        return False

    # 账务流水（只记录真实发生的扣减）
    if wallet_amt:
        await s.execute(insert(LedgerEntry).values(
            user_id=uid, bucket_type=BUCKET_WALLET, bucket_key="wallet", amount=-wallet_amt,
            biz_type=BIZ_CONSUME, biz_id=ev["rid"], remark=ev["model"], created_at=created,
        ).on_conflict_do_nothing(constraint="uq_ledger_idem"))
        if not wallet_applied:
            await s.execute(update(Wallet).where(Wallet.user_id == uid).values(
                balance=Wallet.balance - wallet_amt, total_consumed=Wallet.total_consumed + wallet_amt))
        else:
            await s.execute(update(Wallet).where(Wallet.user_id == uid).values(
                total_consumed=Wallet.total_consumed + wallet_amt))
        if ev.get("token_id"):
            await s.execute(update(ApiToken).where(ApiToken.id == ev["token_id"]).values(
                used_quota=ApiToken.used_quota + wallet_amt))
    for p in pkgs:
        used = int(p.get("used") or 0)
        if not used:
            continue
        pid = int(p["id"])
        await s.execute(insert(LedgerEntry).values(
            user_id=uid, bucket_type=BUCKET_PACKAGE, bucket_key=f"pkg:{pid}", package_id=pid, amount=-used,
            biz_type=BIZ_CONSUME, biz_id=ev["rid"], remark=ev["model"], created_at=created,
        ).on_conflict_do_nothing(constraint="uq_ledger_idem"))
        await s.execute(update(UserPackage).where(UserPackage.id == pid).values(
            remaining_tokens=UserPackage.remaining_tokens - used))
        await s.execute(update(UserPackage).where(
            UserPackage.id == pid, UserPackage.remaining_tokens <= 0, UserPackage.status == PKG_ACTIVE
        ).values(status=PKG_EXHAUSTED))

    await s.execute(update(User).where(User.id == uid).values(request_count=User.request_count + 1))
    if ev.get("token_id"):
        await s.execute(update(ApiToken).where(ApiToken.id == ev["token_id"],
                                               (ApiToken.accessed_at.is_(None)) | (ApiToken.accessed_at < created))
                        .values(accessed_at=created))
    if ev.get("channel_id"):
        await s.execute(update(Channel).where(Channel.id == ev["channel_id"]).values(
            used_amount=Channel.used_amount + int(ev.get("amount") or 0),
            request_count=Channel.request_count + 1))
    if ev.get("key_id"):
        await s.execute(update(ChannelKey).where(ChannelKey.id == ev["key_id"]).values(
            request_count=ChannelKey.request_count + 1))

    hour = created.replace(minute=0, second=0, microsecond=0)
    failed = 1 if ev["status"] == "failed" else 0
    vals = dict(
        requests=1, failed=failed, prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        cache_tokens=int(usage.get("cache_read_tokens") or 0), amount=int(ev.get("amount") or 0),
        wallet_amount=wallet_amt, package_tokens=pkg_tokens, cost=int(ev.get("cost") or 0),
    )
    ins = insert(UsageHourly).values(hour=hour, user_id=uid, token_id=ev.get("token_id") or 0,
                                     channel_id=ev.get("channel_id") or 0, model=ev["model"], **vals)
    await s.execute(ins.on_conflict_do_update(
        constraint="uq_usage_hourly_dim",
        set_={k: getattr(UsageHourly, k) + getattr(ins.excluded, k) for k in vals},
    ))
    return True
