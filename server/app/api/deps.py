from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, Any

import jwt
from fastapi import Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_access_token
from app.models.logs import AuditLog
from app.models.user import ROLE_LEVEL, STATUS_ENABLED, User


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as s:
        yield s


DB = Annotated[AsyncSession, Depends(get_db)]


async def current_user(request: Request, s: DB) -> User:
    auth = request.headers.get("authorization") or ""
    token = auth[7:] if auth.lower().startswith("bearer ") else request.cookies.get("tm_session")
    if not token:
        raise Unauthorized()
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError as e:
        raise Unauthorized() from e
    user = await s.get(User, int(payload["sub"]))
    if user is None or user.auth_version != payload.get("av"):
        raise Unauthorized()
    if user.status != STATUS_ENABLED:
        raise Forbidden("账户已被禁用")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def require_admin(user: CurrentUser) -> User:
    if ROLE_LEVEL.get(user.role, 0) < ROLE_LEVEL["admin"]:
        raise Forbidden("需要管理员权限")
    return user


async def require_root(user: CurrentUser) -> User:
    if user.role != "root":
        raise Forbidden("需要超级管理员权限")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
RootUser = Annotated[User, Depends(require_root)]


class PageParams(BaseModel):
    page: int = 1
    page_size: int = 20


def page_params(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=200)) -> PageParams:
    return PageParams(page=page, page_size=page_size)


Paging = Annotated[PageParams, Depends(page_params)]


async def paginate(s: AsyncSession, stmt: Select, p: PageParams, *, scalars: bool = True) -> dict[str, Any]:
    total = (await s.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    q = stmt.limit(p.page_size).offset((p.page - 1) * p.page_size)
    res = await s.execute(q)
    items = res.scalars().all() if scalars else res.all()
    return {"items": items, "total": total, "page": p.page, "page_size": p.page_size}


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


async def audit(s: AsyncSession, request: Request, user: User, action: str, target_type: str = "",
                target_id: Any = "", detail: dict | None = None) -> None:
    from fastapi.encoders import jsonable_encoder

    s.add(AuditLog(operator_id=user.id, operator_name=user.username, action=action, target_type=target_type,
                   target_id=str(target_id), detail=jsonable_encoder(detail or {}), ip=client_ip(request)))
