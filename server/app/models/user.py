from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin

ROLE_USER = "user"
ROLE_ADMIN = "admin"
ROLE_ROOT = "root"
ROLE_LEVEL = {ROLE_USER: 1, ROLE_ADMIN: 10, ROLE_ROOT: 100}

STATUS_ENABLED = 1
STATUS_DISABLED = 2


class UserGroup(Base, TimestampMixin):
    """用户分组：决定价格折扣、充值倍率，以及令牌可选择的使用分组。"""

    __tablename__ = "user_group"

    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(255), default="")
    # 调用价格倍率：1.0 原价，0.8 八折
    price_ratio: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("1"))
    # 充值倍率：实付 = 充值面额 × topup_ratio
    topup_ratio: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("1"))
    # 该分组用户可使用的渠道分组
    usable_groups: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=list)
    sort: Mapped[int] = mapped_column(Integer, default=0)


class User(Base, IdMixin, TimestampMixin):
    __tablename__ = "user"

    username: Mapped[str] = mapped_column(String(64), unique=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(64), default="")
    role: Mapped[str] = mapped_column(String(16), default=ROLE_USER)
    status: Mapped[int] = mapped_column(Integer, default=STATUS_ENABLED)
    group: Mapped[str] = mapped_column(String(32), ForeignKey("user_group.name"), default="default")
    remark: Mapped[str] = mapped_column(Text, default="")
    # 修改密码/禁用时自增，使旧 JWT 失效
    auth_version: Mapped[int] = mapped_column(Integer, default=1)
    request_count: Mapped[int] = mapped_column(BigInteger, default=0)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_ip: Mapped[str | None] = mapped_column(String(64))
