from __future__ import annotations

import csv
import io
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, update

from app.api.deps import DB, AdminUser, Paging, RootUser, audit, paginate
from app.billing.accounting import credit_wallet, flush_outbox, grant_package, remove_packages
from app.commerce.orders import refulfill
from app.commerce.redemption import new_code
from app.core.errors import AppError, Conflict, Forbidden, NotFound
from app.core.security import hash_password
from app.models.billing import BIZ_ADJUST, PKG_ACTIVE, PKG_REVOKED, PackageProduct, UserPackage, Wallet
from app.models.commerce import CODE_DISABLED, CODE_UNUSED, ORDER_CLOSED, ORDER_PENDING, Order, RedemptionCode
from app.models.token import ApiToken
from app.models.user import ROLE_LEVEL, User
from app.quota.service import get_engine
from app.relay.auth import invalidate_token_cache
from app.schemas.common import OK, ORM, OrderOut, PackageProductOut, UserPackageOut

router = APIRouter()


# ---------------------------------------------------------------- 用户
class AdminUserOut(ORM):
    id: int
    username: str
    display_name: str
    email: str | None
    role: str
    group: str
    status: int
    remark: str
    request_count: int
    last_login_at: datetime | None
    last_login_ip: str | None
    created_at: datetime
    balance: int = 0
    total_recharged: int = 0
    total_consumed: int = 0


@router.get("/users")
async def list_users(_: AdminUser, s: DB, paging: Paging, keyword: str = "", group: str | None = None,
                     role: str | None = None, status: int | None = None):
    q = select(User, Wallet).outerjoin(Wallet, Wallet.user_id == User.id)
    if keyword:
        cond = [User.username.ilike(f"%{keyword}%"), User.email.ilike(f"%{keyword}%"),
                User.display_name.ilike(f"%{keyword}%")]
        if keyword.isdigit():
            cond.append(User.id == int(keyword))
        q = q.where(or_(*cond))
    if group:
        q = q.where(User.group == group)
    if role:
        q = q.where(User.role == role)
    if status:
        q = q.where(User.status == status)
    page = await paginate(s, q.order_by(User.id.desc()), paging, scalars=False)
    items = []
    for u, w in page["items"]:
        d = AdminUserOut.model_validate(u)
        if w:
            d.balance, d.total_recharged, d.total_consumed = w.balance, w.total_recharged, w.total_consumed
        items.append(d)
    page["items"] = items
    return page


@router.get("/users/{uid}")
async def get_user(uid: int, _: AdminUser, s: DB):
    u = await s.get(User, uid)
    if u is None:
        raise NotFound("用户不存在")
    w = await s.get(Wallet, uid)
    d = AdminUserOut.model_validate(u)
    if w:
        d.balance, d.total_recharged, d.total_consumed = w.balance, w.total_recharged, w.total_consumed
    try:
        live = await get_engine().balance(uid)
    except Exception:  # noqa: BLE001
        live = None
    return {"user": d, "live": live}


class UserCreateIn(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=64)
    display_name: str = ""
    email: str | None = None
    role: Literal["user", "admin"] = "user"
    group: str = "default"
    remark: str = ""


@router.post("/users", response_model=AdminUserOut)
async def create_user(body: UserCreateIn, request: Request, user: AdminUser, s: DB):
    if body.role == "admin" and user.role != "root":
        raise Forbidden("只有超级管理员可以创建管理员")
    if (await s.execute(select(User.id).where(User.username == body.username))).first():
        raise Conflict("用户名已存在")
    u = User(**body.model_dump(exclude={"password"}), password_hash=hash_password(body.password))
    u.display_name = u.display_name or u.username
    s.add(u)
    await s.flush()
    s.add(Wallet(user_id=u.id))
    await audit(s, request, user, "user.create", "user", u.id, {"username": u.username, "role": u.role})
    await s.commit()
    return AdminUserOut.model_validate(u)


