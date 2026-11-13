"""模型目录：供应商、模型元数据、价格（带版本）。"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin

BILLING_TOKEN = "token"
BILLING_PER_CALL = "per_call"


class Vendor(Base, IdMixin, TimestampMixin):
    __tablename__ = "vendor"

    name: Mapped[str] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(64))
    icon: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    sort: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class ModelMeta(Base, IdMixin, TimestampMixin):
    """对外售卖的模型（模型广场中的一项）。"""

    __tablename__ = "model_meta"

    name: Mapped[str] = mapped_column(String(128), unique=True)
    vendor_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("vendor.id"))
    display_name: Mapped[str] = mapped_column(String(128), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(255), default="")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=list)
    # chat / embedding / image / audio
    mode: Mapped[str] = mapped_column(String(16), default="chat")
    # openai / anthropic / embeddings
    endpoints: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=list)
    context_length: Mapped[int] = mapped_column(Integer, default=0)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    # 上架：出现在模型广场且可调用
    listed: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)


class ModelPrice(Base, IdMixin, TimestampMixin):
    """售价版本。所有金额单位：微元（1 元 = 1_000_000）。
    按 token 计费时单价为「每百万 token 的微元数」；按次计费时 per_call_price 为每次调用微元。
    同一模型取 effective_at <= now 的最新一条。调用时快照，防止中途调价。"""

    __tablename__ = "model_price"
    __table_args__ = (Index("ix_model_price_model_effective", "model", "effective_at"),)

    model: Mapped[str] = mapped_column(String(128))
    billing_type: Mapped[str] = mapped_column(String(16), default=BILLING_TOKEN)
    input_price: Mapped[int] = mapped_column(BigInteger, default=0)
    output_price: Mapped[int] = mapped_column(BigInteger, default=0)
    cache_read_price: Mapped[int] = mapped_column(BigInteger, default=0)
    cache_write_price: Mapped[int] = mapped_column(BigInteger, default=0)
    per_call_price: Mapped[int] = mapped_column(BigInteger, default=0)
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 分时计价规则：[{name, start "HH:MM", end, days [1-7], multiplier, tz}]，按请求开始时刻匹配第一条
    time_rules: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    remark: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int | None] = mapped_column(BigInteger)
