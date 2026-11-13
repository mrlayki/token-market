"""API 令牌鉴权：HMAC 哈希 → Redis 短缓存 → PG。"""

from __future__ import annotations

import asyncio
import ipaddress
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

import orjson
from fastapi import Request
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.errors import RelayError
from app.core.redis import redis
from app.core.security import hash_api_key
from app.models.token import TOKEN_ENABLED, ApiToken
from app.models.user import STATUS_ENABLED, User, UserGroup

AUTH_TTL = 30


def auth_cache_key(key_hash: str) -> str:
    return f"tm:auth:{key_hash}"


@dataclass(slots=True)
class Identity:
    token_id: int
    token_name: str
    user_id: int
    username: str
    group: str  # 实际使用分组
    unlimited: bool
    model_limits: list[str]
    allow_ips: list[str]
    rpm_limit: int
    expired_at: float | None
    token_status: int
    user_status: int


def extract_key(request: Request) -> str | None:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.headers.get("x-api-key") or request.headers.get("api-key")


_inflight: dict[str, asyncio.Future] = {}


async def _load_once(key_hash: str) -> Identity | None:
    """单飞：同一进程内同一 Key 并发缓存未命中时只查一次数据库，防止缓存击穿打满连接池。"""
    fut = _inflight.get(key_hash)
    if fut is not None:
        return await asyncio.shield(fut)
    fut = asyncio.get_running_loop().create_future()
    _inflight[key_hash] = fut
    try:
        ident = await _load(key_hash)
        fut.set_result(ident)
        return ident
    except BaseException as e:
        fut.set_exception(e)
        fut.exception()  # 标记已读取，避免无人等待时的告警
        raise
    finally:
        _inflight.pop(key_hash, None)


async def _load(key_hash: str) -> Identity | None:
    async with SessionLocal() as s:
        row = (await s.execute(
            select(ApiToken, User).join(User, User.id == ApiToken.user_id).where(ApiToken.key_hash == key_hash)
        )).first()
        if not row:
            return None
        tok, user = row
        group = tok.group or user.group
        if tok.group and tok.group != user.group:
            ug = await s.get(UserGroup, user.group)
            if not ug or tok.group not in (ug.usable_groups or []):
                group = user.group  # 令牌分组不在用户可用范围内时回落到用户分组
        return Identity(
            token_id=tok.id, token_name=tok.name, user_id=user.id, username=user.username, group=group,
            unlimited=tok.unlimited, model_limits=list(tok.model_limits or []), allow_ips=list(tok.allow_ips or []),
            rpm_limit=tok.rpm_limit, expired_at=tok.expired_at.timestamp() if tok.expired_at else None,
            token_status=tok.status, user_status=user.status,
        )


def _ip_allowed(ip: str, rules: list[str]) -> bool:
    if not rules:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for r in rules:
        try:
            if addr in ipaddress.ip_network(r.strip(), strict=False):
                return True
        except ValueError:
            continue
    return False


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


async def authenticate(request: Request) -> Identity:
    key = extract_key(request)
    if not key:
        raise RelayError("未提供 API Key", status=401, type_="authentication_error", code="invalid_api_key")
    kh = hash_api_key(key)
    ident: Identity | None = None
    try:
        cached = await redis.get(auth_cache_key(kh))
        if cached:
            ident = Identity(**orjson.loads(cached)) if cached != "null" else None
            if cached == "null":
                raise RelayError("无效的 API Key", status=401, type_="authentication_error", code="invalid_api_key")
    except RelayError:
        raise
    except Exception:  # noqa: BLE001
        ident = None
    if ident is None:
        ident = await _load_once(kh)
        try:
            await redis.set(auth_cache_key(kh), orjson.dumps(asdict(ident)) if ident else "null", ex=AUTH_TTL)
        except Exception:  # noqa: BLE001
            pass
    if ident is None:
        raise RelayError("无效的 API Key", status=401, type_="authentication_error", code="invalid_api_key")
    if ident.user_status != STATUS_ENABLED:
        raise RelayError("账户已被禁用", status=403, type_="permission_error", code="user_disabled")
    if ident.token_status != TOKEN_ENABLED:
        raise RelayError("API Key 已禁用或已失效", status=401, type_="authentication_error", code="token_disabled")
    if ident.expired_at and ident.expired_at < datetime.now(UTC).timestamp():
        raise RelayError("API Key 已过期", status=401, type_="authentication_error", code="token_expired")
    if not _ip_allowed(client_ip(request), ident.allow_ips):
        raise RelayError("当前 IP 不在 API Key 白名单内", status=403, type_="permission_error", code="ip_not_allowed")
    return ident


async def invalidate_token_cache(key_hashes: list[str]) -> None:
    if key_hashes:
        try:
            await redis.delete(*[auth_cache_key(h) for h in key_hashes])
        except Exception:  # noqa: BLE001
            pass
