"""模拟支付网关：完整走「下单 → 收银台 → 网关签名回调 → 验签 → 幂等发货」流程，便于在未接入真实支付时联调。"""

from __future__ import annotations

import secrets

from app.commerce.payments.base import PaymentLaunch, PaymentNotice
from app.core.config import settings
from app.core.security import sign_payload
from app.models.commerce import Order


class MockProvider:
    name = "mock"

    async def launch(self, order: Order) -> PaymentLaunch:
        url = f"{settings.public_base_url.rstrip('/')}/pay/{order.order_no}"
        return PaymentLaunch(pay_url=url, qr_code=url)

    @staticmethod
    def build_notify(order: Order) -> dict[str, str]:
        """模拟网关生成回调参数（真实场景由支付宝/微信服务器发起）。"""
        params = {
            "out_trade_no": order.order_no,
            "trade_no": "MOCK" + secrets.token_hex(10).upper(),
            "total_amount": str(order.pay_amount),
            "trade_status": "TRADE_SUCCESS",
            "pay_method": order.pay_method,
        }
        params["sign"] = sign_payload(params, settings.payment_notify_secret)
        return params

    def parse_notify(self, params: dict[str, str]) -> PaymentNotice:
        sign = params.get("sign", "")
        if not secrets.compare_digest(sign, sign_payload(params, settings.payment_notify_secret)):
            raise ValueError("invalid signature")
        return PaymentNotice(order_no=params["out_trade_no"], trade_no=params["trade_no"],
                             amount=int(params["total_amount"]), success=params.get("trade_status") == "TRADE_SUCCESS")

    def notify_ack(self) -> str:
        return "success"
