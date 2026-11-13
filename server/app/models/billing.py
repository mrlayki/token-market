"""资金与额度：钱包、套餐包商品/实例、只追加的账务流水。

金额单位统一为「微元」（1 元 = 1_000_000），套餐包单位为 token。
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin

MICRO = 1_000_000


class Wallet(Base, TimestampMixin):
    __tablename__ = "wallet"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("user.id"), primary_key=True)
    # 可为负：结算时实际用量超出预扣、在透支额度内允许形成欠款
    balance: Mapped[int] = mapped_column(BigInteger, default=0)
    total_recharged: Mapped[int] = mapped_column(BigInteger, default=0)
    total_consumed: Mapped[int] = mapped_column(BigInteger, default=0)
    # 余额提醒阈值（微元），0 表示不提醒
    warn_threshold: Mapped[int] = mapped_column(BigInteger, default=0)
    # 外部变更（充值/兑换/调整/套餐发放）版本号，用于与 Redis 热数据加载去重，见 quota/lua/apply_ext.lua
    ext_version: Mapped[int] = mapped_column(BigInteger, default=0)


SCOPE_ALL = "all"
SCOPE_MODELS = "models"
SCOPE_VENDORS = "vendors"


class PackageProduct(Base, IdMixin, TimestampMixin):
    """Token 套餐包商品：花多少钱买多少 token，限定适用模型与有效期。"""

    __tablename__ = "package_product"

    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[int] = mapped_column(BigInteger)  # 售价，微元
    original_price: Mapped[int] = mapped_column(BigInteger, default=0)  # 划线价
    tokens: Mapped[int] = mapped_column(BigInteger)
    scope_type: Mapped[str] = mapped_column(String(16), default=SCOPE_MODELS)
    scope_values: Mapped[list[str]] = mapped_column(ARRAY(String(128)), default=list)
    # 计量规则：消耗 token = 输入 × input_weight + 输出 × output_weight（缓存读按输入计）
    input_weight: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("1"))
    output_weight: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("1"))
    valid_days: Mapped[int] = mapped_column(Integer, default=30)
    limit_per_user: Mapped[int] = mapped_column(Integer, default=0)  # 0 不限购
    on_sale: Mapped[bool] = mapped_column(Boolean, default=True)
    badge: Mapped[str] = mapped_column(String(16), default="")  # 角标：热销/推荐
    sort: Mapped[int] = mapped_column(Integer, default=0)
    sold_count: Mapped[int] = mapped_column(BigInteger, default=0)


PKG_ACTIVE = "active"
PKG_EXHAUSTED = "exhausted"
PKG_EXPIRED = "expired"
PKG_REVOKED = "revoked"


class UserPackage(Base, IdMixin, TimestampMixin):
    """用户持有的套餐包实例（快照商品规则，商品后续修改不影响已售出）。"""

    __tablename__ = "user_package"
    __table_args__ = (Index("ix_user_package_user_status", "user_id", "status"),)

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("user.id"))
    product_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("package_product.id"))
    name: Mapped[str] = mapped_column(String(64))
    total_tokens: Mapped[int] = mapped_column(BigInteger)
    remaining_tokens: Mapped[int] = mapped_column(BigInteger)
    scope_type: Mapped[str] = mapped_column(String(16))
    scope_values: Mapped[list[str]] = mapped_column(ARRAY(String(128)), default=list)
    input_weight: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("1"))
    output_weight: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("1"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default=PKG_ACTIVE)
    source: Mapped[str] = mapped_column(String(16), default="order")  # order / redeem / admin
    source_ref: Mapped[str] = mapped_column(String(64), default="")


BUCKET_WALLET = "wallet"
BUCKET_PACKAGE = "package"

BIZ_CONSUME = "consume"
BIZ_TOPUP = "topup"
BIZ_PACKAGE_GRANT = "package_grant"
BIZ_REFUND = "refund"
BIZ_ADJUST = "adjust"
BIZ_REDEEM = "redeem"
BIZ_EXPIRE = "expire"
BIZ_GIFT = "gift"


class LedgerEntry(Base, IdMixin):
    """账务流水，只追加不修改。(biz_type, biz_id, bucket_key) 唯一保证幂等。"""

    __tablename__ = "ledger_entry"
    __table_args__ = (
        UniqueConstraint("biz_type", "biz_id", "bucket_key", name="uq_ledger_idem"),
        Index("ix_ledger_user_created", "user_id", "created_at"),
    )

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("user.id"))
    bucket_type: Mapped[str] = mapped_column(String(16))  # wallet / package
    bucket_key: Mapped[str] = mapped_column(String(32))  # "wallet" / "pkg:{id}"
    package_id: Mapped[int | None] = mapped_column(BigInteger)
    # 正数入账、负数出账。wallet 为微元，package 为 token
    amount: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int | None] = mapped_column(BigInteger)
    biz_type: Mapped[str] = mapped_column(String(24))
    biz_id: Mapped[str] = mapped_column(String(64))
    remark: Mapped[str] = mapped_column(String(255), default="")
    operator_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class QuotaOutbox(Base, IdMixin):
    """额度热数据同步发件箱：外部变更与本表记录在同一 PG 事务提交，
    再由调用方立即投递到 Redis；投递失败（如 Redis 故障）由 worker 重试，保证最终一致。"""

    __tablename__ = "quota_outbox"
    __table_args__ = (Index("ix_quota_outbox_pending", "applied", "id"),)

    user_id: Mapped[int] = mapped_column(BigInteger)
    op: Mapped[str] = mapped_column(String(64), unique=True)
    ver: Mapped[int] = mapped_column(BigInteger)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
