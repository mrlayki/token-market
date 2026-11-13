"""额度引擎测试：使用真实 Redis（TM_TEST_REDIS_URL，默认 redis://localhost:16399/15）。"""

import asyncio
import os
import time
from decimal import Decimal

import orjson
import pytest
from redis.asyncio import Redis

from app.billing.pricing import PackageRule, PriceSnapshot, Usage
from app.models.billing import SCOPE_ALL, SCOPE_MODELS
from app.quota.engine import USAGE_STREAM, QuotaEngine, QuotaError, Snapshot, k_wallet

REDIS_URL = os.getenv("TM_TEST_REDIS_URL", "redis://localhost:16399/15")

# 1 元/百万输入，2 元/百万输出
PRICE = PriceSnapshot(model="m1", input_price=1_000_000, output_price=2_000_000)


def pkg(pid: int, days: float = 30, scope=SCOPE_ALL, values=None, ow="1") -> PackageRule:
    return PackageRule(id=pid, input_weight=Decimal("1"), output_weight=Decimal(ow),
                       expires_at=time.time() + days * 86400, scope_type=scope, scope_values=values or [])


@pytest.fixture
async def r():
    client = Redis.from_url(REDIS_URL, decode_responses=True, max_connections=1000)
    try:
        await client.ping()
    except Exception:
        pytest.skip("测试 Redis 不可用")
    await client.flushdb()
    yield client
    await client.flushdb()
    await client.aclose()


def make_engine(r, balance=0, packages=None, token_rem=0):
    async def snap(uid):
        return Snapshot(balance=balance, ext_version=1, packages=packages or [])

    async def tok(tid):
        return token_rem

    return QuotaEngine(r, snap, tok, reservation_ttl=60)


async def reserve(e, rid, est, uid=1, packages=None, token_id=None, limited=False):
    return await e.reserve(rid=rid, uid=uid, token_id=token_id, token_limited=limited,
                           packages=packages or [], est=est, price=PRICE, ctx={})


async def test_wallet_reserve_and_refund(r):
    e = make_engine(r, balance=1_000_000)  # 1 元
    # 预估 10 万输入 + 10 万输出 = 0.1 + 0.2 = 0.3 元
    rv = await reserve(e, "a", Usage(100_000, 100_000))
    assert rv.wallet == 300_000
    assert (await e.balance(1))["bal"] == 700_000
    assert (await e.balance(1))["frz"] == 300_000
    # 实际只用了 1 万输入 + 5 千输出 = 0.01 + 0.01 = 0.02 元，多退
    res = await e.settle(rid="a", uid=1, token_id=None, packages=[], actual=Usage(10_000, 5_000),
                         price=PRICE, overdraft=0, event={"rid": "a"})
    assert res.ok and res.wallet == 20_000
    b = await e.balance(1)
    assert b["bal"] == 980_000 and b["frz"] == 0
    # 结算事件已原子写入 stream
    entries = await r.xrange(USAGE_STREAM)
    assert len(entries) == 1
    ev = orjson.loads(entries[0][1]["d"])
    assert ev["settle"]["wallet"] == 20_000


async def test_insufficient_does_not_mutate(r):
    e = make_engine(r, balance=100)
    with pytest.raises(QuotaError) as ei:
        await reserve(e, "x", Usage(100_000, 0))
    assert ei.value.code == "insufficient_balance"
    assert (await e.balance(1)) == {"bal": 100, "frz": 0, "loaded": True, "pkgs": {}}


