"""接口巡检：用合法参数调用管理端 / 用户端 / 公开接口的全部读写操作，报告所有 5xx。

测试数据（渠道、供应商、模型、套餐、公告、兑换码、用户）用后清理或禁用。
用法：PYTHONPATH=server server/.venv/bin/python scripts/api_sweep.py [--admin http://localhost:8081] [--site http://localhost:8080]
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
os.chdir(os.path.join(os.path.dirname(__file__), "..", "server"))
from app.core.config import settings  # noqa: E402

R, G, Y, E = "\033[31m", "\033[32m", "\033[33m", "\033[0m"


class Sweep:
    def __init__(self, admin: str, site: str):
        self.c = httpx.Client(timeout=60, trust_env=False)
        self.admin, self.site = admin, site
        self.fail: list[str] = []
        self.warn: list[str] = []
        self.n = 0

    def call(self, method: str, url: str, token: str | None = None, ok4xx: bool = False, **kw):
        self.n += 1
        h = {"Authorization": f"Bearer {token}"} if token else {}
        r = self.c.request(method, url, headers=h, **kw)
        tag = f"{method} {url.split('//', 1)[1].split('/', 1)[1]}"
        if r.status_code >= 500:
            self.fail.append(f"{tag} → {r.status_code} {r.text[:200]}")
        elif r.status_code >= 400 and not ok4xx:
            self.warn.append(f"{tag} → {r.status_code} {r.text[:200]}")
        try:
            return r.json()
        except Exception:  # noqa: BLE001
            return None

    # ------------------------------------------------------------ 管理端
    def run_admin(self) -> None:
        A = self.admin + "/api/admin"
        t = self.call("POST", self.admin + "/api/auth/login",
                      json={"username": settings.root_username, "password": settings.root_password})["token"]
        sfx = uuid.uuid4().hex[:6]
        for path, q in [("/dashboard", {"days": d}) for d in (1, 7, 30)] + [
            ("/channels", {}), ("/channels/types", {}), ("/channels/tags", {}), ("/vendors", {}), ("/models", {}),
            ("/models", {"priced": "false"}), ("/models", {"listed": "true", "keyword": "gpt"}), ("/models/missing", {}),
            ("/groups", {}), ("/package-products", {}), ("/users", {"keyword": "a"}), ("/orders", {}),
            ("/redemption-codes", {}), ("/logs", {"page_size": 5}), ("/ledger", {}), ("/audit-logs", {}),
            ("/statements", {"period_type": "day"}), ("/statements", {"period_type": "month"}), ("/recon", {}),
            ("/settings", {}), ("/announcements", {}), ("/notifications", {"unread": "true"}), ("/system/health", {}),
        ]:
            self.call("GET", A + path, t, params=q)

        # 供应商 / 模型 / 价格
        v = self.call("POST", A + "/vendors", t, json={"name": f"sweep{sfx}", "display_name": "Sweep"})
        m = self.call("POST", A + "/models", t, json={"name": f"sweep-model-{sfx}", "vendor_id": v["id"], "tags": ["测试"]})
        self.call("PUT", A + f"/models/{m['id']}", t, json={"name": m["name"], "vendor_id": v["id"], "listed": False,
                                                           "context_length": 1000, "max_output_tokens": 100})
        self.call("POST", A + "/models/batch", t, json={"names": [f"sweep-b-{sfx}"], "vendor_id": v["id"]})
        self.call("POST", A + "/prices", t, json={"model": m["name"], "input_price": 1_000_000, "output_price": 2_000_000})
        fut = (datetime.now(UTC) + timedelta(days=3)).isoformat()
        p2 = self.call("POST", A + "/prices", t, json={"model": m["name"], "input_price": 3, "effective_at": fut})
        self.call("POST", A + "/prices/batch", t, json={"items": [{"model": m["name"], "billing_type": "per_call",
                                                                    "per_call_price": 1000}]})
        self.call("GET", A + f"/prices/{m['name']}/history", t)
        self.call("POST", A + "/prices/preview", t, json={"model": m["name"], "prompt_tokens": 100, "completion_tokens": 50,
                                                          "cache_read_tokens": 10, "cache_write_tokens": 5})
        self.call("DELETE", A + f"/prices/{p2['id']}", t)

        # 渠道（含小数字段、JSON 字段）
        ch = self.call("POST", A + "/channels", t, json={
            "name": f"sweep-{sfx}", "type": "openai_compatible", "base_url": "http://mock-upstream:8090/v1",
            "models": ["mock-gpt", m["name"]], "model_mapping": {m["name"]: "mock-gpt"}, "groups": ["default"],
            "priority": -5, "weight": 3, "cost_ratio": "0.85", "param_override": {"temperature": 0.5},
            "header_override": {"X-Test": "1"}, "keys": "sk-sweep-1\nsk-sweep-2", "tag": "sweep", "remark": "巡检"})
        cid = ch["id"]
        self.call("PUT", A + f"/channels/{cid}", t, json={"cost_ratio": "0.7", "weight": 5, "priority": -6,
                                                          "multi_key_mode": "polling", "auto_ban": False})
        self.call("PUT", A + f"/channels/{cid}", t, json={"keys": "sk-sweep-3", "replace_keys": False})
        self.call("GET", A + f"/channels/{cid}", t)
        keys = self.call("GET", A + f"/channels/{cid}/keys", t)
        self.call("POST", A + f"/channels/{cid}/keys/{keys[0]['id']}/status", t, json={"status": 2})
        self.call("POST", A + f"/channels/{cid}/keys/enable-auto-disabled", t)
        self.call("DELETE", A + f"/channels/{cid}/keys/{keys[-1]['id']}", t)
        self.call("POST", A + f"/channels/{cid}/test", t, json={"model": "mock-gpt"})
        self.call("POST", A + f"/channels/{cid}/test", t, json={"model": "mock-gpt", "stream": True})
        self.call("POST", A + f"/channels/{cid}/balance", t)
        self.call("POST", A + "/channels/fetch-models", t, json={"type": "openai_compatible", "channel_id": cid})
        self.call("POST", A + f"/channels/{cid}/status", t, json={"status": 2})
        self.call("POST", A + "/channels/batch", t, json={"ids": [cid], "action": "set_tag", "value": "sweep2"})
        self.call("POST", A + "/channels/batch", t, json={"tag": "sweep2", "action": "set_priority", "value": -7})
        self.call("POST", A + "/channels/test/batch", t, json={"ids": [cid], "scope": "selected"})
        cp = self.call("POST", A + f"/channels/{cid}/copy", t)
        self.call("GET", A + "/models", t, params={"keyword": "sweep"})
        for x in (cid, cp["id"]):
            self.call("DELETE", A + f"/channels/{x}", t)

        # 分组 / 套餐 / 用户 / 兑换码
        self.call("POST", A + "/groups", t, json={"name": f"sw{sfx}", "display_name": "巡检组", "price_ratio": "0.85",
                                                  "topup_ratio": "1.05", "usable_groups": ["default"]})
        prod = self.call("POST", A + "/package-products", t, json={
            "name": f"巡检包{sfx}", "price": 1_000_000, "tokens": 1000, "scope_type": "models",
            "scope_values": ["mock-gpt"], "input_weight": "1", "output_weight": "2.5", "valid_days": 7})
        self.call("PUT", A + f"/package-products/{prod['id']}", t, json={**{k: prod[k] for k in (
            "name", "description", "price", "tokens", "scope_type", "scope_values", "valid_days")},
            "output_weight": "3.5", "on_sale": False})
        u = self.call("POST", A + "/users", t, json={"username": f"sweep_{sfx}", "password": "Sweep12345!", "group": f"sw{sfx}"})
        uid = u["id"]
        self.call("PUT", A + f"/users/{uid}", t, json={"remark": "巡检", "display_name": "巡检用户"})
        # 切回 default 分组（有可用渠道），后续用户端调用才能路由
        self.call("PUT", A + f"/users/{uid}", t, json={"group": "default"})
        self.call("POST", A + f"/users/{uid}/adjust", t, json={"amount": 5_000_000, "remark": "巡检"})
        self.call("POST", A + f"/users/{uid}/grant-package", t, json={"product_id": prod["id"], "quantity": 2})
        pk = self.call("GET", A + f"/users/{uid}/packages", t)
        self.call("POST", A + f"/user-packages/{pk[0]['id']}/revoke", t)
        self.call("GET", A + f"/users/{uid}", t)
        self.call("POST", A + f"/users/{uid}/rebuild-quota", t, ok4xx=True)
        gen = self.call("POST", A + "/redemption-codes", t, json={"name": "巡检", "type": "quota", "quota_amount": 1_000_000,
                                                                  "count": 2})
        gen2 = self.call("POST", A + "/redemption-codes", t, json={"name": "巡检包", "type": "package",
                                                                   "package_product_id": prod["id"], "count": 1,
                                                                   "expires_at": fut})
        self.call("GET", A + "/redemption-codes/export", t, params={"batch_no": gen["batch_no"]})
        codes = self.call("GET", A + "/redemption-codes", t, params={"batch_no": gen["batch_no"]})["items"]
        to_disable = next(c for c in codes if c["code"] == gen["codes"][0])
        self.call("POST", A + f"/redemption-codes/{to_disable['id']}/disable", t)

        # 运营 / 财务
        an = self.call("POST", A + "/announcements", t, json={"title": "巡检", "content": "**md**", "level": "warning"})
        self.call("PUT", A + f"/announcements/{an['id']}", t, json={"title": "巡检2", "content": "x", "pinned": True})
        self.call("DELETE", A + f"/announcements/{an['id']}", t)
        notes = self.call("GET", A + "/notifications", t)["items"]
        if notes:
            self.call("POST", A + f"/notifications/{notes[0]['id']}/read", t)
        self.call("GET", A + "/logs/export", t, params={"model": "mock-gpt"})
        self.call("POST", A + "/recon/run", t, json={"kind": "all"})
        rec = self.call("GET", A + "/recon", t)["items"]
        if rec:
            self.call("POST", A + f"/recon/{rec[0]['id']}/resolve", t)
        self.call("POST", A + "/statements/build", t, json={"period_type": "day",
                                                            "period_start": (datetime.now(UTC) - timedelta(days=1)).date().isoformat()})
        cfg = {x["key"]: x["value"] for x in self.call("GET", A + "/settings", t)}
        self.call("PUT", A + "/settings", t, json={"values": {"site.footer": cfg["site.footer"],
                                                              "payment.discounts": cfg["payment.discounts"],
                                                              "channel.retry_times": cfg["channel.retry_times"]}})

        self.user_ctx = {"username": f"sweep_{sfx}", "password": "Sweep12345!", "code": gen["codes"][1],
                         "pkg_code": gen2["codes"][0], "product": prod["id"]}
        self.cleanup = lambda: [
            self.call("DELETE", A + f"/package-products/{prod['id']}", t, ok4xx=True),
            self.call("PUT", A + f"/users/{uid}", t, json={"status": 2, "group": "default"}),
            self.call("DELETE", A + f"/groups/sw{sfx}", t, ok4xx=True),
            self.call("DELETE", A + f"/models/{m['id']}", t),
            *[self.call("DELETE", A + f"/models/{x['id']}", t)
              for x in self.call("GET", A + "/models", t, params={"keyword": f"sweep-b-{sfx}"})["items"]],
            self.call("DELETE", A + f"/vendors/{v['id']}", t),
        ]

    # ------------------------------------------------------------ 用户端 / 公开
    def run_console(self) -> None:
        S = self.site
        P = S + "/api/public"
        for path in ("/site", "/models", "/packages", "/announcements"):
            self.call("GET", P + path)
        self.call("GET", P + "/models", params={"group": "vip"})
        t = self.call("POST", S + "/api/auth/login", json={"username": self.user_ctx["username"],
                                                          "password": self.user_ctx["password"]})["token"]
        C = S + "/api/console"
        for path, q in (("/overview", {}), ("/usage/stats", {"days": 30}), ("/wallet", {}), ("/ledger", {}),
                        ("/packages", {}), ("/orders", {}), ("/logs", {}), ("/statements", {"period_type": "day"}),
                        ("/notifications", {}), ("/groups", {}), ("/package-products", {})):
            self.call("GET", C + path, t, params=q)
        self.call("GET", S + "/api/auth/me", t)
        self.call("PUT", S + "/api/auth/profile", t, json={"display_name": "巡检"})
        tk = self.call("POST", C + "/tokens", t, json={"name": "sweep", "unlimited": False, "quota_limit": 1_000_000,
                                                       "model_limits": ["mock-gpt"], "allow_ips": ["0.0.0.0/0"],
                                                       "rpm_limit": 100})
        self.call("PUT", C + f"/tokens/{tk['id']}", t, json={"name": "sweep2", "unlimited": True})
        self.call("POST", C + f"/tokens/{tk['id']}/status", t, json={"status": 2})
        self.call("POST", C + f"/tokens/{tk['id']}/status", t, json={"status": 1})
        self.call("POST", C + "/topup/quote", t, json={"amount": "520.5"})
        o = self.call("POST", C + "/orders", t, json={"type": "topup", "pay_method": "alipay", "amount": "10"})
        self.call("GET", C + f"/orders/{o['order']['order_no']}", t)
        self.call("POST", C + f"/orders/{o['order']['order_no']}/mock-pay", t)
        o2 = self.call("POST", C + "/orders", t, json={"type": "topup", "pay_method": "wechat", "amount": "1"})
        self.call("POST", C + f"/orders/{o2['order']['order_no']}/cancel", t)
        self.call("POST", C + "/redeem", t, json={"code": self.user_ctx["code"]})
        self.call("POST", C + "/redeem", t, json={"code": self.user_ctx["pkg_code"]})
        self.call("POST", C + "/redeem", t, ok4xx=True, json={"code": self.user_ctx["code"]})
        r = self.c.post(C + "/playground/chat/completions", headers={"Authorization": f"Bearer {t}"},
                        json={"model": "mock-gpt", "max_tokens": 3, "messages": [{"role": "user", "content": "x"}]})
        self.n += 1
        if r.status_code >= 500:
            self.fail.append(f"POST playground → {r.status_code} {r.text[:200]}")
        self.call("DELETE", C + f"/tokens/{tk['id']}", t)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--admin", default=os.getenv("TM_ADMIN", "http://localhost:8081"))
    ap.add_argument("--site", default=os.getenv("TM_SITE", "http://localhost:8080"))
    a = ap.parse_args()
    s = Sweep(a.admin, a.site)
    try:
        s.run_admin()
        s.run_console()
    finally:
        if hasattr(s, "cleanup"):
            s.cleanup()
    print(f"共调用 {s.n} 个接口")
    for w in s.warn:
        print(f"{Y}4xx{E} {w}")
    for f in s.fail:
        print(f"{R}5xx{E} {f}")
    print(f"{G}无 5xx 错误{E}" if not s.fail else f"{R}{len(s.fail)} 个 5xx 错误{E}")
    sys.exit(1 if s.fail else 0)


if __name__ == "__main__":
    main()
