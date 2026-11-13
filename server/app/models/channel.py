"""渠道：一个上游供给（厂商 + base_url + 一组 Key），可服务多个模型、多个分组。"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin

CH_ENABLED = 1
CH_MANUAL_DISABLED = 2
CH_AUTO_DISABLED = 3

MULTI_KEY_RANDOM = "random"
MULTI_KEY_POLLING = "polling"

# 渠道类型 → LiteLLM provider 前缀
CHANNEL_TYPES: dict[str, dict] = {
    "openai": {"label": "OpenAI", "provider": "openai", "base_url": "https://api.openai.com/v1"},
    "anthropic": {"label": "Anthropic", "provider": "anthropic", "base_url": "https://api.anthropic.com"},
    "deepseek": {"label": "DeepSeek", "provider": "deepseek", "base_url": "https://api.deepseek.com"},
    "dashscope": {"label": "通义千问", "provider": "dashscope",
                  "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"},
    "gemini": {"label": "Google Gemini", "provider": "gemini", "base_url": ""},
    "openai_compatible": {"label": "OpenAI 兼容", "provider": "openai", "base_url": ""},
}


class Channel(Base, IdMixin, TimestampMixin):
    __tablename__ = "channel"

    name: Mapped[str] = mapped_column(String(64))
    type: Mapped[str] = mapped_column(String(32))
    base_url: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[int] = mapped_column(Integer, default=CH_ENABLED)
    status_reason: Mapped[str] = mapped_column(String(255), default="")
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 对外模型名列表
    models: Mapped[list[str]] = mapped_column(ARRAY(String(128)), default=list)
    # 对外模型名 → 上游真实模型名
    model_mapping: Mapped[dict] = mapped_column(JSONB, default=dict)
    groups: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=lambda: ["default"])
    priority: Mapped[int] = mapped_column(Integer, default=0)
    weight: Mapped[int] = mapped_column(Integer, default=1)
    multi_key_mode: Mapped[str] = mapped_column(String(16), default=MULTI_KEY_RANDOM)
    auto_ban: Mapped[bool] = mapped_column(Boolean, default=True)
    test_model: Mapped[str] = mapped_column(String(128), default="")
    # 成本倍率：渠道采购成本 = 售价原价 × cost_ratio（用于毛利统计）
    cost_ratio: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("1"))
    # 采购时段规则（同价格时段规则格式）；为空时成本跟随售价时段
    cost_time_rules: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    # 请求体参数覆盖 / 额外请求头
    param_override: Mapped[dict] = mapped_column(JSONB, default=dict)
    header_override: Mapped[dict] = mapped_column(JSONB, default=dict)
    tag: Mapped[str] = mapped_column(String(64), default="")
    remark: Mapped[str] = mapped_column(Text, default="")
    # 运行指标
    response_time_ms: Mapped[int] = mapped_column(Integer, default=0)
    tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    balance: Mapped[Decimal | None] = mapped_column(Numeric(16, 4))
    balance_currency: Mapped[str] = mapped_column(String(8), default="")
    balance_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_amount: Mapped[int] = mapped_column(BigInteger, default=0)  # 售价口径，微元
    request_count: Mapped[int] = mapped_column(BigInteger, default=0)


class ChannelKey(Base, IdMixin, TimestampMixin):
    """渠道下的单个上游 Key，支持逐条启停与自动禁用。"""

    __tablename__ = "channel_key"

    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("channel.id", ondelete="CASCADE"), index=True)
    key_enc: Mapped[str] = mapped_column(Text)
    key_mask: Mapped[str] = mapped_column(String(32))
    status: Mapped[int] = mapped_column(Integer, default=CH_ENABLED)
    status_reason: Mapped[str] = mapped_column(String(255), default="")
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    request_count: Mapped[int] = mapped_column(BigInteger, default=0)


class Ability(Base):
    """(分组, 模型, 渠道) 展开表，渠道保存时重建，用于路由选择。"""

    __tablename__ = "ability"
    __table_args__ = (PrimaryKeyConstraint("group", "model", "channel_id"),)

    group: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(128))
    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("channel.id", ondelete="CASCADE"), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    weight: Mapped[int] = mapped_column(Integer, default=1)


class ChannelBalanceSnapshot(Base, IdMixin):
    """上游余额快照：两次快照之间的余额减少量 = 上游实际扣费，用于与平台核算成本比对。"""

    __tablename__ = "channel_balance_snapshot"

    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("channel.id", ondelete="CASCADE"), index=True)
    balance: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    currency: Mapped[str] = mapped_column(String(8), default="")
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # 两次快照之间的上游充值（手工登记），计算消耗时扣除
    note: Mapped[str] = mapped_column(String(255), default="")


class UpstreamBill(Base, IdMixin, TimestampMixin):
    """上游账单明细（CSV 导入或厂商用量接口拉取），按 渠道 × 日期 × 模型 一行。"""

    __tablename__ = "upstream_bill"
    __table_args__ = (UniqueConstraint("channel_id", "bill_date", "model", name="uq_upstream_bill_row"),)

    channel_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("channel.id", ondelete="CASCADE"), index=True)
    bill_date: Mapped[date] = mapped_column(Date)
    model: Mapped[str] = mapped_column(String(128))  # 上游模型名
    requests: Mapped[int] = mapped_column(BigInteger, default=0)
    input_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    output_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    cache_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    amount: Mapped[int] = mapped_column(BigInteger, default=0)  # 折算人民币微元
    raw_amount: Mapped[Decimal] = mapped_column(Numeric(18, 6), default=Decimal(0))
    currency: Mapped[str] = mapped_column(String(8), default="CNY")
    source: Mapped[str] = mapped_column(String(16), default="csv")
    batch_no: Mapped[str] = mapped_column(String(32), default="")
