from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update

from app.api.deps import DB, AdminUser, Paging, audit, paginate
from app.channels import tester
from app.channels.service import after_channel_change, rebuild_abilities, save_channel, split_keys
from app.core.errors import AppError, NotFound
from app.core.security import decrypt_secret
from app.jobs.channel_jobs import test_channels
from app.models.channel import (
    CH_AUTO_DISABLED,
    CH_ENABLED,
    CH_MANUAL_DISABLED,
    CHANNEL_TYPES,
    Channel,
    ChannelKey,
)
from app.schemas.common import OK, ORM

router = APIRouter(prefix="/channels")


class ChannelOut(ORM):
    id: int
    name: str
    type: str
    base_url: str
    status: int
    status_reason: str
    status_changed_at: datetime | None
    models: list[str]
    model_mapping: dict
    groups: list[str]
    priority: int
    weight: int
    multi_key_mode: str
    auto_ban: bool
    test_model: str
    cost_ratio: Decimal
    cost_time_rules: list = []
    param_override: dict
    header_override: dict
    tag: str
    remark: str
    response_time_ms: int
    tested_at: datetime | None
    balance: Decimal | None
    balance_currency: str
    balance_updated_at: datetime | None
    used_amount: int
    request_count: int
    created_at: datetime
    key_total: int = 0
    key_enabled: int = 0


class KeyOut(ORM):
    id: int
    key_mask: str
    status: int
    status_reason: str
    status_changed_at: datetime | None
    request_count: int
    created_at: datetime


class ChannelIn(BaseModel):
    name: str | None = Field(None, max_length=64)
    type: str | None = None
    base_url: str | None = None
    models: list[str] | None = None
    model_mapping: dict[str, str] | None = None
    groups: list[str] | None = None
    priority: int | None = None
    weight: int | None = Field(None, ge=0)
    multi_key_mode: Literal["random", "polling"] | None = None
    auto_ban: bool | None = None
    test_model: str | None = None
    cost_ratio: Decimal | None = Field(None, ge=0)
    cost_time_rules: list[dict] | None = None
    param_override: dict | None = None
    header_override: dict[str, str] | None = None
    tag: str | None = None
    remark: str | None = None
    status: int | None = None
    keys: str | None = None  # 批量粘贴，一行一个
    replace_keys: bool = False


@router.get("/types")
async def channel_types(_: AdminUser):
    return [{"value": k, **v} for k, v in CHANNEL_TYPES.items()]


async def _with_key_stats(s, rows: list[Channel]) -> list[dict]:
    ids = [c.id for c in rows]
    stats = {}
    if ids:
        for cid, total, enabled in (await s.execute(select(
            ChannelKey.channel_id, func.count(), func.count().filter(ChannelKey.status == CH_ENABLED)
        ).where(ChannelKey.channel_id.in_(ids)).group_by(ChannelKey.channel_id))).all():
            stats[cid] = (total, enabled)
    out = []
    for c in rows:
        d = ChannelOut.model_validate(c).model_dump()
        d["key_total"], d["key_enabled"] = stats.get(c.id, (0, 0))
        out.append(d)
    return out


@router.get("")
async def list_channels(_: AdminUser, s: DB, paging: Paging, keyword: str = "", type: str | None = None,
                        status: int | None = None, group: str | None = None, tag: str | None = None,
                        model: str | None = None, sort: str = "priority"):
    q = select(Channel)
    if keyword:
        q = q.where(or_(Channel.name.ilike(f"%{keyword}%"), Channel.remark.ilike(f"%{keyword}%"),
                        Channel.base_url.ilike(f"%{keyword}%")))
    if type:
        q = q.where(Channel.type == type)
    if status:
        q = q.where(Channel.status == status)
    if group:
        q = q.where(Channel.groups.any(group))
    if tag:
        q = q.where(Channel.tag == tag)
    if model:
        q = q.where(Channel.models.any(model))
    order = {"priority": (Channel.priority.desc(), Channel.id.desc()), "id": (Channel.id.desc(),),
             "response_time": (Channel.response_time_ms.desc(),), "used": (Channel.used_amount.desc(),)}
    page = await paginate(s, q.order_by(*order.get(sort, order["priority"])), paging)
    page["items"] = await _with_key_stats(s, page["items"])
    return page


@router.get("/tags")
async def tags(_: AdminUser, s: DB):
    return [t for t in (await s.execute(select(Channel.tag).where(Channel.tag != "").distinct())).scalars()]


@router.get("/{cid}")
async def get_channel(cid: int, _: AdminUser, s: DB):
    c = await s.get(Channel, cid)
    if c is None:
        raise NotFound("渠道不存在")
    return (await _with_key_stats(s, [c]))[0]


