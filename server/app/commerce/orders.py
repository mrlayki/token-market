"""订单：计价、下单、支付回调履约（幂等）。"""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime, timedelta
from decimal import ROUND_CEILING, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.accounting import credit_wallet, flush_outbox, grant_package
from app.billing.pricing import yuan_to_micro
from app.commerce.payments.base import NotConfiguredProvider, PaymentLaunch, PaymentNotice, PaymentProvider
from app.commerce.payments.mock import MockProvider
from app.core import runtime_settings as rs
from app.core.db import SessionLocal
from app.core.errors import AppError, NotFound
from app.models.billing import BIZ_TOPUP, PackageProduct, UserPackage
from app.models.commerce import (
    ORDER_CLOSED,
    ORDER_FULFILLED,
    ORDER_PACKAGE,
    ORDER_PAID,
    ORDER_PENDING,
    ORDER_TOPUP,
    PAY_ALIPAY,
    PAY_BALANCE,
    PAY_WECHAT,
    Order,
)
from app.models.user import User, UserGroup

log = logging.getLogger(__name__)
BIZ_PURCHASE = "purchase"
CENT = 10_000  # 0.01 元 = 10000 微元

# 支付方式 → 网关。真实接入后替换为 AlipayProvider / WechatPayProvider
PROVIDERS: dict[str, PaymentProvider] = {
    PAY_ALIPAY: MockProvider(),
    PAY_WECHAT: MockProvider(),
}
PROVIDER_BY_NAME: dict[str, PaymentProvider] = {"mock": MockProvider(), "alipay": NotConfiguredProvider("alipay"),
                                                "wechat": NotConfiguredProvider("wechat")}


def _round_cent(v: Decimal) -> int:
    return int((v / CENT).to_integral_value(rounding=ROUND_CEILING)) * CENT


def new_order_no() -> str:
    return datetime.now(UTC).strftime("%Y%m%d%H%M%S") + secrets.token_hex(5).upper()


async def quote_topup(s: AsyncSession, user: User, amount_yuan: Decimal) -> dict:
    cfg = await rs.get_all()
    if amount_yuan < Decimal(str(cfg["payment.min_topup"])):
        raise AppError(f"最低充值 {cfg['payment.min_topup']} 元")
    if amount_yuan > Decimal(str(cfg["payment.max_topup"])):
        raise AppError(f"单笔最高充值 {cfg['payment.max_topup']} 元")
    if amount_yuan != amount_yuan.quantize(Decimal("0.01")):
        raise AppError("充值金额最多两位小数")
    face = yuan_to_micro(amount_yuan)
    g = await s.get(UserGroup, user.group)
    ratio = Decimal(g.topup_ratio) if g else Decimal("1")
    discount = Decimal("1")
    for threshold, d in (cfg["payment.discounts"] or {}).items():
        if amount_yuan >= Decimal(str(threshold)):
            discount = min(discount, Decimal(str(d)))
    pay = _round_cent(Decimal(face) * ratio * discount)
    return {"face_amount": face, "pay_amount": pay,
            "detail": {"amount_yuan": str(amount_yuan), "group": user.group, "group_topup_ratio": str(ratio),
                       "discount": str(discount)}}


async def _package_bought(s: AsyncSession, user_id: int, product_id: int) -> int:
    held = (await s.execute(select(func.count()).select_from(UserPackage).where(
        UserPackage.user_id == user_id, UserPackage.product_id == product_id))).scalar_one()
    pending = (await s.execute(select(func.coalesce(func.sum(Order.quantity), 0)).where(
        Order.user_id == user_id, Order.product_id == product_id, Order.type == ORDER_PACKAGE,
        Order.status.in_([ORDER_PENDING, ORDER_PAID])))).scalar_one()
    return int(held) + int(pending)


async def quote_package(s: AsyncSession, user: User, product_id: int, quantity: int) -> tuple[PackageProduct, dict]:
    p = await s.get(PackageProduct, product_id)
    if p is None or not p.on_sale:
        raise NotFound("套餐不存在或已下架")
    if quantity < 1 or quantity > 100:
        raise AppError("购买数量不合法")
    if p.limit_per_user and await _package_bought(s, user.id, p.id) + quantity > p.limit_per_user:
        raise AppError(f"该套餐每人限购 {p.limit_per_user} 份")
    return p, {"face_amount": 0, "pay_amount": p.price * quantity,
               "detail": {"unit_price": p.price, "quantity": quantity, "tokens": p.tokens * quantity}}


