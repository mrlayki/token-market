from datetime import datetime
from decimal import Decimal
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class OK(BaseModel):
    ok: bool = True
    message: str = ""


class UserBrief(ORM):
    id: int
    username: str
    display_name: str
    email: str | None
    role: str
    group: str
    status: int
    created_at: datetime


class TokenOut(ORM):
    id: int
    user_id: int
    name: str
    key_mask: str
    status: int
    expired_at: datetime | None
    unlimited: bool
    quota_limit: int
    used_quota: int
    model_limits: list[str]
    allow_ips: list[str]
    group: str
    rpm_limit: int
    accessed_at: datetime | None
    created_at: datetime


class CallLogOut(ORM):
    id: int
    created_at: datetime
    request_id: str
    user_id: int
    token_name: str
    model: str
    group: str
    endpoint: str
    is_stream: bool
    status: str
    http_status: int
    error: str
    prompt_tokens: int
    completion_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    usage_estimated: bool
    amount: int
    wallet_amount: int
    package_tokens: int
    first_token_ms: int
    duration_ms: int
    retry_count: int


class AdminCallLogOut(CallLogOut):
    channel_id: int | None
    channel_key_id: int | None
    upstream_model: str
    cost: int
    client_ip: str
    price_snapshot: dict
    token_id: int | None


class LedgerOut(ORM):
    id: int
    user_id: int
    bucket_type: str
    bucket_key: str
    package_id: int | None
    amount: int
    balance_after: int | None
    biz_type: str
    biz_id: str
    remark: str
    created_at: datetime


class UserPackageOut(ORM):
    id: int
    user_id: int
    product_id: int | None
    name: str
    total_tokens: int
    remaining_tokens: int
    scope_type: str
    scope_values: list[str]
    input_weight: Decimal
    output_weight: Decimal
    starts_at: datetime
    expires_at: datetime
    status: str
    source: str
    created_at: datetime


class PackageProductOut(ORM):
    id: int
    name: str
    description: str
    price: int
    original_price: int
    tokens: int
    scope_type: str
    scope_values: list[str]
    input_weight: Decimal
    output_weight: Decimal
    valid_days: int
    limit_per_user: int
    on_sale: bool
    badge: str
    sort: int
    sold_count: int


class OrderOut(ORM):
    id: int
    order_no: str
    user_id: int
    type: str
    title: str
    face_amount: int
    product_id: int | None
    quantity: int
    pay_amount: int
    price_detail: dict
    pay_method: str
    provider: str
    status: str
    trade_no: str | None
    paid_at: datetime | None
    fulfilled_at: datetime | None
    expires_at: datetime
    created_at: datetime
    remark: str


class StatementOut(ORM):
    id: int
    user_id: int
    period_type: str
    period_start: object
    opening_balance: int
    closing_balance: int
    recharged: int
    consumed: int
    refunded: int
    package_tokens: int
    requests: int
    prompt_tokens: int
    completion_tokens: int
    detail: dict
