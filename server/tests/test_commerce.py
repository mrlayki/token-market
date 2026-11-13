"""交易幂等性集成测试（需要本地 Postgres + Redis，见 .env）。"""

import asyncio
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.commerce import orders as order_svc
from app.commerce.payments.mock import MockProvider
from app.commerce.redemption import new_code, redeem
from app.core.db import SessionLocal, engine
from app.core.errors import AppError
from app.core.security import hash_password
from app.models.billing import LedgerEntry, Wallet
from app.models.commerce import ORDER_FULFILLED, RedemptionCode
from app.models.user import User


@pytest.fixture(scope="module", autouse=True)
async def _dispose():
    yield
    await engine.dispose()


async def _user() -> User:
    async with SessionLocal() as s:
        u = User(username=f"t_{uuid.uuid4().hex[:10]}", password_hash=hash_password("x" * 10), group="default")
        s.add(u)
        await s.flush()
        s.add(Wallet(user_id=u.id))
        await s.commit()
        return u


async def _wallet(uid: int) -> int:
    async with SessionLocal() as s:
        return (await s.get(Wallet, uid)).balance


async def test_duplicate_payment_notify_fulfills_once():
    u = await _user()
    order, _ = await order_svc.create_order(u, type_="topup", pay_method="alipay", amount_yuan=Decimal("10"))
    prov = MockProvider()
    notice = prov.parse_notify(prov.build_notify(order))
    # 网关并发重复回调 5 次
    results = await asyncio.gather(*(order_svc.handle_payment(notice, "mock") for _ in range(5)),
                                   return_exceptions=True)
    assert all(not isinstance(r, Exception) for r in results)
    assert await _wallet(u.id) == 10_000_000
    async with SessionLocal() as s:
        n = (await s.execute(select(func.count()).select_from(LedgerEntry).where(
            LedgerEntry.biz_id == order.order_no))).scalar()
    assert n == 1
    assert results[0].status == ORDER_FULFILLED


async def test_tampered_notify_rejected():
    u = await _user()
    order, _ = await order_svc.create_order(u, type_="topup", pay_method="wechat", amount_yuan=Decimal("10"))
    params = MockProvider.build_notify(order)
    params["total_amount"] = "1"
    with pytest.raises(ValueError):
        MockProvider().parse_notify(params)
    assert await _wallet(u.id) == 0


async def test_redemption_concurrent_single_use():
    users = [await _user() for _ in range(10)]
    code = new_code()
    async with SessionLocal() as s:
        s.add(RedemptionCode(code=code, name="test", batch_no="T", type="quota", quota_amount=5_000_000))
        await s.commit()
    results = await asyncio.gather(*(redeem(u.id, code) for u in users), return_exceptions=True)
    ok = [r for r in results if not isinstance(r, Exception)]
    assert len(ok) == 1
    assert all(isinstance(r, AppError) for r in results if isinstance(r, Exception))
    balances = [await _wallet(u.id) for u in users]
    assert sorted(balances)[-1] == 5_000_000 and sum(balances) == 5_000_000
