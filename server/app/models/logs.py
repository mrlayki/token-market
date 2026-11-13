from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin

CALL_SUCCESS = "success"
CALL_FAILED = "failed"
CALL_CLIENT_ABORT = "client_abort"


class CallLog(Base):
    """调用流水，按月 RANGE 分区（分区由 worker 预建）。"""

    __tablename__ = "call_log"
    __table_args__ = (
        PrimaryKeyConstraint("id", "created_at"),
        UniqueConstraint("request_id", "created_at", name="uq_call_log_request"),
        Index("ix_call_log_user_created", "user_id", "created_at"),
        Index("ix_call_log_channel_created", "channel_id", "created_at"),
        Index("ix_call_log_model_created", "model", "created_at"),
        {"postgresql_partition_by": "RANGE (created_at)"},
    )

    id: Mapped[int] = mapped_column(BigInteger, server_default=text("nextval('call_log_id_seq')"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    request_id: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int] = mapped_column(BigInteger)
    token_id: Mapped[int | None] = mapped_column(BigInteger)
    token_name: Mapped[str] = mapped_column(String(64), default="")
    channel_id: Mapped[int | None] = mapped_column(BigInteger)
    channel_key_id: Mapped[int | None] = mapped_column(BigInteger)
    model: Mapped[str] = mapped_column(String(128))
    upstream_model: Mapped[str] = mapped_column(String(128), default="")
    group: Mapped[str] = mapped_column(String(32), default="")
    endpoint: Mapped[str] = mapped_column(String(32), default="chat")
    is_stream: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16))
    http_status: Mapped[int] = mapped_column(Integer, default=200)
    error: Mapped[str] = mapped_column(Text, default="")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    usage_estimated: Mapped[bool] = mapped_column(Boolean, default=False)
    # 计费结果（微元 / token）
    amount: Mapped[int] = mapped_column(BigInteger, default=0)  # 售价口径总额（含套餐抵扣折算前）
    wallet_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    package_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    cost: Mapped[int] = mapped_column(BigInteger, default=0)  # 渠道成本
    price_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    first_token_ms: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    client_ip: Mapped[str] = mapped_column(String(64), default="")


class UsageHourly(Base, IdMixin):
    __tablename__ = "usage_hourly"
    __table_args__ = (
        UniqueConstraint("hour", "user_id", "token_id", "channel_id", "model", name="uq_usage_hourly_dim"),
        Index("ix_usage_hourly_hour", "hour"),
    )

    hour: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    user_id: Mapped[int] = mapped_column(BigInteger)
    token_id: Mapped[int] = mapped_column(BigInteger, default=0)
    channel_id: Mapped[int] = mapped_column(BigInteger, default=0)
    model: Mapped[str] = mapped_column(String(128))
    requests: Mapped[int] = mapped_column(BigInteger, default=0)
    failed: Mapped[int] = mapped_column(BigInteger, default=0)
    prompt_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    completion_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    cache_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    amount: Mapped[int] = mapped_column(BigInteger, default=0)
    wallet_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    package_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    cost: Mapped[int] = mapped_column(BigInteger, default=0)


class AuditLog(Base, IdMixin):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_created", "created_at"),)

    operator_id: Mapped[int | None] = mapped_column(BigInteger)
    operator_name: Mapped[str] = mapped_column(String(64), default="")
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str] = mapped_column(String(32), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[dict] = mapped_column(JSONB, default=dict)
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