@router.post("")
async def create_channel(body: ChannelIn, request: Request, user: AdminUser, s: DB):
    if not body.name or not body.type:
        raise AppError("名称与类型必填")
    keys = split_keys(body.keys or "")
    data = body.model_dump(exclude={"keys", "replace_keys"}, exclude_none=True)
    ch = await save_channel(s, data, keys=keys)
    await audit(s, request, user, "channel.create", "channel", ch.id, {"name": ch.name, "keys": len(keys)})
    await s.commit()
    await after_channel_change()
    return (await _with_key_stats(s, [ch]))[0]


@router.put("/{cid}")
async def update_channel(cid: int, body: ChannelIn, request: Request, user: AdminUser, s: DB):
    ch = await s.get(Channel, cid)
    if ch is None:
        raise NotFound("渠道不存在")
    keys = split_keys(body.keys) if body.keys else None
    data = body.model_dump(exclude={"keys", "replace_keys"}, exclude_none=True)
    await save_channel(s, data, ch, keys=keys, replace_keys=body.replace_keys)
    await audit(s, request, user, "channel.update", "channel", cid,
                {k: v for k, v in data.items() if k not in ("param_override", "header_override")})
    await s.commit()
    await after_channel_change()
    return (await _with_key_stats(s, [ch]))[0]


@router.post("/{cid}/copy")
async def copy_channel(cid: int, request: Request, user: AdminUser, s: DB):
    src = await s.get(Channel, cid)
    if src is None:
        raise NotFound("渠道不存在")
    keys = [decrypt_secret(k.key_enc) for k in (await s.execute(
        select(ChannelKey).where(ChannelKey.channel_id == cid))).scalars()]
    data = {f: getattr(src, f) for f in ("type", "base_url", "models", "model_mapping", "groups", "priority", "weight",
                                         "multi_key_mode", "auto_ban", "test_model", "cost_ratio", "cost_time_rules",
                                         "param_override", "header_override", "tag", "remark")}
    data["name"] = src.name + " - 副本"
    ch = await save_channel(s, data, keys=keys)
    await audit(s, request, user, "channel.copy", "channel", ch.id, {"from": cid})
    await s.commit()
    await after_channel_change()
    return (await _with_key_stats(s, [ch]))[0]


@router.delete("/{cid}", response_model=OK)
async def delete_channel(cid: int, request: Request, user: AdminUser, s: DB):
    ch = await s.get(Channel, cid)
    if ch is None:
        raise NotFound("渠道不存在")
    await audit(s, request, user, "channel.delete", "channel", cid, {"name": ch.name})
    await s.delete(ch)
    await s.commit()
    await after_channel_change()
    return OK()


class StatusIn(BaseModel):
    status: Literal[1, 2]


@router.post("/{cid}/status")
async def channel_status(cid: int, body: StatusIn, request: Request, user: AdminUser, s: DB):
    ch = await s.get(Channel, cid)
    if ch is None:
        raise NotFound("渠道不存在")
    ch.status = CH_ENABLED if body.status == 1 else CH_MANUAL_DISABLED
    ch.status_reason = "" if body.status == 1 else f"管理员 {user.username} 手动禁用"
    ch.status_changed_at = datetime.now(UTC)
    await rebuild_abilities(s, ch)
    await audit(s, request, user, "channel.status", "channel", cid, {"status": ch.status})
    await s.commit()
    await after_channel_change()
    return (await _with_key_stats(s, [ch]))[0]


class BatchIn(BaseModel):
    ids: list[int] = []
    tag: str | None = None
    action: Literal["enable", "disable", "delete", "set_priority", "set_weight", "set_tag"]
    value: str | int | None = None


@router.post("/batch", response_model=OK)
async def batch(body: BatchIn, request: Request, user: AdminUser, s: DB):
    q = select(Channel)
    if body.tag is not None:
        q = q.where(Channel.tag == body.tag)
    elif body.ids:
        q = q.where(Channel.id.in_(body.ids))
    else:
        raise AppError("请选择渠道或标签")
    rows = (await s.execute(q)).scalars().all()
    for ch in rows:
        if body.action == "delete":
            await s.delete(ch)
            continue
        if body.action == "enable":
            ch.status, ch.status_reason = CH_ENABLED, ""
        elif body.action == "disable":
            ch.status, ch.status_reason = CH_MANUAL_DISABLED, f"管理员 {user.username} 批量禁用"
        elif body.action == "set_priority":
            ch.priority = int(body.value or 0)
        elif body.action == "set_weight":
            ch.weight = int(body.value or 0)
        elif body.action == "set_tag":
            ch.tag = str(body.value or "")
        await rebuild_abilities(s, ch)
    await audit(s, request, user, f"channel.batch.{body.action}", "channel", ",".join(str(c.id) for c in rows),
                {"value": body.value})
    await s.commit()
    await after_channel_change()
    return OK(message=f"已处理 {len(rows)} 个渠道")