class UserUpdateIn(BaseModel):
    display_name: str | None = None
    email: str | None = None
    role: Literal["user", "admin"] | None = None
    group: str | None = None
    status: Literal[1, 2] | None = None
    remark: str | None = None
    password: str | None = Field(None, min_length=8, max_length=64)


async def _invalidate_user_tokens(s, uid: int) -> None:
    hashes = list((await s.execute(select(ApiToken.key_hash).where(ApiToken.user_id == uid))).scalars())
    await invalidate_token_cache(hashes)


@router.put("/users/{uid}", response_model=AdminUserOut)
async def update_user(uid: int, body: UserUpdateIn, request: Request, user: AdminUser, s: DB):
    u = await s.get(User, uid)
    if u is None:
        raise NotFound("用户不存在")
    if ROLE_LEVEL[u.role] >= ROLE_LEVEL[user.role] and u.id != user.id:
        raise Forbidden("无权修改同级或更高权限的账户")
    if body.role and body.role != u.role and user.role != "root":
        raise Forbidden("只有超级管理员可以修改角色")
    data = body.model_dump(exclude_none=True, exclude={"password"})
    for k, v in data.items():
        setattr(u, k, v)
    if body.password:
        u.password_hash = hash_password(body.password)
    if body.password or body.status == 2 or body.role:
        u.auth_version += 1
    await audit(s, request, user, "user.update", "user", uid, data | ({"password": "***"} if body.password else {}))
    await s.commit()
    await _invalidate_user_tokens(s, uid)
    return AdminUserOut.model_validate(u)


class AdjustIn(BaseModel):
    amount: int  # 微元，可为负
    remark: str = Field(min_length=1, max_length=200)


@router.post("/users/{uid}/adjust", response_model=OK)
async def adjust_balance(uid: int, body: AdjustIn, request: Request, user: AdminUser, s: DB):
    if not await s.get(User, uid):
        raise NotFound("用户不存在")
    op = f"{user.id}-{int(datetime.now(UTC).timestamp() * 1000)}"
    ob = await credit_wallet(s, uid, body.amount, biz_type=BIZ_ADJUST, biz_id=op, remark=body.remark,
                             operator_id=user.id, allow_negative_result=True)
    await audit(s, request, user, "user.adjust_balance", "user", uid, body.model_dump())
    await s.commit()
    await flush_outbox([ob])
    return OK(message="余额已调整")


class GrantIn(BaseModel):
    product_id: int
    quantity: int = Field(1, ge=1, le=100)
    remark: str = ""


@router.post("/users/{uid}/grant-package", response_model=OK)
async def grant(uid: int, body: GrantIn, request: Request, user: AdminUser, s: DB):
    product = await s.get(PackageProduct, body.product_id)
    if not product or not await s.get(User, uid):
        raise NotFound("用户或套餐不存在")
    ref = f"admin-{user.id}-{int(datetime.now(UTC).timestamp() * 1000)}"
    _, ob = await grant_package(s, uid, product, source="admin", source_ref=ref, operator_id=user.id,
                                quantity=body.quantity)
    await audit(s, request, user, "user.grant_package", "user", uid, body.model_dump())
    await s.commit()
    await flush_outbox([ob])
    return OK(message="套餐已发放")


@router.get("/users/{uid}/packages", response_model=list[UserPackageOut])
async def user_packages(uid: int, _: AdminUser, s: DB):
    return (await s.execute(select(UserPackage).where(UserPackage.user_id == uid)
                            .order_by(UserPackage.id.desc()))).scalars().all()


@router.post("/user-packages/{pid}/revoke", response_model=OK)
async def revoke_package(pid: int, request: Request, user: AdminUser, s: DB):
    p = await s.get(UserPackage, pid)
    if p is None or p.status != PKG_ACTIVE:
        raise AppError("套餐不存在或已失效")
    p.status = PKG_REVOKED
    ob = await remove_packages(s, p.user_id, [p.id], "revoke")
    await audit(s, request, user, "user.revoke_package", "user_package", pid)
    await s.commit()
    await flush_outbox([ob])
    return OK()


