"""额度引擎装配：PG 快照加载器 + 单例。"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.billing.pricing import PackageRule
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.redis import redis
from app.models.billing import PKG_ACTIVE, UserPackage, Wallet
from app.models.token import ApiToken
from app.quota.engine import QuotaEngine, Snapshot


def package_rule(p: UserPackage) -> PackageRule:
    return PackageRule(id=p.id, input_weight=p.input_weight, output_weight=p.output_weight,
                       expires_at=p.expires_at.timestamp(), scope_type=p.scope_type,
                       scope_values=list(p.scope_values or []))


async def load_snapshot(uid: int) -> Snapshot:
    async with SessionLocal() as s:
        await s.execute(insert(Wallet).values(user_id=uid).on_conflict_do_nothing())
        await s.commit()
        w = await s.get(Wallet, uid)
        now = datetime.now(UTC)
        pkgs = (await s.execute(
            select(UserPackage).where(UserPackage.user_id == uid, UserPackage.status == PKG_ACTIVE,
                                      UserPackage.expires_at > now, UserPackage.remaining_tokens > 0)
        )).scalars().all()
        return Snapshot(balance=w.balance, ext_version=w.ext_version,
                        packages=[(package_rule(p), p.remaining_tokens) for p in pkgs])


async def load_token_remaining(tid: int) -> int:
    async with SessionLocal() as s:
        t = await s.get(ApiToken, tid)
        if t is None:
            return 0
        return max(t.quota_limit - t.used_quota, 0)


_engine: QuotaEngine | None = None


def get_engine() -> QuotaEngine:
    global _engine
    if _engine is None:
        _engine = QuotaEngine(redis, load_snapshot, load_token_remaining,
                              reservation_ttl=settings.reservation_ttl_seconds)
    return _engine
