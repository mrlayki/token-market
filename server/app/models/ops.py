from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin


class Setting(Base, TimestampMixin):
    """业务配置 KV，值为 JSON。由管理端「系统设置」维护，进程内带 TTL 缓存。"""

    __tablename__ = "setting"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSONB)


class Announcement(Base, IdMixin, TimestampMixin):
    __tablename__ = "announcement"

    title: Mapped[str] = mapped_column(String(128))
    content: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(String(16), default="info")
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)


class Statement(Base, IdMixin, TimestampMixin):
    """用户账单（日 / 月）。由 worker 根据流水生成，生成后不可变。"""

    __tablename__ = "statement"
    __table_args__ = (UniqueConstraint("user_id", "period_type", "period_start", name="uq_statement_period"),)

    user_id: Mapped[int] = mapped_column(BigInteger)
    period_type: Mapped[str] = mapped_column(String(8))  # day / month
    period_start: Mapped[date] = mapped_column(Date)
    opening_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    closing_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    recharged: Mapped[int] = mapped_column(BigInteger, default=0)
    consumed: Mapped[int] = mapped_column(BigInteger, default=0)
    refunded: Mapped[int] = mapped_column(BigInteger, default=0)
    package_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    requests: Mapped[int] = mapped_column(BigInteger, default=0)
    prompt_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    completion_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    detail: Mapped[dict] = mapped_column(JSONB, default=dict)  # 按模型拆分


class ReconReport(Base, IdMixin):
    __tablename__ = "recon_report"

    kind: Mapped[str] = mapped_column(String(32))  # ledger_vs_wallet / calllog_vs_ledger / redis_vs_db / upstream
    status: Mapped[str] = mapped_column(String(16))  # ok / mismatch / error
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked: Mapped[int] = mapped_column(Integer, default=0)
    mismatched: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    diffs: Mapped[list] = mapped_column(JSONB, default=list)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_by: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base, IdMixin):
    __tablename__ = "notification"

    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)  # None = 管理员通知
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(128))
    content: Mapped[str] = mapped_column(Text, default="")
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