@router.post("/users/{uid}/rebuild-quota", response_model=OK)
async def rebuild_quota(uid: int, request: Request, user: RootUser, s: DB):
    """对账修复：丢弃该用户 Redis 热数据，下次请求从 PG 重建。仅在无进行中请求时执行。"""
    b = await get_engine().balance(uid)
    if b["frz"]:
        raise AppError("该用户存在进行中的预扣，请稍后重试")
    await get_engine().drop_user(uid)
    await audit(s, request, user, "user.rebuild_quota", "user", uid, {"before": b})
    await s.commit()
    return OK(message="已重建，下次请求时从数据库加载")


# ---------------------------------------------------------------- 套餐商品
class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = ""
    price: int = Field(ge=0)
    original_price: int = Field(0, ge=0)
    tokens: int = Field(gt=0)
    scope_type: Literal["all", "models", "vendors"] = "models"
    scope_values: list[str] = []
    input_weight: Decimal = Field(Decimal(1), gt=0)
    output_weight: Decimal = Field(Decimal(1), gt=0)
    valid_days: int = Field(30, ge=1, le=3650)
    limit_per_user: int = Field(0, ge=0)
    on_sale: bool = True
    badge: str = ""
    sort: int = 0


@router.get("/package-products", response_model=list[PackageProductOut])
async def products(_: AdminUser, s: DB):
    return (await s.execute(select(PackageProduct).order_by(PackageProduct.sort, PackageProduct.id))).scalars().all()


@router.post("/package-products", response_model=PackageProductOut)
async def create_product(body: ProductIn, request: Request, user: AdminUser, s: DB):
    if body.scope_type != "all" and not body.scope_values:
        raise AppError("请选择适用的模型或供应商")
    p = PackageProduct(**body.model_dump())
    s.add(p)
    await s.flush()
    await audit(s, request, user, "package_product.create", "package_product", p.id, body.model_dump(mode="json"))
    await s.commit()
    return p


@router.put("/package-products/{pid}", response_model=PackageProductOut)
async def update_product(pid: int, body: ProductIn, request: Request, user: AdminUser, s: DB):
    p = await s.get(PackageProduct, pid)
    if p is None:
        raise NotFound()
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    await audit(s, request, user, "package_product.update", "package_product", pid, body.model_dump(mode="json"))
    await s.commit()
    return p


@router.delete("/package-products/{pid}", response_model=OK)
async def delete_product(pid: int, request: Request, user: AdminUser, s: DB):
    p = await s.get(PackageProduct, pid)
    if p is None:
        raise NotFound()
    if p.sold_count > 0 or (await s.execute(select(UserPackage.id).where(UserPackage.product_id == pid).limit(1))).first():
        raise AppError("该套餐已有售出记录，不能删除，请改为下架")
    await s.delete(p)
    await audit(s, request, user, "package_product.delete", "package_product", pid)
    await s.commit()
    return OK()


# ---------------------------------------------------------------- 订单
@router.get("/orders")
async def orders(_: AdminUser, s: DB, paging: Paging, keyword: str = "", status: str | None = None,
                 type: str | None = None, user_id: int | None = None):
    q = select(Order)
    if keyword:
        q = q.where(or_(Order.order_no == keyword, Order.trade_no == keyword, Order.title.ilike(f"%{keyword}%")))
    if status:
        q = q.where(Order.status == status)
    if type:
        q = q.where(Order.type == type)
    if user_id:
        q = q.where(Order.user_id == user_id)
    page = await paginate(s, q.order_by(Order.id.desc()), paging)
    page["items"] = [OrderOut.model_validate(o) for o in page["items"]]
    return page