async def test_packages_first_by_expiry_then_wallet(r):
    p_late = pkg(2, days=60)
    p_soon = pkg(1, days=5)
    e = make_engine(r, balance=1_000_000, packages=[(p_late, 1_000), (p_soon, 500)])
    cands = await e.candidate_packages(1, "m1", None)
    assert [c.id for c in cands] == [1, 2]  # 先到期的先扣
    # 预估 3000 token（2000 输入 + 1000 输出）：包1 500 + 包2 1000 覆盖一半，剩余一半走钱包
    rv = await reserve(e, "p", Usage(2_000, 1_000), packages=cands)
    assert [(a["id"], a["r"]) for a in rv.alloc if a["b"] == "pkg"] == [(1, 500), (2, 1000)]
    full_cost = PRICE.cost(Usage(2_000, 1_000))  # 0.004 元 = 4000 微元
    assert rv.wallet == full_cost // 2
    # 实际只用了 1000 token：全部由包1 覆盖，包2 与钱包全部退回
    res = await e.settle(rid="p", uid=1, token_id=None, packages=cands, actual=Usage(600, 400),
                         price=PRICE, overdraft=0, event=None)
    assert res.wallet == 0
    assert {p["id"]: p["used"] for p in res.pkgs} == {1: 500, 2: 500}
    b = await e.balance(1)
    assert b["pkgs"] == {1: 0, 2: 500} and b["bal"] == 1_000_000 and b["frz"] == 0


async def test_package_scope_filter(r):
    e = make_engine(r, balance=0, packages=[(pkg(1, scope=SCOPE_MODELS, values=["deepseek-chat"]), 10)])
    await e.ensure_loaded(1)
    assert [p.id for p in await e.candidate_packages(1, "deepseek-chat", None)] == [1]
    assert await e.candidate_packages(1, "gpt-4o", None) == []


async def test_overrun_uses_balance_then_overdraft(r):
    e = make_engine(r, balance=50_000)
    rv = await reserve(e, "o", Usage(10_000, 0))  # 预扣 0.01 元
    assert rv.wallet == 10_000
    # 实际 0.1 元：额外 0.09 元，可用 0.04 + 透支 0.02 = 0.06，缺口 0.03
    res = await e.settle(rid="o", uid=1, token_id=None, packages=[], actual=Usage(100_000, 0),
                         price=PRICE, overdraft=20_000, event=None)
    assert res.wallet == 70_000 and res.shortfall == 30_000
    assert (await e.balance(1))["bal"] == -20_000


async def test_settle_idempotent_and_release(r):
    e = make_engine(r, balance=1_000_000)
    await reserve(e, "i", Usage(100_000, 0))
    first = await e.release(rid="i", uid=1, token_id=None, event=None)
    assert first.ok and first.wallet == 0
    again = await e.release(rid="i", uid=1, token_id=None, event=None)
    assert not again.ok
    assert (await e.balance(1))["bal"] == 1_000_000


async def test_token_quota_limit(r):
    e = make_engine(r, balance=10_000_000, token_rem=150_000)
    await reserve(e, "t1", Usage(100_000, 0), token_id=7, limited=True)
    with pytest.raises(QuotaError) as ei:
        await reserve(e, "t2", Usage(100_000, 0), token_id=7, limited=True)
    assert ei.value.code == "token_quota_exceeded"


async def test_apply_external_version_guard(r):
    e = make_engine(r, balance=100)  # 快照 ext_version = 1
    await e.ensure_loaded(1)
    assert await e.apply_external(1, ver=1, op="topup:old", bal_delta=999) == "skip_snapshot"
    assert await e.apply_external(1, ver=2, op="topup:new", bal_delta=1000) == "applied"
    assert await e.apply_external(1, ver=2, op="topup:new", bal_delta=1000) == "skip_dup"
    assert (await e.balance(1))["bal"] == 1100


async def test_concurrent_no_oversell(r):
    """500 个并发请求争抢 1 元余额，每个预扣 0.01 元：恰好 100 个成功，余额永不为负。"""
    e = make_engine(r, balance=1_000_000)
    await e.ensure_loaded(1)

    async def one(i):
        try:
            await reserve(e, f"c{i}", Usage(10_000, 0))
            return True
        except QuotaError:
            return False

    results = await asyncio.gather(*(one(i) for i in range(500)))
    assert sum(results) == 100
    b = await e.balance(1)
    assert b["bal"] == 0 and b["frz"] == 1_000_000


async def test_naive_mode_oversells(r):
    """对照组：先查后扣在并发下超卖。"""
    e = make_engine(r, balance=1_000_000)
    await e.ensure_loaded(1)
    results = await asyncio.gather(*(e.naive_reserve(uid=1, cost=10_000) for _ in range(500)))
    assert sum(results) > 100
    assert int(await r.hget(k_wallet(1), "bal")) < 0
