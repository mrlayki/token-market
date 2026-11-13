from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin

TOKEN_ENABLED = 1
TOKEN_DISABLED = 2
TOKEN_EXPIRED = 3
TOKEN_EXHAUSTED = 4


class ApiToken(Base, IdMixin, TimestampMixin):
    """用户 API 令牌。明文仅在创建时返回一次，库中只存 HMAC 哈希。"""

    __tablename__ = "api_token"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("user.id"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    key_mask: Mapped[str] = mapped_column(String(32))
    status: Mapped[int] = mapped_column(Integer, default=TOKEN_ENABLED)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 令牌级额度上限（微元），unlimited=True 时不限制
    unlimited: Mapped[bool] = mapped_column(Boolean, default=True)
    quota_limit: Mapped[int] = mapped_column(BigInteger, default=0)
    used_quota: Mapped[int] = mapped_column(BigInteger, default=0)
    # 模型白名单，空表示不限
    model_limits: Mapped[list[str]] = mapped_column(ARRAY(String(128)), default=list)
    # IP / CIDR 白名单，空表示不限
    allow_ips: Mapped[list[str]] = mapped_column(ARRAY(String(64)), default=list)
    # 使用分组，空表示用户默认分组
    group: Mapped[str] = mapped_column(String(32), default="")
    rpm_limit: Mapped[int] = mapped_column(Integer, default=0)
    accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
