from __future__ import annotations

import secrets
from datetime import UTC, datetime

from sqlalchemy import or_, update

from app.billing.accounting import credit_wallet, flush_outbox, grant_package
from app.core.db import SessionLocal
from app.core.errors import AppError
from app.models.billing import BIZ_REDEEM, PackageProduct
from app.models.commerce import CODE_UNUSED, CODE_USED, REDEEM_QUOTA, RedemptionCode

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉易混淆字符


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(16))
    return "TM-" + "-".join(raw[i:i + 4] for i in range(0, 16, 4))


async def redeem(user_id: int, code: str) -> dict:
    code = code.strip().upper()
    async with SessionLocal() as s:
        # CAS：只有一个并发请求能把状态从未使用改为已使用
        row = (await s.execute(
            update(RedemptionCode)
            .where(RedemptionCode.code == code, RedemptionCode.status == CODE_UNUSED,
                   or_(RedemptionCode.expires_at.is_(None), RedemptionCode.expires_at > datetime.now(UTC)))
            .values(status=CODE_USED, used_by=user_id, used_at=datetime.now(UTC))
            .returning(RedemptionCode)
        )).scalar_one_or_none()
        if row is None:
            raise AppError("兑换码无效、已使用或已过期")
        if row.type == REDEEM_QUOTA:
            ob = await credit_wallet(s, user_id, row.quota_amount, biz_type=BIZ_REDEEM, biz_id=row.code,
                                     remark=f"兑换码 {row.name}")
            result = {"type": "quota", "amount": row.quota_amount}
        else:
            product = await s.get(PackageProduct, row.package_product_id)
            if product is None:
                raise AppError("兑换码对应的套餐不存在")
            _, ob = await grant_package(s, user_id, product, source="redeem", source_ref=row.code)
            result = {"type": "package", "package": product.name, "tokens": product.tokens}
        await s.commit()
    await flush_outbox([ob])
    return result