@router.post("/orders/{order_no}/refulfill", response_model=OrderOut)
async def order_refulfill(order_no: str, request: Request, user: AdminUser, s: DB):
    o = await refulfill(order_no)
    await audit(s, request, user, "order.refulfill", "order", order_no)
    await s.commit()
    return o


@router.post("/orders/{order_no}/close", response_model=OK)
async def order_close(order_no: str, request: Request, user: AdminUser, s: DB):
    r = await s.execute(update(Order).where(Order.order_no == order_no, Order.status == ORDER_PENDING)
                        .values(status=ORDER_CLOSED, remark=f"管理员 {user.username} 关闭"))
    if not r.rowcount:
        raise AppError("仅待支付订单可关闭")
    await audit(s, request, user, "order.close", "order", order_no)
    await s.commit()
    return OK()


# ---------------------------------------------------------------- 兑换码
class CodeGenIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    type: Literal["quota", "package"] = "quota"
    quota_amount: int = Field(0, ge=0)
    package_product_id: int | None = None
    count: int = Field(1, ge=1, le=1000)
    expires_at: datetime | None = None


class CodeOut(ORM):
    id: int
    code: str
    name: str
    batch_no: str
    type: str
    quota_amount: int
    package_product_id: int | None
    status: int
    expires_at: datetime | None
    used_by: int | None
    used_at: datetime | None
    created_at: datetime


@router.get("/redemption-codes")
async def codes(_: AdminUser, s: DB, paging: Paging, keyword: str = "", status: int | None = None,
                batch_no: str | None = None):
    q = select(RedemptionCode)
    if keyword:
        q = q.where(or_(RedemptionCode.code == keyword.upper(), RedemptionCode.name.ilike(f"%{keyword}%")))
    if status:
        q = q.where(RedemptionCode.status == status)
    if batch_no:
        q = q.where(RedemptionCode.batch_no == batch_no)
    page = await paginate(s, q.order_by(RedemptionCode.id.desc()), paging)
    page["items"] = [CodeOut.model_validate(c) for c in page["items"]]
    return page


@router.post("/redemption-codes")
async def gen_codes(body: CodeGenIn, request: Request, user: AdminUser, s: DB):
    if body.type == "quota" and body.quota_amount <= 0:
        raise AppError("请填写兑换额度")
    if body.type == "package" and not (body.package_product_id and await s.get(PackageProduct, body.package_product_id)):
        raise AppError("请选择套餐")
    batch = datetime.now(UTC).strftime("B%Y%m%d%H%M%S")
    codes = [new_code() for _ in range(body.count)]
    for c in codes:
        s.add(RedemptionCode(code=c, batch_no=batch, created_by=user.id, **body.model_dump(exclude={"count"})))
    await audit(s, request, user, "redemption.generate", "redemption", batch, body.model_dump(mode="json"))
    await s.commit()
    return {"batch_no": batch, "codes": codes}


@router.post("/redemption-codes/{cid}/disable", response_model=OK)
async def disable_code(cid: int, request: Request, user: AdminUser, s: DB):
    r = await s.execute(update(RedemptionCode).where(RedemptionCode.id == cid, RedemptionCode.status == CODE_UNUSED)
                        .values(status=CODE_DISABLED))
    if not r.rowcount:
        raise AppError("仅未使用的兑换码可作废")
    await audit(s, request, user, "redemption.disable", "redemption", cid)
    await s.commit()
    return OK()


@router.get("/redemption-codes/export")
async def export_codes(batch_no: str, _: AdminUser, s: DB):
    rows = (await s.execute(select(RedemptionCode).where(RedemptionCode.batch_no == batch_no)
                            .order_by(RedemptionCode.id))).scalars().all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["code", "name", "type", "quota_yuan", "package_product_id", "status", "expires_at"])
    for c in rows:
        w.writerow([c.code, c.name, c.type, c.quota_amount / 1_000_000, c.package_product_id or "", c.status,
                    c.expires_at.isoformat() if c.expires_at else ""])
    return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename={batch_no}.csv"})