# ---------------------------------------------------------------- Key 管理
@router.get("/{cid}/keys", response_model=list[KeyOut])
async def list_keys(cid: int, _: AdminUser, s: DB):
    return (await s.execute(select(ChannelKey).where(ChannelKey.channel_id == cid).order_by(ChannelKey.id))).scalars().all()


class KeyStatusIn(BaseModel):
    status: Literal[1, 2]


@router.post("/{cid}/keys/{kid}/status", response_model=KeyOut)
async def key_status(cid: int, kid: int, body: KeyStatusIn, request: Request, user: AdminUser, s: DB):
    k = await s.get(ChannelKey, kid)
    if k is None or k.channel_id != cid:
        raise NotFound("Key 不存在")
    k.status = CH_ENABLED if body.status == 1 else CH_MANUAL_DISABLED
    k.status_reason = "" if body.status == 1 else "手动禁用"
    k.status_changed_at = datetime.now(UTC)
    ch = await s.get(Channel, cid)
    if body.status == 1 and ch.status == CH_AUTO_DISABLED:
        ch.status, ch.status_reason = CH_ENABLED, ""
        await rebuild_abilities(s, ch)
    await audit(s, request, user, "channel.key.status", "channel_key", kid, {"status": k.status})
    await s.commit()
    await after_channel_change()
    return k


@router.delete("/{cid}/keys/{kid}", response_model=OK)
async def delete_key(cid: int, kid: int, request: Request, user: AdminUser, s: DB):
    r = await s.execute(delete(ChannelKey).where(ChannelKey.id == kid, ChannelKey.channel_id == cid))
    if not r.rowcount:
        raise NotFound("Key 不存在")
    await audit(s, request, user, "channel.key.delete", "channel_key", kid)
    await s.commit()
    await after_channel_change()
    return OK()


@router.post("/{cid}/keys/enable-auto-disabled", response_model=OK)
async def enable_auto_disabled_keys(cid: int, request: Request, user: AdminUser, s: DB):
    r = await s.execute(update(ChannelKey).where(ChannelKey.channel_id == cid, ChannelKey.status == CH_AUTO_DISABLED)
                        .values(status=CH_ENABLED, status_reason="", status_changed_at=datetime.now(UTC)))
    await audit(s, request, user, "channel.key.enable_all", "channel", cid)
    await s.commit()
    await after_channel_change()
    return OK(message=f"已启用 {r.rowcount} 个 Key")


# ---------------------------------------------------------------- 测试 / 余额 / 模型
class TestIn(BaseModel):
    model: str | None = None
    key_id: int | None = None
    stream: bool = False


@router.post("/{cid}/test")
async def test(cid: int, body: TestIn, _: AdminUser):
    return await tester.test_channel(cid, body.model, body.key_id, body.stream)


class BatchTestIn(BaseModel):
    ids: list[int] = []
    scope: Literal["selected", "all", "enabled", "auto_disabled"] = "selected"


@router.post("/test/batch")
async def batch_test(body: BatchTestIn, _: AdminUser, s: DB):
    q = select(Channel.id)
    if body.scope == "selected":
        q = q.where(Channel.id.in_(body.ids))
    elif body.scope == "enabled":
        q = q.where(Channel.status == CH_ENABLED)
    elif body.scope == "auto_disabled":
        q = q.where(Channel.status == CH_AUTO_DISABLED)
    ids = list((await s.execute(q)).scalars())
    if len(ids) > 200:
        raise AppError("单次最多测试 200 个渠道")
    return await test_channels(ids)


@router.post("/{cid}/balance")
async def balance(cid: int, _: AdminUser):
    return await tester.query_balance(cid)


class FetchModelsIn(BaseModel):
    type: str
    base_url: str = ""
    key: str | None = None
    channel_id: int | None = None


@router.post("/fetch-models")
async def fetch_models(body: FetchModelsIn, _: AdminUser, s: DB):
    key = body.key
    base_url, type_ = body.base_url, body.type
    if body.channel_id:
        ch = await s.get(Channel, body.channel_id)
        if ch is None:
            raise NotFound("渠道不存在")
        base_url, type_ = base_url or ch.base_url, ch.type
    if not key and body.channel_id:
        k = (await s.execute(select(ChannelKey).where(ChannelKey.channel_id == body.channel_id)
                             .order_by(ChannelKey.id).limit(1))).scalar_one_or_none()
        key = decrypt_secret(k.key_enc) if k else None
    if not key:
        raise AppError("请提供 Key")
    key = split_keys(key)[0]
    try:
        return {"models": await tester.fetch_upstream_models(type_, base_url, key)}
    except Exception as e:  # noqa: BLE001
        raise AppError(f"拉取模型失败：{getattr(e, 'message', e)}") from e