async def create_order(user: User, *, type_: str, pay_method: str, amount_yuan: Decimal | None = None,
                       product_id: int | None = None, quantity: int = 1, ip: str = "") -> tuple[Order, PaymentLaunch | None]:
    cfg = await rs.get_all()
    if pay_method != PAY_BALANCE and pay_method not in (cfg["payment.methods"] or []):
        raise AppError("不支持的支付方式")
    async with SessionLocal() as s:
        if type_ == ORDER_TOPUP:
            if pay_method == PAY_BALANCE:
                raise AppError("充值不能使用余额支付")
            q = await quote_topup(s, user, amount_yuan or Decimal(0))
            title = f"账户充值 ¥{amount_yuan}"
        elif type_ == ORDER_PACKAGE:
            product, q = await quote_package(s, user, product_id or 0, quantity)
            title = product.name + (f" × {quantity}" if quantity > 1 else "")
        else:
            raise AppError("订单类型不合法")
        order = Order(
            order_no=new_order_no(), user_id=user.id, type=type_, title=title, face_amount=q["face_amount"],
            product_id=product_id, quantity=quantity, pay_amount=q["pay_amount"], price_detail=q["detail"],
            pay_method=pay_method, provider="balance" if pay_method == PAY_BALANCE else PROVIDERS[pay_method].name,
            status=ORDER_PENDING, client_ip=ip,
            expires_at=datetime.now(UTC) + timedelta(minutes=cfg["payment.order_expire_minutes"]),
        )
        s.add(order)
        await s.commit()
    if pay_method == PAY_BALANCE:
        try:
            await pay_with_balance(order.order_no, user.id)
        except Exception:
            async with SessionLocal() as s:
                o = await s.get(Order, order.id)
                if o.status == ORDER_PENDING:
                    o.status, o.remark = ORDER_CLOSED, "余额支付失败"
                    await s.commit()
            raise
        async with SessionLocal() as s:
            return await s.get(Order, order.id), None
    launch = await PROVIDERS[pay_method].launch(order)
    return order, launch


async def _fulfill_locked(s: AsyncSession, order: Order) -> list[int]:
    outbox: list[int] = []
    if order.type == ORDER_TOPUP:
        outbox.append(await credit_wallet(s, order.user_id, order.face_amount, biz_type=BIZ_TOPUP,
                                          biz_id=order.order_no, remark=order.title))
    else:
        product = await s.get(PackageProduct, order.product_id)
        if product is None:
            raise AppError("套餐商品不存在，无法发货")
        _, ob = await grant_package(s, order.user_id, product, source="order", source_ref=order.order_no,
                                    quantity=order.quantity)
        outbox.append(ob)
    order.status = ORDER_FULFILLED
    order.fulfilled_at = datetime.now(UTC)
    return outbox


async def handle_payment(notice: PaymentNotice, provider: str) -> Order:
    """支付成功回调：校验金额、行锁、幂等发货。重复回调直接返回。"""
    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.order_no == notice.order_no).with_for_update())).scalar_one_or_none()
        if order is None:
            raise NotFound("订单不存在")
        if order.status == ORDER_FULFILLED:
            return order
        if not notice.success:
            return order
        if notice.amount != order.pay_amount:
            order.remark = f"回调金额 {notice.amount} 与订单金额 {order.pay_amount} 不一致，已拒绝发货"
            await s.commit()
            raise AppError("支付金额不一致")
        if order.status == ORDER_CLOSED:
            order.remark = "订单关闭后收到支付，已补发货"
        order.status = ORDER_PAID
        order.trade_no = notice.trade_no
        order.paid_at = datetime.now(UTC)
        await s.flush()
        try:
            outbox = await _fulfill_locked(s, order)
        except Exception as e:  # noqa: BLE001
            # 已收款但发货失败：保留 paid 状态，管理员可在订单管理中「补发货」
            await s.rollback()
            async with SessionLocal() as s2:
                o2 = (await s2.execute(select(Order).where(Order.order_no == notice.order_no))).scalar_one()
                o2.status, o2.trade_no, o2.paid_at = ORDER_PAID, notice.trade_no, datetime.now(UTC)
                o2.remark = f"发货失败：{e}"
                await s2.commit()
            log.exception("order fulfill failed %s", notice.order_no)
            raise
        await s.commit()
    await flush_outbox(outbox)
    return order


async def refulfill(order_no: str) -> Order:
    """管理员补发货：仅对已支付未发货订单。"""
    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.order_no == order_no).with_for_update())).scalar_one_or_none()
        if order is None:
            raise NotFound("订单不存在")
        if order.status != ORDER_PAID:
            raise AppError("仅已支付未发货的订单可补发货")
        outbox = await _fulfill_locked(s, order)
        await s.commit()
    await flush_outbox(outbox)
    return order


async def pay_with_balance(order_no: str, user_id: int) -> None:
    """余额支付：先在 Redis 冻结金额（与进行中的调用互斥），再在 PG 记账，最后同步热数据并解冻。"""
    from app.quota.engine import QuotaError
    from app.quota.service import get_engine

    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.order_no == order_no, Order.user_id == user_id))).scalar_one()
        amount = order.pay_amount
    engine = get_engine()
    rid = f"buy:{order_no}"
    frozen = False
    try:
        await engine.freeze(user_id, rid, amount)
        frozen = True
    except QuotaError as e:
        raise AppError("余额不足") from e
    except Exception:  # noqa: BLE001
        log.warning("redis unavailable, balance purchase relies on PG check only")
    try:
        async with SessionLocal() as s:
            order = (await s.execute(select(Order).where(Order.order_no == order_no, Order.user_id == user_id)
                                     .with_for_update())).scalar_one_or_none()
            if order is None or order.status != ORDER_PENDING:
                raise AppError("订单状态不正确")
            ob1 = await credit_wallet(s, user_id, -order.pay_amount, biz_type=BIZ_PURCHASE, biz_id=order.order_no,
                                      remark=f"购买 {order.title}")
            order.status, order.paid_at, order.trade_no = ORDER_PAID, datetime.now(UTC), f"BAL{order.order_no}"
            outbox = [ob1] + await _fulfill_locked(s, order)
            await s.commit()
        await flush_outbox(outbox)
    finally:
        if frozen:
            await engine.unfreeze(user_id, rid)
