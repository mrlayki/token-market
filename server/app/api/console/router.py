"""用户控制台接口。"""

from __future__ import annotations

import hmac
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from typing import Literal

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select, update

from app.api.deps import DB, CurrentUser, Paging, client_ip, paginate
from app.commerce import orders as order_svc
from app.commerce.payments.mock import MockProvider
from app.commerce.redemption import redeem as redeem_code
from app.core.config import settings
from app.core.errors import AppError, NotFound
from app.core.security import generate_api_key, hash_api_key, mask_api_key
from app.models.billing import PKG_ACTIVE, LedgerEntry, UserPackage, Wallet
from app.models.commerce import ORDER_PENDING, Order
from app.models.logs import CallLog, UsageHourly
from app.models.ops import Notification, Statement
from app.models.token import TOKEN_DISABLED, TOKEN_ENABLED, ApiToken
from app.models.user import UserGroup
from app.quota.service import get_engine
from app.relay.auth import invalidate_token_cache
from app.schemas.common import (
    OK,
    CallLogOut,
    LedgerOut,
    OrderOut,
    Page,
    StatementOut,
    TokenOut,
    UserPackageOut,
)

router = APIRouter(prefix="/api/console", tags=["console"])
MAX_TOKENS_PER_USER = 100
PLAYGROUND_TOKEN_NAME = "操练场"


# ---------------------------------------------------------------- 概览
async def _live_balance(uid: int, pg_balance: int) -> dict:
    """优先使用 Redis 热数据（实时），不可用时回退到 PG。"""
    try:
        b = await get_engine().balance(uid)
        if b["loaded"]:
            return {"balance": b["bal"], "frozen": b["frz"], "realtime": True}
    except Exception:  # noqa: BLE001
        pass
    return {"balance": pg_balance, "frozen": 0, "realtime": False}


@router.get("/overview")
async def overview(user: CurrentUser, s: DB):
    w = await s.get(Wallet, user.id)
    bal = await _live_balance(user.id, w.balance if w else 0)
    now = datetime.now(UTC)
    pkgs = (await s.execute(select(UserPackage).where(
        UserPackage.user_id == user.id, UserPackage.status == PKG_ACTIVE, UserPackage.expires_at > now
    ).order_by(UserPackage.expires_at))).scalars().all()
    try:
        live_pkgs = (await get_engine().balance(user.id))["pkgs"]
    except Exception:  # noqa: BLE001
        live_pkgs = {}
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    agg = (await s.execute(select(
        func.coalesce(func.sum(UsageHourly.requests), 0), func.coalesce(func.sum(UsageHourly.prompt_tokens), 0),
        func.coalesce(func.sum(UsageHourly.completion_tokens), 0), func.coalesce(func.sum(UsageHourly.wallet_amount), 0),
        func.coalesce(func.sum(UsageHourly.package_tokens), 0),
    ).where(UsageHourly.user_id == user.id, UsageHourly.hour >= today))).one()
    tokens_count = (await s.execute(select(func.count()).select_from(ApiToken).where(ApiToken.user_id == user.id))).scalar()
    return {
        "wallet": {**bal, "total_recharged": w.total_recharged if w else 0,
                   "total_consumed": w.total_consumed if w else 0},
        "packages": [{"id": p.id, "name": p.name, "total_tokens": p.total_tokens,
                      "remaining_tokens": live_pkgs.get(p.id, p.remaining_tokens), "expires_at": p.expires_at,
                      "scope_type": p.scope_type, "scope_values": p.scope_values} for p in pkgs],
        "today": {"requests": agg[0], "prompt_tokens": agg[1], "completion_tokens": agg[2],
                  "wallet_amount": agg[3], "package_tokens": agg[4]},
        "token_count": tokens_count, "group": user.group, "request_count": user.request_count,
    }


