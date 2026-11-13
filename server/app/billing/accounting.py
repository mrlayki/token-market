"""资金类外部变更（充值、兑换、管理员调整、赠送、套餐发放/过期）。

规则：所有变更先在 PG 事务中完成「余额/套餐 + 账务流水 + ext_version 自增 + outbox」，
提交后调用 flush_outbox 立即同步到 Redis 热数据；失败的 outbox 由 worker 重试。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.core.errors import AppError
from app.models.billing import (
    BIZ_PACKAGE_GRANT,
    BIZ_TOPUP,
    BUCKET_PACKAGE,
    BUCKET_WALLET,
    PKG_ACTIVE,
    LedgerEntry,
    PackageProduct,
    QuotaOutbox,
    UserPackage,
    Wallet,
)
from app.quota.service import get_engine, package_rule

log = logging.getLogger(__name__)


async def _bump_version(s: AsyncSession, uid: int) -> int:
    await s.execute(insert(Wallet).values(user_id=uid).on_conflict_do_nothing())
    return (await s.execute(
        update(Wallet).where(Wallet.user_id == uid).values(ext_version=Wallet.ext_version + 1)
        .returning(Wallet.ext_version)
    )).scalar_one()


async def credit_wallet(s: AsyncSession, uid: int, amount: int, *, biz_type: str, biz_id: str,
                        remark: str = "", operator_id: int | None = None,
                        allow_negative_result: bool = False) -> int:
    """钱包加减款（amount 可为负）。返回 outbox id。重复的 (biz_type, biz_id) 抛出冲突。"""
    if amount == 0:
        raise AppError("金额不能为 0")
    ver = await _bump_version(s, uid)
    w = (await s.execute(select(Wallet).where(Wallet.user_id == uid).with_for_update())).scalar_one()
    if amount < 0 and not allow_negative_result and w.balance + amount < 0:
        raise AppError("余额不足，无法扣减")
    res = await s.execute(insert(LedgerEntry).values(
        user_id=uid, bucket_type=BUCKET_WALLET, bucket_key="wallet", amount=amount,
        balance_after=w.balance + amount, biz_type=biz_type, biz_id=biz_id, remark=remark,
        operator_id=operator_id,
    ).on_conflict_do_nothing(constraint="uq_ledger_idem").returning(LedgerEntry.id))
    if res.scalar_one_or_none() is None:
        raise AppError("重复的入账请求", status=409, code="duplicate")
    w.balance += amount
    if biz_type == BIZ_TOPUP and amount > 0:
        w.total_recharged += amount
    ob = QuotaOutbox(user_id=uid, op=f"{biz_type}:{biz_id}", ver=ver, payload={"bal_delta": amount})
    s.add(ob)
    await s.flush()
    return ob.id


async def grant_package(s: AsyncSession, uid: int, product: PackageProduct, *, source: str, source_ref: str,
                        operator_id: int | None = None, quantity: int = 1) -> tuple[list[UserPackage], int]:
    """发放套餐包（每份一个实例，便于独立过期与抵扣）。返回 (实例列表, outbox id)。"""
    ver = await _bump_version(s, uid)
    now = datetime.now(UTC)
    items = []
    for i in range(quantity):
        up = UserPackage(
            user_id=uid, product_id=product.id, name=product.name, total_tokens=product.tokens,
            remaining_tokens=product.tokens, scope_type=product.scope_type,
            scope_values=list(product.scope_values or []), input_weight=product.input_weight,
            output_weight=product.output_weight, starts_at=now,
            expires_at=now + timedelta(days=product.valid_days), status=PKG_ACTIVE, source=source,
            source_ref=source_ref,
        )
        s.add(up)
        await s.flush()
        res = await s.execute(insert(LedgerEntry).values(
            user_id=uid, bucket_type=BUCKET_PACKAGE, bucket_key=f"pkg:{up.id}", package_id=up.id,
            amount=product.tokens, balance_after=product.tokens, biz_type=BIZ_PACKAGE_GRANT,
            biz_id=f"{source_ref}#{i}", remark=product.name, operator_id=operator_id,
        ).on_conflict_do_nothing(constraint="uq_ledger_idem").returning(LedgerEntry.id))
        if res.scalar_one_or_none() is None:
            raise AppError("重复的套餐发放请求", status=409, code="duplicate")
        items.append(up)
    await s.execute(update(PackageProduct).where(PackageProduct.id == product.id)
                    .values(sold_count=PackageProduct.sold_count + quantity))
    ob = QuotaOutbox(
        user_id=uid, op=f"pkg:{source}:{source_ref}", ver=ver,
        payload={"pkg_set": [{"id": up.id, "rem": up.remaining_tokens,
                              "meta": package_rule(up).to_meta()} for up in items]},
    )
    s.add(ob)
    await s.flush()
    return items, ob.id


async def remove_packages(s: AsyncSession, uid: int, package_ids: list[int], reason: str) -> int:
    ver = await _bump_version(s, uid)
    ob = QuotaOutbox(user_id=uid, op=f"pkgdel:{reason}:{','.join(map(str, package_ids))}:{ver}", ver=ver,
                     payload={"pkg_del": package_ids})
    s.add(ob)
    await s.flush()
    return ob.id


async def apply_outbox_row(ob: QuotaOutbox) -> str:
    from app.billing.pricing import PackageRule

    p = ob.payload or {}
    pkg_set = [(PackageRule.from_meta(int(x["id"]), x["meta"]), int(x["rem"])) for x in p.get("pkg_set") or []]
    return await get_engine().apply_external(ob.user_id, ver=ob.ver, op=ob.op, bal_delta=int(p.get("bal_delta") or 0),
                                             pkg_set=pkg_set, pkg_del=p.get("pkg_del") or [])


async def flush_outbox(ids: list[int]) -> None:
    """事务提交后立即投递；失败只记日志，worker 会重试。"""
    if not ids:
        return
    async with SessionLocal() as s:
        rows = (await s.execute(select(QuotaOutbox).where(QuotaOutbox.id.in_(ids), QuotaOutbox.applied.is_(False))
                                .order_by(QuotaOutbox.id))).scalars().all()
        for ob in rows:
            try:
                await apply_outbox_row(ob)
                ob.applied = True
            except Exception:  # noqa: BLE001
                ob.attempts += 1
                log.warning("outbox apply failed id=%s, will retry", ob.id)
        await s.commit()
