"""支付网关抽象。真实支付宝/微信接入时实现 PaymentProvider 并在 PROVIDERS 中注册即可。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.models.commerce import Order


@dataclass(slots=True)
class PaymentLaunch:
    pay_url: str  # 收银台 / 跳转地址
    qr_code: str = ""  # 扫码支付内容（微信 Native 等）


@dataclass(slots=True)
class PaymentNotice:
    order_no: str
    trade_no: str
    amount: int  # 实付金额，微元
    success: bool


class PaymentProvider(Protocol):
    name: str

    async def launch(self, order: Order) -> PaymentLaunch: ...

    def parse_notify(self, params: dict[str, str]) -> PaymentNotice:
        """校验签名并解析回调；签名不合法抛出 ValueError。"""
        ...

    def notify_ack(self) -> str:
        """回调处理成功后返回给网关的应答内容。"""
        ...


class NotConfiguredProvider:
    def __init__(self, name: str):
        self.name = name

    async def launch(self, order: Order) -> PaymentLaunch:
        from app.core.errors import AppError

        raise AppError(f"支付渠道 {self.name} 尚未接入，请联系管理员", status=503, code="payment_unavailable")

    def parse_notify(self, params: dict[str, str]) -> PaymentNotice:
        raise ValueError("provider not configured")

    def notify_ack(self) -> str:
        return "fail"
