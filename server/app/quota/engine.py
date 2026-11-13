"""额度引擎：Redis Lua 多桶（套餐包 → 钱包）预扣 / 结算 / 释放。

热数据布局（同一用户的 key 使用相同 hash tag，便于未来迁移 Redis Cluster）：
  tm:{u:<uid>}:w        钱包   bal / frz / lver
  tm:{u:<uid>}:p        套餐余量 <pkg_id> -> 剩余 token
  tm:{u:<uid>}:pm       套餐规则 <pkg_id> -> JSON
  tm:{u:<uid>}:ops      已应用的外部变更 op 集合
  tm:{u:<uid>}:t:<tid>  令牌额度 rem
  tm:{u:<uid>}:r:<rid>  预扣单
  tm:rsv:deadline       预扣到期 ZSET（回收任务扫描）
  tm:stream:usage       计量事件 Stream（worker 消费落库）
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

import orjson
from redis.asyncio import Redis

from app.billing.pricing import PackageRule, PriceSnapshot, Usage

LUA_DIR = Path(__file__).parent / "lua"
USAGE_STREAM = "tm:stream:usage"
RSV_DEADLINE = "tm:rsv:deadline"


def k_wallet(uid: int) -> str:
    return f"tm:{{u:{uid}}}:w"


def k_pkgs(uid: int) -> str:
    return f"tm:{{u:{uid}}}:p"


def k_pkgmeta(uid: int) -> str:
    return f"tm:{{u:{uid}}}:pm"


def k_ops(uid: int) -> str:
    return f"tm:{{u:{uid}}}:ops"


def k_token(uid: int, tid: int | None) -> str:
    return f"tm:{{u:{uid}}}:t:{tid or 0}"


def k_rsv(uid: int, rid: str) -> str:
    return f"tm:{{u:{uid}}}:r:{rid}"


@dataclass(slots=True)
class Snapshot:
    """PG 中某用户的额度快照，用于初始化 Redis 热数据。"""

    balance: int
    ext_version: int
    packages: list[tuple[PackageRule, int]]  # (规则, 剩余 token)


@dataclass(slots=True)
class Reservation:
    rid: str
    uid: int
    alloc: list[dict]
    wallet: int  # 钱包冻结金额（微元）
    est_cost: int
    est_pkgs: dict[str, int]
    dup: bool = False

    @property
    def package_ids(self) -> list[int]:
        return [a["id"] for a in self.alloc if a["b"] == "pkg"]


@dataclass(slots=True)
class SettleResult:
    ok: bool
    wallet: int = 0
    shortfall: int = 0
    pkgs: list[dict] = field(default_factory=list)  # [{id, used}]

    @property
    def package_tokens(self) -> int:
        return sum(int(p["used"]) for p in self.pkgs)


class QuotaError(Exception):
    def __init__(self, code: str, detail: dict | None = None):
        super().__init__(code)
        self.code = code
        self.detail = detail or {}


SnapshotLoader = Callable[[int], Awaitable[Snapshot]]
TokenQuotaLoader = Callable[[int], Awaitable[int]]


def _as_list(v) -> list:
    # Redis cjson 把空表编码为 {}
    if isinstance(v, dict):
        return []
    return v or []


class QuotaEngine:
    def __init__(self, redis: Redis, snapshot_loader: SnapshotLoader, token_loader: TokenQuotaLoader,
                 reservation_ttl: int = 900):
        self.r = redis
        self.load_snapshot = snapshot_loader
        self.load_token_remaining = token_loader
        self.ttl = reservation_ttl
        self._reserve = redis.register_script((LUA_DIR / "reserve.lua").read_text())
        self._settle = redis.register_script((LUA_DIR / "settle.lua").read_text())
        self._load = redis.register_script((LUA_DIR / "load.lua").read_text())
        self._apply_ext = redis.register_script((LUA_DIR / "apply_ext.lua").read_text())

    # ---------- 加载 ----------
    async def ensure_loaded(self, uid: int) -> None:
        if await self.r.exists(k_wallet(uid)):
            return
        snap = await self.load_snapshot(uid)
        payload = {
            "bal": snap.balance,
            "ver": snap.ext_version,
            "pkgs": [
                {"id": rule.id, "rem": rem, "meta": orjson.dumps(rule.to_meta()).decode()}
                for rule, rem in snap.packages
            ],
        }
        await self._load(keys=[k_wallet(uid), k_pkgs(uid), k_pkgmeta(uid)], args=[orjson.dumps(payload)])

    async def ensure_token_loaded(self, uid: int, tid: int) -> None:
        key = k_token(uid, tid)
        if await self.r.exists(key):
            return
        rem = await self.load_token_remaining(tid)
        await self.r.hsetnx(key, "rem", rem)

    async def invalidate_token(self, uid: int, tid: int) -> None:
        await self.r.delete(k_token(uid, tid))

    # ---------- 套餐候选 ----------
    async def candidate_packages(self, uid: int, model: str, vendor: str | None) -> list[PackageRule]:
        await self.ensure_loaded(uid)
        raw = await self.r.hgetall(k_pkgmeta(uid))
        now = time.time()
        rules = []
        for pid, meta in raw.items():
            rule = PackageRule.from_meta(int(pid), orjson.loads(meta))
            if rule.expires_at > now and rule.applies_to(model, vendor):
                rules.append(rule)
        rules.sort(key=lambda r: (r.expires_at, r.id))
        return rules

    # ---------- 预扣 ----------
    async def reserve(self, *, rid: str, uid: int, token_id: int | None, token_limited: bool,
                      packages: list[PackageRule], est: Usage, price: PriceSnapshot,
                      ctx: dict) -> Reservation:
        await self.ensure_loaded(uid)
        if token_limited and token_id:
            await self.ensure_token_loaded(uid, token_id)
        est_cost = price.cost(est)
        est_pkgs = {str(p.id): p.tokens_for(est) for p in packages}
        ctx = {**ctx, "est_cost": est_cost, "est_pkgs": est_pkgs, "token_id": token_id}
        payload = {
            "rid": rid,
            "pkgs": [{"id": p.id, "req": est_pkgs[str(p.id)]} for p in packages],
            "cost": est_cost,
            "limited": 1 if token_limited else 0,
            "ttl": self.ttl * 2,  # 预扣单比回收截止时间多活一倍，确保回收任务能读到
            "ctx": orjson.dumps(ctx).decode(),
        }
        keys = [k_wallet(uid), k_pkgs(uid), k_token(uid, token_id), k_rsv(uid, rid)]
        res = orjson.loads(await self._reserve(keys=keys, args=[orjson.dumps(payload)]))
        if not res.get("ok"):
            raise QuotaError(res.get("err", "unknown"), res)
        await self.r.zadd(RSV_DEADLINE, {f"{uid}:{rid}": time.time() + self.ttl})
        alloc = _as_list(res.get("alloc"))
        wallet = sum(int(a["r"]) for a in alloc if a["b"] == "wallet")
        return Reservation(rid=rid, uid=uid, alloc=alloc, wallet=wallet, est_cost=est_cost,
                           est_pkgs=est_pkgs, dup=bool(res.get("dup")))

    # ---------- 结算 ----------
    async def settle(self, *, rid: str, uid: int, token_id: int | None, packages: list[PackageRule],
                     actual: Usage, price: PriceSnapshot, overdraft: int,
                     event: dict | None) -> SettleResult:
        act_pkgs = {str(p.id): p.tokens_for(actual) for p in packages}
        return await self.settle_raw(rid=rid, uid=uid, token_id=token_id, act_pkgs=act_pkgs,
                                     act_cost=price.cost(actual), overdraft=overdraft, event=event)

    async def settle_raw(self, *, rid: str, uid: int, token_id: int | None, act_pkgs: dict[str, int],
                         act_cost: int, overdraft: int, event: dict | None) -> SettleResult:
        payload = {"rid": rid, "pkgs": act_pkgs, "cost": act_cost,
                   "overdraft": max(overdraft, 0), "event": event}
        keys = [k_wallet(uid), k_pkgs(uid), k_token(uid, token_id), k_rsv(uid, rid), USAGE_STREAM]
        res = orjson.loads(await self._settle(keys=keys, args=[orjson.dumps(payload)]))
        await self.r.zrem(RSV_DEADLINE, f"{uid}:{rid}")
        if not res.get("ok"):
            return SettleResult(ok=False)
        return SettleResult(ok=True, wallet=int(res["wallet"]), shortfall=int(res["shortfall"]),
                            pkgs=_as_list(res.get("pkgs")))

    async def release(self, *, rid: str, uid: int, token_id: int | None, event: dict | None) -> SettleResult:
        """失败全额释放：等价于按 0 用量结算。"""
        return await self.settle_raw(rid=rid, uid=uid, token_id=token_id, act_pkgs={}, act_cost=0,
                                     overdraft=0, event=event)

    async def freeze(self, uid: int, rid: str, amount: int) -> None:
        """冻结钱包金额（余额购买等非调用场景），不足抛 QuotaError。"""
        await self.ensure_loaded(uid)
        payload = {"rid": rid, "pkgs": [], "cost": amount, "limited": 0, "ttl": self.ttl * 2, "ctx": "{}"}
        keys = [k_wallet(uid), k_pkgs(uid), k_token(uid, None), k_rsv(uid, rid)]
        res = orjson.loads(await self._reserve(keys=keys, args=[orjson.dumps(payload)]))
        if not res.get("ok"):
            raise QuotaError(res.get("err", "unknown"), res)
        await self.r.zadd(RSV_DEADLINE, {f"{uid}:{rid}": time.time() + self.ttl})

    async def unfreeze(self, uid: int, rid: str) -> None:
        await self.settle_raw(rid=rid, uid=uid, token_id=None, act_pkgs={}, act_cost=0, overdraft=0, event=None)

    async def get_reservation_ctx(self, uid: int, rid: str) -> dict | None:
        raw = await self.r.hget(k_rsv(uid, rid), "ctx")
        return orjson.loads(raw) if raw else None

    # ---------- 外部变更 ----------
    async def apply_external(self, uid: int, *, ver: int, op: str, bal_delta: int = 0,
                             pkg_set: list[tuple[PackageRule, int]] | None = None,
                             pkg_del: list[int] | None = None) -> str:
        payload = {
            "ver": ver,
            "op": op,
            "bal_delta": bal_delta,
            "pkg_set": [{"id": r.id, "rem": rem, "meta": orjson.dumps(r.to_meta()).decode()}
                        for r, rem in (pkg_set or [])],
            "pkg_del": pkg_del or [],
        }
        return await self._apply_ext(keys=[k_wallet(uid), k_pkgs(uid), k_pkgmeta(uid), k_ops(uid)],
                                     args=[orjson.dumps(payload)])

    # ---------- 查询 ----------
    async def balance(self, uid: int) -> dict:
        w = await self.r.hgetall(k_wallet(uid))
        p = await self.r.hgetall(k_pkgs(uid))
        return {"bal": int(w.get("bal", 0)), "frz": int(w.get("frz", 0)), "loaded": bool(w),
                "pkgs": {int(k): int(v) for k, v in p.items()}}

    async def drop_user(self, uid: int) -> None:
        """对账修复：丢弃热数据，下次访问从 PG 重建（仅在该用户无进行中预扣时调用）。"""
        await self.r.delete(k_wallet(uid), k_pkgs(uid), k_pkgmeta(uid), k_ops(uid))

    # ---------- 压测对比：非原子的先查后扣 ----------
    async def naive_reserve(self, *, uid: int, cost: int) -> bool:
        await self.ensure_loaded(uid)
        bal = int(await self.r.hget(k_wallet(uid), "bal") or 0)
        if bal < cost:
            return False
        # 模拟真实业务中查询与扣减之间的处理耗时
        import asyncio

        await asyncio.sleep(0)
        await self.r.hincrby(k_wallet(uid), "bal", -cost)
        return True
