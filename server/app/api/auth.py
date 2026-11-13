from __future__ import annotations

import re
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from app.api.deps import DB, CurrentUser, client_ip
from app.billing.accounting import credit_wallet, flush_outbox
from app.core import runtime_settings as rs
from app.core.errors import AppError, Conflict, Forbidden, Unauthorized
from app.core.redis import redis
from app.core.security import create_access_token, hash_password, verify_password
from app.models.billing import BIZ_GIFT, Wallet
from app.models.user import STATUS_ENABLED, User
from app.schemas.common import OK, UserBrief

router = APIRouter(prefix="/api/auth", tags=["auth"])

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-.]{3,32}$")


class RegisterIn(BaseModel):
    username: str
    password: str = Field(min_length=8, max_length=64)
    email: str | None = None


class LoginIn(BaseModel):
    username: str
    password: str


class LoginOut(BaseModel):
    token: str
    user: UserBrief


async def _login_guard(key: str) -> None:
    try:
        n = await redis.incr(key)
        if n == 1:
            await redis.expire(key, 900)
        if n > 10:
            raise AppError("登录失败次数过多，请 15 分钟后再试", status=429, code="too_many_attempts")
    except AppError:
        raise
    except Exception:  # noqa: BLE001
        pass


@router.post("/register", response_model=LoginOut)
async def register(body: RegisterIn, request: Request, s: DB):
    cfg = await rs.get_all()
    if not cfg["auth.register_enabled"]:
        raise Forbidden("当前未开放注册")
    if not USERNAME_RE.match(body.username):
        raise AppError("用户名需为 3-32 位字母、数字、下划线、横线或点")
    if body.email:
        domain = body.email.rsplit("@", 1)[-1].lower()
        wl = [d.lower() for d in cfg["auth.email_domain_whitelist"] or []]
        if wl and domain not in wl:
            raise AppError("该邮箱域名不允许注册")
    exists = (await s.execute(select(User.id).where(
        or_(User.username == body.username, User.email == body.email) if body.email else User.username == body.username
    ))).first()
    if exists:
        raise Conflict("用户名或邮箱已被占用")
    user = User(username=body.username, email=body.email, password_hash=hash_password(body.password),
                display_name=body.username, group="default", last_login_ip=client_ip(request),
                last_login_at=datetime.now(UTC))
    s.add(user)
    await s.flush()
    s.add(Wallet(user_id=user.id))
    outbox = []
    gift = cfg["billing.new_user_gift"]
    if gift > 0:
        outbox.append(await credit_wallet(s, user.id, gift, biz_type=BIZ_GIFT, biz_id=f"register:{user.id}",
                                          remark="新用户注册赠送"))
    await s.commit()
    await flush_outbox(outbox)
    return LoginOut(token=create_access_token(user.id, user.role, user.auth_version), user=UserBrief.model_validate(user))


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn, request: Request, s: DB):
    if not await rs.get("auth.password_login_enabled"):
        raise Forbidden("密码登录已关闭")
    guard = f"tm:loginfail:{client_ip(request)}:{body.username}"
    user = (await s.execute(select(User).where(or_(User.username == body.username, User.email == body.username)))).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        await _login_guard(guard)
        raise Unauthorized("用户名或密码错误")
    if user.status != STATUS_ENABLED:
        raise Forbidden("账户已被禁用")
    user.last_login_at = datetime.now(UTC)
    user.last_login_ip = client_ip(request)
    await s.commit()
    try:
        await redis.delete(guard)
    except Exception:  # noqa: BLE001
        pass
    return LoginOut(token=create_access_token(user.id, user.role, user.auth_version), user=UserBrief.model_validate(user))


@router.get("/me", response_model=UserBrief)
async def me(user: CurrentUser):
    return user


class PasswordIn(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8, max_length=64)


@router.put("/password", response_model=OK)
async def change_password(body: PasswordIn, user: CurrentUser, s: DB):
    u = await s.get(User, user.id)
    if not verify_password(body.old_password, u.password_hash):
        raise AppError("原密码错误")
    u.password_hash = hash_password(body.new_password)
    u.auth_version += 1  # 使所有已签发的登录态失效
    await s.commit()
    return OK(message="密码已修改，请重新登录")


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=64)
    email: str | None = None


@router.put("/profile", response_model=UserBrief)
async def update_profile(body: ProfileIn, user: CurrentUser, s: DB):
    u = await s.get(User, user.id)
    if body.display_name is not None:
        u.display_name = body.display_name
    if body.email is not None and body.email != u.email:
        if (await s.execute(select(User.id).where(User.email == body.email))).first():
            raise Conflict("邮箱已被占用")
        u.email = body.email or None
    await s.commit()
    return u
