"""Redis 故障降级：直接在 PG 上做条件扣减（原子、不超卖，但吞吐低于 Redis）。

降级期间只使用钱包余额（不扣套餐包）。PG 余额的变化通过 quota_outbox 记录为外部变更，
Redis 恢复后由 worker 投递，保证热数据与 PG 一致。
"""

from __future__ import annotations

import logging

from sqlalchemy import update

from app.billing.usage_writer import persist_usage_event
from app.core.db import SessionLocal
from app.models.billing import QuotaOutbox, Wallet

log = logging.getLogger(__name__)


async def reserve(uid: int, amount: int) -> bool:
    async with SessionLocal() as s:
        res = await s.execute(
            update(Wallet).where(Wallet.user_id == uid, Wallet.balance >= amount)
            .values(balance=Wallet.balance - amount, ext_version=Wallet.ext_version + 1)
            .returning(Wallet.ext_version)
        )
        ver = res.scalar_one_or_none()
        if ver is None:
            return False
        s.add(QuotaOutbox(user_id=uid, op=f"pgrsv:{uid}:{ver}", ver=ver, payload={"bal_delta": -amount}))
        await s.commit()
        return True


async def settle(uid: int, reserved: int, actual: int, ev: dict) -> None:
    diff = reserved - actual  # >0 退还，<0 追加扣减（允许为负，形成欠款）
    ev["settle"] = {"ok": 1, "wallet": actual, "pkgs": [], "shortfall": 0, "degraded": 1}
    async with SessionLocal() as s:
        if diff:
            ver = (await s.execute(
                update(Wallet).where(Wallet.user_id == uid)
                .values(balance=Wallet.balance + diff, ext_version=Wallet.ext_version + 1)
                .returning(Wallet.ext_version)
            )).scalar_one()
            s.add(QuotaOutbox(user_id=uid, op=f"pgset:{ev['rid']}", ver=ver, payload={"bal_delta": diff}))
        await persist_usage_event(s, ev, wallet_applied=True)
        await s.commit()
