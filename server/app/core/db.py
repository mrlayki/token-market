from collections.abc import AsyncIterator
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, MetaData, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import settings

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class IdMixin:
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


def _json_default(o):
    from datetime import date, datetime
    from decimal import Decimal

    if isinstance(o, Decimal):
        return str(o)
    if isinstance(o, datetime | date):
        return o.isoformat()
    if isinstance(o, set | frozenset):
        return list(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def json_dumps(v) -> str:
    """JSONB 列序列化：兼容 Decimal / datetime，避免业务字段写入 JSON 时 500。"""
    import json

    return json.dumps(v, ensure_ascii=False, default=_json_default)


engine = create_async_engine(
    settings.database_url,
    json_serializer=json_dumps,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=10,
    pool_pre_ping=True,
    pool_recycle=1800,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
