"""故障注入与兜底演示（依赖 Mock 上游的故障注入接口）。

场景：
  1 客户端中途断开     → 按已生成部分计费，status=client_abort，冻结释放
  2 上游流中途截断     → 按已生成部分计费，status=failed
  3 上游不返回 usage   → 按文本估算，usage_estimated=true
  4 上游 500          → 自动切换 Key/渠道重试成功，retry_count>0
  5 上游 401          → Key 自动禁用 + 管理员通知 + 重试成功（演示后自动恢复）
  6 Redis 故障（可选 --redis-down，需 docker compose）→ 降级 PG 条件扣减，恢复后 outbox 同步热数据

用法：PYTHONPATH=server server/.venv/bin/python scripts/fault_demo.py [--redis-down]
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
import uuid

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
os.chdir(os.path.join(os.path.dirname(__file__), "..", "server"))
from app.core.config import settings  # noqa: E402

API = os.getenv("TM_API", "http://localhost:18000")
RELAY = os.getenv("TM_RELAY", "http://localhost:18001")
MOCK = os.getenv("TM_MOCK", "http://localhost:18090")
B, G, R, Y, E = "\033[1m", "\033[32m", "\033[31m", "\033[33m", "\033[0m"


async def setup(c: httpx.AsyncClient) -> tuple[str, dict, int]:
    root = (await c.post(f"{API}/api/auth/login", json={"username": settings.root_username,
                                                       "password": settings.root_password})).json()["token"]
    H = {"Authorization": f"Bearer {root}"}
    name = "fault_" + uuid.uuid4().hex[:8]
    u = (await c.post(f"{API}/api/admin/users", headers=H, json={"username": name, "password": "Fault12345!"})).json()
    await c.post(f"{API}/api/admin/users/{u['id']}/adjust", headers=H, json={"amount": 10_000_000, "remark": "故障演示"})
    ut = (await c.post(f"{API}/api/auth/login", json={"username": name, "password": "Fault12345!"})).json()["token"]
    key = (await c.post(f"{API}/api/console/tokens", headers={"Authorization": f"Bearer {ut}"},
                        json={"name": "fault-demo"})).json()["key"]
    return key, H, u["id"]


async def fault(c: httpx.AsyncClient, f: str | None, count: int = 1) -> None:
    await c.post(f"{MOCK}/_mock/fault", json={"fault": f, "count": count})


async def last_log(c: httpx.AsyncClient, H: dict, uid: int) -> dict:
    await asyncio.sleep(2.5)
    items = (await c.get(f"{API}/api/admin/logs", headers=H, params={"user_id": uid, "page_size": 1})).json()["items"]
    return items[0] if items else {}


def show(title: str, log: dict, expect: str) -> None:
    est = f"{Y}估算{E}" if log.get("usage_estimated") else "上游"
    print(f"{B}{title}{E}\n  状态={log.get('status')} http={log.get('http_status')} 输入={log.get('prompt_tokens')} "
          f"输出={log.get('completion_tokens')}({est}) 扣费=¥{log.get('wallet_amount', 0) / 1e6:.6f} "
          f"重试={log.get('retry_count')} 渠道Key=#{log.get('channel_key_id')}\n  预期：{expect}\n")


def body(stream=True, n=60):
    return {"model": "mock-gpt", "stream": stream, "max_tokens": n, "messages": [{"role": "user", "content": "故障演示"}]}


async def main(redis_down: bool) -> None:
    async with httpx.AsyncClient(timeout=60, trust_env=False) as c:
        key, H, uid = await setup(c)
        K = {"Authorization": f"Bearer {key}"}

        # 1 客户端断开
        try:
            async with c.stream("POST", f"{RELAY}/v1/chat/completions", json=body(n=200), headers=K) as resp:
                got = 0
                async for _ in resp.aiter_bytes():
                    got += 1
                    if got > 10:
                        break
        except httpx.HTTPError:
            pass
        show("① 客户端读取 10 个分片后断开", await last_log(c, H, uid), "client_abort，按已生成部分计费（估算），冻结释放")

        # 2 上游截断
        await fault(c, "cut")
        await c.post(f"{RELAY}/v1/chat/completions", json=body(n=40), headers=K)
        show("② 上游流输出一半后断开（无结束标志）", await last_log(c, H, uid), "failed，按已生成部分计费")

        # 3 无 usage
        await fault(c, "nousage")
        await c.post(f"{RELAY}/v1/chat/completions", json=body(n=30), headers=K)
        show("③ 上游未返回 usage", await last_log(c, H, uid), "success，usage_estimated=true")

        # 4 500 重试
        await fault(c, "500")
        r = await c.post(f"{RELAY}/v1/chat/completions", json=body(stream=False, n=5), headers=K)
        show(f"④ 上游 500（客户端收到 {r.status_code}）", await last_log(c, H, uid), "自动切换 Key 重试成功，retry=1")

        # 5 401 自动禁用
        await fault(c, "401")
        r = await c.post(f"{RELAY}/v1/chat/completions", json=body(stream=False, n=5), headers=K)
        log = await last_log(c, H, uid)
        show(f"⑤ 上游 401（客户端收到 {r.status_code}）", log, "失败的 Key 被自动禁用并通知管理员，换 Key 重试成功")
        keys = (await c.get(f"{API}/api/admin/channels/1/keys", headers=H)).json()
        for k in keys:
            print(f"  Key #{k['id']} {k['key_mask']} 状态={k['status']} {k['status_reason']}")
        await c.post(f"{API}/api/admin/channels/1/keys/enable-auto-disabled", headers=H)
        print(f"  {G}已恢复自动禁用的 Key{E}\n")

        # 6 Redis 故障
        if redis_down:
            print(f"{B}⑥ Redis 故障降级{E}")
            subprocess.run(["docker", "compose", "stop", "redis"], check=True, capture_output=True,
                           cwd=os.path.join(os.path.dirname(__file__), ".."))
            try:
                r = await c.post(f"{RELAY}/v1/chat/completions", json=body(stream=False, n=5), headers=K, timeout=60)
                print(f"  Redis 停止时调用：HTTP {r.status_code}（PG 条件扣减降级）")
            finally:
                subprocess.run(["docker", "compose", "start", "redis"], check=True, capture_output=True,
                               cwd=os.path.join(os.path.dirname(__file__), ".."))
            await asyncio.sleep(8)
            h = (await c.get(f"{API}/api/admin/system/health", headers=H)).json()
            print(f"  Redis 恢复后 outbox 待同步：{h.get('outbox_pending')}（worker 每 5s 投递）")
            recon = (await c.post(f"{API}/api/admin/recon/run", headers=H, json={"kind": "all"})).json()
            for rep in recon:
                print(f"  对账 {rep['kind']:20} {rep['status']} mismatched={rep['mismatched']}")

        await fault(c, None, 0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--redis-down", action="store_true")
    asyncio.run(main(ap.parse_args().redis_down))