@router.get("/usage/stats")
async def usage_stats(user: CurrentUser, s: DB, days: int = Query(7, ge=1, le=90)):
    since = (datetime.now(UTC) - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    day = func.date_trunc("day", UsageHourly.hour).label("day")
    cond = and_(UsageHourly.user_id == user.id, UsageHourly.hour >= since)
    trend = (await s.execute(select(
        day, func.sum(UsageHourly.requests), func.sum(UsageHourly.prompt_tokens), func.sum(UsageHourly.completion_tokens),
        func.sum(UsageHourly.wallet_amount), func.sum(UsageHourly.package_tokens), func.sum(UsageHourly.amount),
    ).where(cond).group_by(day).order_by(day))).all()
    by_model = (await s.execute(select(
        UsageHourly.model, func.sum(UsageHourly.requests), func.sum(UsageHourly.prompt_tokens + UsageHourly.completion_tokens),
        func.sum(UsageHourly.amount),
    ).where(cond).group_by(UsageHourly.model).order_by(func.sum(UsageHourly.amount).desc()))).all()
    return {
        "trend": [{"day": r[0].date().isoformat(), "requests": r[1], "prompt_tokens": r[2], "completion_tokens": r[3],
                   "wallet_amount": r[4], "package_tokens": r[5], "amount": r[6]} for r in trend],
        "by_model": [{"model": r[0], "requests": r[1], "tokens": r[2], "amount": r[3]} for r in by_model],
    }


# ---------------------------------------------------------------- 令牌
class TokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    expired_at: datetime | None = None
    unlimited: bool = True
    quota_limit: int = Field(0, ge=0)  # 微元
    model_limits: list[str] = []
    allow_ips: list[str] = []
    group: str = ""
    rpm_limit: int = Field(0, ge=0)


class TokenCreated(TokenOut):
    key: str


async def _check_group(s, user, group: str) -> None:
    if not group or group == user.group:
        return
    g = await s.get(UserGroup, user.group)
    if not g or group not in (g.usable_groups or []):
        raise AppError(f"无权使用分组 {group}")


@router.get("/tokens", response_model=Page[TokenOut])
async def list_tokens(user: CurrentUser, s: DB, paging: Paging, keyword: str = ""):
    q = select(ApiToken).where(ApiToken.user_id == user.id)
    if keyword:
        q = q.where(ApiToken.name.ilike(f"%{keyword}%"))
    return await paginate(s, q.order_by(ApiToken.id.desc()), paging)


@router.post("/tokens", response_model=TokenCreated)
async def create_token(body: TokenIn, user: CurrentUser, s: DB):
    n = (await s.execute(select(func.count()).select_from(ApiToken).where(ApiToken.user_id == user.id))).scalar()
    if n >= MAX_TOKENS_PER_USER:
        raise AppError(f"每个账户最多创建 {MAX_TOKENS_PER_USER} 个 API Key")
    await _check_group(s, user, body.group)
    key = generate_api_key()
    t = ApiToken(user_id=user.id, key_hash=hash_api_key(key), key_mask=mask_api_key(key), **body.model_dump())
    s.add(t)
    await s.commit()
    await s.refresh(t)
    return TokenCreated(**TokenOut.model_validate(t).model_dump(), key=key)


async def _own_token(s, user, tid: int) -> ApiToken:
    t = await s.get(ApiToken, tid)
    if t is None or t.user_id != user.id:
        raise NotFound("API Key 不存在")
    return t


@router.put("/tokens/{tid}", response_model=TokenOut)
async def update_token(tid: int, body: TokenIn, user: CurrentUser, s: DB):
    t = await _own_token(s, user, tid)
    await _check_group(s, user, body.group)
    quota_changed = (t.unlimited, t.quota_limit) != (body.unlimited, body.quota_limit)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    await s.commit()
    await invalidate_token_cache([t.key_hash])
    if quota_changed:
        await get_engine().invalidate_token(user.id, t.id)
    return t


class StatusIn(BaseModel):
    status: Literal[1, 2]


@router.post("/tokens/{tid}/status", response_model=TokenOut)
async def token_status(tid: int, body: StatusIn, user: CurrentUser, s: DB):
    t = await _own_token(s, user, tid)
    t.status = TOKEN_ENABLED if body.status == 1 else TOKEN_DISABLED
    await s.commit()
    await invalidate_token_cache([t.key_hash])
    return t


@router.delete("/tokens/{tid}", response_model=OK)
async def delete_token(tid: int, user: CurrentUser, s: DB):
    t = await _own_token(s, user, tid)
    kh = t.key_hash
    await s.delete(t)
    await s.commit()
    await invalidate_token_cache([kh])
    return OK()


# ---------------------------------------------------------------- 钱包 / 流水 / 套餐
@router.get("/wallet")
async def wallet(user: CurrentUser, s: DB):
    w = await s.get(Wallet, user.id)
    return {**(await _live_balance(user.id, w.balance if w else 0)),
            "total_recharged": w.total_recharged if w else 0, "total_consumed": w.total_consumed if w else 0}


@router.get("/ledger", response_model=Page[LedgerOut])
async def ledger(user: CurrentUser, s: DB, paging: Paging, bucket_type: str | None = None, biz_type: str | None = None):
    q = select(LedgerEntry).where(LedgerEntry.user_id == user.id)
    if bucket_type:
        q = q.where(LedgerEntry.bucket_type == bucket_type)
    if biz_type:
        q = q.where(LedgerEntry.biz_type == biz_type)
    return await paginate(s, q.order_by(LedgerEntry.id.desc()), paging)


@router.get("/packages", response_model=Page[UserPackageOut])
async def my_packages(user: CurrentUser, s: DB, paging: Paging, status: str | None = None):
    q = select(UserPackage).where(UserPackage.user_id == user.id)
    if status:
        q = q.where(UserPackage.status == status)
    page = await paginate(s, q.order_by(UserPackage.status, UserPackage.expires_at), paging)
    try:
        live = (await get_engine().balance(user.id))["pkgs"]
        for p in page["items"]:
            if p.status == PKG_ACTIVE and p.id in live:
                p.remaining_tokens = live[p.id]
    except Exception:  # noqa: BLE001
        pass
    return page


@router.get("/groups")
async def my_groups(user: CurrentUser, s: DB):
    """当前用户可用于 API Key 的分组（自身分组 + 分组配置的可用分组）。"""
    g = await s.get(UserGroup, user.group)
    names = [user.group, *[n for n in (g.usable_groups if g else []) if n != user.group]]
    rows = {x.name: x for x in (await s.execute(select(UserGroup).where(UserGroup.name.in_(names)))).scalars()}
    return [{"name": n, "display_name": rows[n].display_name, "price_ratio": str(rows[n].price_ratio),
             "description": rows[n].description, "is_default": n == user.group} for n in names if n in rows]


@router.get("/package-products")
async def package_products(user: CurrentUser, s: DB):
    """在售套餐 + 当前用户已购份数（含待支付），用于前端提前展示限购状态。"""
    from app.commerce.orders import _package_bought
    from app.models.billing import PackageProduct
    from app.schemas.common import PackageProductOut

    rows = (await s.execute(select(PackageProduct).where(PackageProduct.on_sale.is_(True))
                            .order_by(PackageProduct.sort, PackageProduct.id))).scalars().all()
    out = []
    for p in rows:
        d = PackageProductOut.model_validate(p).model_dump()
        d["bought"] = await _package_bought(s, user.id, p.id) if p.limit_per_user else 0
        out.append(d)
    return out


# ---------------------------------------------------------------- 下单 / 支付
class QuoteIn(BaseModel):
    amount: Decimal = Field(gt=0)


@router.post("/topup/quote")
async def topup_quote(body: QuoteIn, user: CurrentUser, s: DB):
    return await order_svc.quote_topup(s, user, body.amount)


class OrderIn(BaseModel):
    type: Literal["topup", "package"]
    pay_method: Literal["alipay", "wechat", "balance"]
    amount: Decimal | None = None
    product_id: int | None = None
    quantity: int = Field(1, ge=1, le=100)


@router.post("/orders")
async def create_order(body: OrderIn, request: Request, user: CurrentUser):
    order, launch = await order_svc.create_order(
        user, type_=body.type, pay_method=body.pay_method, amount_yuan=body.amount, product_id=body.product_id,
        quantity=body.quantity, ip=client_ip(request))
    return {"order": OrderOut.model_validate(order),
            "pay_url": launch.pay_url if launch else None, "qr_code": launch.qr_code if launch else None}


@router.get("/orders", response_model=Page[OrderOut])
async def list_orders(user: CurrentUser, s: DB, paging: Paging, status: str | None = None, type: str | None = None):
    q = select(Order).where(Order.user_id == user.id)
    if status:
        q = q.where(Order.status == status)
    if type:
        q = q.where(Order.type == type)
    return await paginate(s, q.order_by(Order.id.desc()), paging)


@router.get("/orders/{order_no}", response_model=OrderOut)
async def get_order(order_no: str, user: CurrentUser, s: DB):
    o = (await s.execute(select(Order).where(Order.order_no == order_no, Order.user_id == user.id))).scalar_one_or_none()
    if o is None:
        raise NotFound("订单不存在")
    return o


@router.post("/orders/{order_no}/cancel", response_model=OrderOut)
async def cancel_order(order_no: str, user: CurrentUser, s: DB):
    r = await s.execute(update(Order).where(Order.order_no == order_no, Order.user_id == user.id,
                                            Order.status == ORDER_PENDING)
                        .values(status="closed", remark="用户取消").returning(Order))
    o = r.scalar_one_or_none()
    if o is None:
        raise AppError("订单不可取消")
    await s.commit()
    return o


@router.post("/orders/{order_no}/mock-pay", response_model=OrderOut)
async def mock_pay(order_no: str, user: CurrentUser, s: DB):
    """模拟收银台「确认支付」：由模拟网关生成带签名的回调，并走与真实回调相同的验签与发货流程。"""
    o = (await s.execute(select(Order).where(Order.order_no == order_no, Order.user_id == user.id))).scalar_one_or_none()
    if o is None:
        raise NotFound("订单不存在")
    if o.provider != "mock":
        raise AppError("该订单不是模拟支付订单")
    if o.status != ORDER_PENDING:
        raise AppError("订单已支付或已关闭")
    if o.expires_at < datetime.now(UTC):
        raise AppError("订单已超时，请重新下单")
    prov = MockProvider()
    notice = prov.parse_notify(prov.build_notify(o))
    return await order_svc.handle_payment(notice, "mock")


# ---------------------------------------------------------------- 兑换码
class RedeemIn(BaseModel):
    code: str = Field(min_length=4, max_length=64)


@router.post("/redeem")
async def redeem(body: RedeemIn, user: CurrentUser):
    return await redeem_code(user.id, body.code)


# ---------------------------------------------------------------- 日志 / 账单 / 通知
@router.get("/logs", response_model=Page[CallLogOut])
async def logs(user: CurrentUser, s: DB, paging: Paging, model: str | None = None, token_name: str | None = None,
               status: str | None = None, start: datetime | None = None, end: datetime | None = None,
               request_id: str | None = None):
    end = end or datetime.now(UTC) + timedelta(minutes=1)
    start = start or end - timedelta(days=30)
    q = select(CallLog).where(CallLog.user_id == user.id, CallLog.created_at >= start, CallLog.created_at < end)
    if model:
        q = q.where(CallLog.model == model)
    if token_name:
        q = q.where(CallLog.token_name == token_name)
    if status:
        q = q.where(CallLog.status == status)
    if request_id:
        q = q.where(CallLog.request_id == request_id)
    return await paginate(s, q.order_by(CallLog.created_at.desc()), paging)


@router.get("/statements", response_model=Page[StatementOut])
async def statements(user: CurrentUser, s: DB, paging: Paging, period_type: Literal["day", "month"] = "month"):
    q = select(Statement).where(Statement.user_id == user.id, Statement.period_type == period_type)
    return await paginate(s, q.order_by(Statement.period_start.desc()), paging)


@router.get("/notifications")
async def notifications(user: CurrentUser, s: DB, paging: Paging):
    q = select(Notification).where(Notification.user_id == user.id).order_by(Notification.id.desc())
    page = await paginate(s, q, paging)
    page["items"] = [{"id": n.id, "kind": n.kind, "title": n.title, "content": n.content, "read": n.read,
                      "created_at": n.created_at} for n in page["items"]]
    return page


# ---------------------------------------------------------------- 操练场
def _playground_key(uid: int) -> str:
    digest = hmac.new(settings.jwt_secret.encode(), f"playground:{uid}".encode(), sha256).hexdigest()
    return f"sk-pg{digest[:44]}"


async def _ensure_playground_token(s, uid: int) -> str:
    key = _playground_key(uid)
    kh = hash_api_key(key)
    if (await s.execute(select(ApiToken.id).where(ApiToken.key_hash == kh))).first() is None:
        s.add(ApiToken(user_id=uid, name=PLAYGROUND_TOKEN_NAME, key_hash=kh, key_mask=mask_api_key(key)))
        await s.commit()
    return key


@router.post("/playground/{endpoint:path}")
async def playground(endpoint: str, request: Request, user: CurrentUser, s: DB):
    if endpoint not in ("chat/completions", "messages"):
        raise NotFound()
    key = await _ensure_playground_token(s, user.id)
    body = await request.body()
    client = httpx.AsyncClient(timeout=httpx.Timeout(600, connect=10))
    req = client.build_request("POST", f"{settings.relay_internal_url}/v1/{endpoint}", content=body,
                               headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                        "X-Forwarded-For": client_ip(request)})
    try:
        resp = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        raise AppError("中转服务暂不可用", status=502, code="relay_unavailable") from e

    async def gen():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(gen(), status_code=resp.status_code,
                             media_type=resp.headers.get("content-type", "application/json"),
                             headers={"x-request-id": resp.headers.get("x-request-id", ""), "Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})

