"""防超卖演示。

A. 引擎级对比：同一余额、同样并发，「先查后扣」(naive) vs「Redis Lua 原子预扣」(lua)
B. 端到端：真实 HTTP 并发打到中转服务（Mock 上游），校验成功数、余额、账务一致性

用法（在项目根目录）：
  make bench                      # 或
  PYTHONPATH=server server/.venv/bin/python scripts/bench_oversell.py --concurrency 300
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
import uuid

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
os.chdir(os.path.join(os.path.dirname(__file__), "..", "server"))

from redis.asyncio import Redis  # noqa: E402

from app.billing.pricing import PriceSnapshot, Usage  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.quota.engine import QuotaEngine, QuotaError, Snapshot, k_wallet  # noqa: E402

GREEN, RED, BOLD, END = "\033[32m", "\033[31m", "\033[1m", "\033[0m"


def line(title: str) -> None:
    print(f"\n{BOLD}{'=' * 8} {title} {'=' * 8}{END}")


# ---------------------------------------------------------------- A. 引擎级
async def engine_compare(concurrency: int, balance: int, cost: int) -> None:
    line(f"A. 引擎级对比：余额 ¥{balance / 1e6:.2f}，{concurrency} 个并发请求，每个预扣 ¥{cost / 1e6:.4f}")
    r = Redis.from_url(settings.redis_url, decode_responses=True, max_connections=concurrency + 50)
    expect = balance // cost
    price = PriceSnapshot(model="bench", billing_type="per_call", per_call_price=cost)
    for mode in ("naive", "lua"):
        uid = 900_000_000 + int(time.time() * 1000) % 1_000_000

        async def snap(_uid, b=balance):
            return Snapshot(balance=b, ext_version=1, packages=[])

        async def tok(_tid):
            return 0

        eng = QuotaEngine(r, snap, tok, reservation_ttl=60)
        await eng.ensure_loaded(uid)

        async def one(i: int) -> bool:
            if mode == "naive":
                return await eng.naive_reserve(uid=uid, cost=cost)
            try:
                await eng.reserve(rid=f"b{i}", uid=uid, token_id=None, token_limited=False, packages=[],
                                  est=Usage(), price=price, ctx={})
                return True
            except QuotaError:
                return False

        t0 = time.perf_counter()
        ok = sum(await asyncio.gather(*(one(i) for i in range(concurrency))))
        el = (time.perf_counter() - t0) * 1000
        bal = int(await r.hget(k_wallet(uid), "bal"))
        oversold = max(ok - expect, 0)
        color = RED if oversold else GREEN
        print(f"  [{mode:5}] 成功 {ok:4d} / 理论上限 {expect}  剩余余额 ¥{bal / 1e6:8.4f}  "
              f"{color}超卖 {oversold} 笔{END}  耗时 {el:.0f}ms")
        # 清理：释放演示用的预扣单（虚拟用户不落库），避免被超时回收任务回收后进入死信
        if mode == "lua":
            for i in range(concurrency):
                await eng.settle_raw(rid=f"b{i}", uid=uid, token_id=None, act_pkgs={}, act_cost=0, overdraft=0,
                                     event=None)
        await r.delete(k_wallet(uid), f"tm:{{u:{uid}}}:p", f"tm:{{u:{uid}}}:pm")
    await r.aclose()


# ---------------------------------------------------------------- B. 端到端
async def e2e(api: str, relay: str, concurrency: int, balance_yuan: str, model: str) -> None:
    line(f"B. 端到端：用户余额 ¥{balance_yuan}，{concurrency} 个并发流式请求 → {relay}（模型 {model}）")
    async with httpx.AsyncClient(timeout=120, trust_env=False) as c:
        root = (await c.post(f"{api}/api/auth/login", json={"username": settings.root_username,
                                                           "password": settings.root_password})).json()["token"]
        H = {"Authorization": f"Bearer {root}"}
        name = "bench_" + uuid.uuid4().hex[:8]
        u = (await c.post(f"{api}/api/admin/users", headers=H,
                          json={"username": name, "password": "Bench12345!", "group": "default"})).json()
        await c.post(f"{api}/api/admin/users/{u['id']}/adjust", headers=H,
                     json={"amount": int(float(balance_yuan) * 1e6), "remark": "压测初始余额"})
        ut = (await c.post(f"{api}/api/auth/login", json={"username": name, "password": "Bench12345!"})).json()["token"]
        key = (await c.post(f"{api}/api/console/tokens", headers={"Authorization": f"Bearer {ut}"},
                            json={"name": "bench"})).json()["key"]

    limits = httpx.Limits(max_connections=concurrency + 10, max_keepalive_connections=concurrency)
    stats = {"ok": 0, "402": 0, "other": 0}

    async with httpx.AsyncClient(timeout=180, limits=limits, trust_env=False) as c:
        async def one(i: int) -> None:
            body = {"model": model, "stream": True, "max_tokens": 64,
                    "messages": [{"role": "user", "content": f"并发压测 #{i}"}]}
            async with c.stream("POST", f"{relay}/v1/chat/completions", json=body,
                                headers={"Authorization": f"Bearer {key}"}) as resp:
                await resp.aread()
                if resp.status_code == 200:
                    stats["ok"] += 1
                elif resp.status_code == 402:
                    stats["402"] += 1
                else:
                    stats["other"] += 1

        t0 = time.perf_counter()
        await asyncio.gather(*(one(i) for i in range(concurrency)))
        el = time.perf_counter() - t0
    print(f"  成功 {stats['ok']}，额度不足拒绝(402) {stats['402']}，其他 {stats['other']}，耗时 {el:.1f}s，"
          f"吞吐 {concurrency / el:.0f} req/s")

    await asyncio.sleep(3)  # 等待 worker 落库
    async with httpx.AsyncClient(timeout=60, trust_env=False) as c:
        H = {"Authorization": f"Bearer {root}"}
        detail = (await c.get(f"{api}/api/admin/users/{u['id']}", headers=H)).json()
        live = detail["live"] or {}
        pg = detail["user"]["balance"]
        led = (await c.get(f"{api}/api/admin/ledger", headers=H, params={"user_id": u["id"], "page_size": 200})).json()
        ledger_sum = sum(x["amount"] for x in led["items"] if x["bucket_type"] == "wallet")
        consumed = -sum(x["amount"] for x in led["items"] if x["biz_type"] == "consume")
        recon = (await c.post(f"{api}/api/admin/recon/run", headers=H, json={"kind": "all"})).json()
    neg = pg < 0
    print(f"  Redis 可用 ¥{live.get('bal', 0) / 1e6:.6f}  冻结 ¥{live.get('frz', 0) / 1e6:.6f}  "
          f"PG 余额 ¥{pg / 1e6:.6f}  流水合计 ¥{ledger_sum / 1e6:.6f}  消费 ¥{consumed / 1e6:.6f}")
    print(f"  余额为负：{RED + '是' + END if neg else GREEN + '否' + END}   "
          f"Redis=PG：{GREEN + '一致' + END if live.get('bal', 0) + live.get('frz', 0) == pg else RED + '不一致' + END}   "
          f"PG=流水：{GREEN + '一致' + END if pg == ledger_sum else RED + '不一致' + END}")
    for rep in recon:
        st = GREEN + rep["status"] + END if rep["status"] == "ok" else RED + rep["status"] + END
        print(f"  对账 {rep['kind']:20} {st}  checked={rep['checked']} mismatched={rep['mismatched']}")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--concurrency", type=int, default=300)
    ap.add_argument("--api", default=os.getenv("TM_API", "http://localhost:18000"))
    ap.add_argument("--relay", default=os.getenv("TM_RELAY", "http://localhost:18001"))
    ap.add_argument("--balance", default="0.002", help="端到端测试用户余额（元）")
    ap.add_argument("--model", default="mock-gpt")
    ap.add_argument("--skip-e2e", action="store_true")
    a = ap.parse_args()
    await engine_compare(a.concurrency, balance=1_000_000, cost=10_000)
    if not a.skip_e2e:
        await e2e(a.api, a.relay, a.concurrency, a.balance, a.model)


if __name__ == "__main__":
    asyncio.run(main())
