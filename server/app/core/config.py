from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """进程级配置（来自环境变量）。业务可调参数存放在 setting 表，由管理端维护。"""

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), env_prefix="TM_", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    role: Literal["api", "relay", "worker", "all"] = "all"

    database_url: str = "postgresql+asyncpg://tm:tm@localhost:5432/token_market"
    redis_url: str = "redis://localhost:6379/0"
    # 每个进程的连接池。总连接数 = Σ(进程数 × (pool + overflow))，须小于 PG max_connections
    db_pool_size: int = 10
    db_max_overflow: int = 10

    # 安全
    jwt_secret: str = Field(default="dev-jwt-secret-change-me", min_length=16)
    jwt_expire_minutes: int = 60 * 24 * 7
    # 渠道 Key 加密主密钥（32 字节，base64url）。生产必须通过环境变量注入
    channel_key_secret: str = "ZGV2LWNoYW5uZWwta2V5LXNlY3JldC0zMmJ5dGVzISE="
    payment_notify_secret: str = "dev-payment-notify-secret"

    # 额度
    quota_mode: Literal["lua", "naive"] = "lua"
    redis_fail_mode: Literal["pg_fallback", "fail_closed"] = "pg_fallback"
    reservation_ttl_seconds: int = 900

    # 中转
    relay_timeout_seconds: float = 600
    relay_connect_timeout_seconds: float = 10
    public_base_url: str = "http://localhost:8080"
    # api 进程调用 relay（操练场）使用的内部地址
    relay_internal_url: str = "http://relay:8001"

    # 首个 root 管理员（seed 时使用）
    root_username: str = "root"
    root_password: str = "ChangeMe123!"

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174", "http://localhost:8080"]

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
