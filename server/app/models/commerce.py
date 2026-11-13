from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin

ORDER_TOPUP = "topup"
ORDER_PACKAGE = "package"

ORDER_PENDING = "pending"
ORDER_PAID = "paid"  # 已收款未发货（发货失败时停留在此，由任务补偿）
ORDER_FULFILLED = "fulfilled"
ORDER_CLOSED = "closed"
ORDER_REFUNDED = "refunded"

PAY_ALIPAY = "alipay"
PAY_WECHAT = "wechat"
PAY_BALANCE = "balance"


class Order(Base, IdMixin, TimestampMixin):
    __tablename__ = "order"
    __table_args__ = (Index("ix_order_user_created", "user_id", "created_at"),)

    order_no: Mapped[str] = mapped_column(String(32), unique=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("user.id"))
    type: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(128))
    # 充值：到账面额（微元）；套餐：商品 id
    face_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    product_id: Mapped[int | None] = mapped_column(BigInteger)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    # 应付金额（微元）与计算明细
    pay_amount: Mapped[int] = mapped_column(BigInteger)
    price_detail: Mapped[dict] = mapped_column(JSONB, default=dict)
    pay_method: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(String(16), default="mock")
    status: Mapped[str] = mapped_column(String(16), default=ORDER_PENDING)
    trade_no: Mapped[str | None] = mapped_column(String(64), unique=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    client_ip: Mapped[str] = mapped_column(String(64), default="")
    remark: Mapped[str] = mapped_column(String(255), default="")


REDEEM_QUOTA = "quota"
REDEEM_PACKAGE = "package"

CODE_UNUSED = 1
CODE_USED = 2
CODE_DISABLED = 3


class RedemptionCode(Base, IdMixin, TimestampMixin):
    __tablename__ = "redemption_code"

    code: Mapped[str] = mapped_column(String(48), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    batch_no: Mapped[str] = mapped_column(String(32), index=True)
    type: Mapped[str] = mapped_column(String(16), default=REDEEM_QUOTA)
    quota_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    package_product_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("package_product.id"))
    status: Mapped[int] = mapped_column(Integer, default=CODE_UNUSED)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_by: Mapped[int | None] = mapped_column(BigInteger)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(BigInteger)
