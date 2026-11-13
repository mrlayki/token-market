"""供应商、模型元数据、模型计费（价格版本）、分组倍率。"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.api.deps import DB, AdminUser, Paging, audit, paginate
from app.billing.pricing import PriceSnapshot, Usage
from app.core.cache import bump
from app.core.errors import AppError, Conflict, NotFound
from app.models.catalog import ModelMeta, ModelPrice, Vendor
from app.models.channel import Channel
from app.models.user import User, UserGroup
from app.relay.catalog import DOMAIN_CATALOG
from app.schemas.common import OK, ORM

router = APIRouter()


# ---------------------------------------------------------------- 供应商
class VendorIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    display_name: str
    icon: str = ""
    description: str = ""
    sort: int = 0
    enabled: bool = True


class VendorOut(VendorIn, ORM):
    id: int
    model_count: int = 0


@router.get("/vendors", response_model=list[VendorOut])
async def vendors(_: AdminUser, s: DB):
    counts = dict((await s.execute(select(ModelMeta.vendor_id, func.count()).group_by(ModelMeta.vendor_id))).all())
    out = []
    for v in (await s.execute(select(Vendor).order_by(Vendor.sort, Vendor.id))).scalars():
        d = VendorOut.model_validate(v)
        d.model_count = counts.get(v.id, 0)
        out.append(d)
    return out


@router.post("/vendors", response_model=VendorOut)
async def create_vendor(body: VendorIn, request: Request, user: AdminUser, s: DB):
    if (await s.execute(select(Vendor.id).where(Vendor.name == body.name))).first():
        raise Conflict("供应商标识已存在")
    v = Vendor(**body.model_dump())
    s.add(v)
    await s.flush()
    await audit(s, request, user, "vendor.create", "vendor", v.id, body.model_dump())
    await s.commit()
    await bump(DOMAIN_CATALOG)
    return v


@router.put("/vendors/{vid}", response_model=VendorOut)
async def update_vendor(vid: int, body: VendorIn, request: Request, user: AdminUser, s: DB):
    v = await s.get(Vendor, vid)
    if v is None:
        raise NotFound()
    for k, val in body.model_dump().items():
        setattr(v, k, val)
    await audit(s, request, user, "vendor.update", "vendor", vid, body.model_dump())
    await s.commit()
    await bump(DOMAIN_CATALOG)
    return v


@router.delete("/vendors/{vid}", response_model=OK)
async def delete_vendor(vid: int, request: Request, user: AdminUser, s: DB):
    if (await s.execute(select(ModelMeta.id).where(ModelMeta.vendor_id == vid).limit(1))).first():
        raise AppError("该供应商下仍有模型，无法删除")
    v = await s.get(Vendor, vid)
    if v:
        await s.delete(v)
        await audit(s, request, user, "vendor.delete", "vendor", vid)
        await s.commit()
    return OK()


# ---------------------------------------------------------------- 模型
class ModelIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    vendor_id: int | None = None
    display_name: str = ""
    description: str = ""
    icon: str = ""
    tags: list[str] = []
    mode: Literal["chat", "embedding", "image", "audio"] = "chat"
    endpoints: list[str] = ["openai"]
    context_length: int = 0
    max_output_tokens: int = 0
    listed: bool = True
    sort: int = 0


class PriceView(ORM):
    id: int
    billing_type: str
    input_price: int
    output_price: int
    cache_read_price: int
    cache_write_price: int
    per_call_price: int
    effective_at: datetime
    time_rules: list = []
    remark: str


class ModelOut(ModelIn, ORM):
    id: int
    created_at: datetime
    price: PriceView | None = None
    pending_price: PriceView | None = None
    channel_count: int = 0
    channels: list[dict] = []


async def _current_prices(s, names: list[str]) -> tuple[dict, dict]:
    now = datetime.now(UTC)
    cur = {p.model: p for p in (await s.execute(
        select(ModelPrice).where(ModelPrice.model.in_(names), ModelPrice.effective_at <= now)
        .order_by(ModelPrice.model, ModelPrice.effective_at.desc(), ModelPrice.id.desc()).distinct(ModelPrice.model)
    )).scalars()}
    pending = {p.model: p for p in (await s.execute(
        select(ModelPrice).where(ModelPrice.model.in_(names), ModelPrice.effective_at > now)
        .order_by(ModelPrice.model, ModelPrice.effective_at).distinct(ModelPrice.model)
    )).scalars()}
    return cur, pending


async def _channel_counts(s) -> dict[str, int]:
    rows = (await s.execute(select(func.unnest(Channel.models).label("m"), func.count()).group_by("m"))).all()
    return dict(rows)


async def _channel_map(s) -> dict[str, list[dict]]:
    """模型 → 提供该模型的渠道（含状态、优先级、权重、分组、上游真实模型名）。"""
    out: dict[str, list[dict]] = {}
    for c in (await s.execute(select(Channel).order_by(Channel.priority.desc(), Channel.id))).scalars():
        for m in c.models or []:
            out.setdefault(m, []).append({
                "id": c.id, "name": c.name, "type": c.type, "status": c.status, "priority": c.priority,
                "weight": c.weight, "groups": c.groups, "upstream_model": (c.model_mapping or {}).get(m) or m,
            })
    return out


@router.get("/models")
async def list_models(_: AdminUser, s: DB, paging: Paging, keyword: str = "", vendor_id: int | None = None,
                      listed: bool | None = None, priced: bool | None = None):
    q = select(ModelMeta)
    if keyword:
        q = q.where(or_(ModelMeta.name.ilike(f"%{keyword}%"), ModelMeta.display_name.ilike(f"%{keyword}%")))
    if vendor_id:
        q = q.where(ModelMeta.vendor_id == vendor_id)
    if listed is not None:
        q = q.where(ModelMeta.listed.is_(listed))
    if priced is not None:
        sub = select(ModelPrice.model).distinct()
        q = q.where(ModelMeta.name.in_(sub) if priced else ModelMeta.name.not_in(sub))
    page = await paginate(s, q.order_by(ModelMeta.sort, ModelMeta.name), paging)
    names = [m.name for m in page["items"]]
    cur, pending = await _current_prices(s, names)
    cmap = await _channel_map(s)
    items = []
    for m in page["items"]:
        d = ModelOut.model_validate(m)
        d.price = PriceView.model_validate(cur[m.name]) if m.name in cur else None
        d.pending_price = PriceView.model_validate(pending[m.name]) if m.name in pending else None
        d.channels = cmap.get(m.name, [])
        d.channel_count = len(d.channels)
        items.append(d)
    page["items"] = items
    return page


@router.get("/models/missing")
async def missing_models(_: AdminUser, s: DB):
    """渠道中配置了、但尚未建立模型元数据或未定价的模型（New API 同类功能）。"""
    counts = await _channel_counts(s)
    metas = set((await s.execute(select(ModelMeta.name))).scalars())
    priced = set((await s.execute(select(ModelPrice.model).distinct())).scalars())
    return {"no_meta": sorted(m for m in counts if m not in metas),
            "no_price": sorted(m for m in counts if m in metas and m not in priced)}


@router.post("/models", response_model=ModelOut)
async def create_model(body: ModelIn, request: Request, user: AdminUser, s: DB):
    if (await s.execute(select(ModelMeta.id).where(ModelMeta.name == body.name))).first():
        raise Conflict("模型已存在")
    m = ModelMeta(**body.model_dump())
    s.add(m)
    await s.flush()
    await audit(s, request, user, "model.create", "model", m.name)
    await s.commit()
    await bump(DOMAIN_CATALOG)
    return ModelOut.model_validate(m)


class ModelBatchIn(BaseModel):
    names: list[str]
    vendor_id: int | None = None
    mode: Literal["chat", "embedding", "image", "audio"] = "chat"


@router.post("/models/batch", response_model=OK)
async def batch_create_models(body: ModelBatchIn, request: Request, user: AdminUser, s: DB):
    """批量创建模型元数据（常用于「缺失模型」一键补齐），尽量从 LiteLLM 元数据推断上下文长度。"""
    from app.core.logging import configure_litellm

    configure_litellm()
    import litellm

    exists = set((await s.execute(select(ModelMeta.name).where(ModelMeta.name.in_(body.names)))).scalars())
    n = 0
    for name in body.names:
        if name in exists:
            continue
        info = litellm.model_cost.get(name) or {}
        s.add(ModelMeta(name=name, display_name=name, vendor_id=body.vendor_id, mode=body.mode,
                        endpoints=["embeddings"] if body.mode == "embedding" else ["openai", "anthropic"],
                        context_length=int(info.get("max_input_tokens") or 0),
                        max_output_tokens=int(info.get("max_output_tokens") or 0), listed=True))
        n += 1
    await audit(s, request, user, "model.batch_create", "model", "", {"names": body.names})
    await s.commit()
    await bump(DOMAIN_CATALOG)
    return OK(message=f"已创建 {n} 个模型")


@router.put("/models/{mid}", response_model=ModelOut)
async def update_model(mid: int, body: ModelIn, request: Request, user: AdminUser, s: DB):
    m = await s.get(ModelMeta, mid)
    if m is None:
        raise NotFound()
    if body.name != m.name:
        raise AppError("模型名称不可修改")
    for k, v in body.model_dump().items():
        setattr(m, k, v)
    await audit(s, request, user, "model.update", "model", m.name, body.model_dump())
    await s.commit()
    await bump(DOMAIN_CATALOG)
    return ModelOut.model_validate(m)


@router.delete("/models/{mid}", response_model=OK)
async def delete_model(mid: int, request: Request, user: AdminUser, s: DB):
    m = await s.get(ModelMeta, mid)
    if m:
        await audit(s, request, user, "model.delete", "model", m.name)
        await s.delete(m)
        await s.commit()
        await bump(DOMAIN_CATALOG)
    return OK()


# ---------------------------------------------------------------- 价格
class PriceIn(BaseModel):
    model: str
    billing_type: Literal["token", "per_call"] = "token"
    input_price: int = Field(0, ge=0)  # 微元 / 百万 token
    output_price: int = Field(0, ge=0)
    cache_read_price: int = Field(0, ge=0)
    cache_write_price: int = Field(0, ge=0)
    per_call_price: int = Field(0, ge=0)
    effective_at: datetime | None = None  # 空 = 立即生效
    time_rules: list[dict] = []  # 分时规则，见 billing.pricing.TimeRule
    remark: str = ""

    def validated(self) -> dict:
        from app.billing.pricing import validate_time_rules

        d = self.model_dump()
        try:
            d["time_rules"] = validate_time_rules(self.time_rules)
        except (ValueError, KeyError) as e:
            raise AppError(f"时段规则不合法：{e}") from e
        return d


@router.get("/prices/{model:path}/history", response_model=list[PriceView])
async def price_history(model: str, _: AdminUser, s: DB):
    return (await s.execute(select(ModelPrice).where(ModelPrice.model == model)
                            .order_by(ModelPrice.effective_at.desc(), ModelPrice.id.desc()).limit(100))).scalars().all()


@router.post("/prices", response_model=PriceView)
async def set_price(body: PriceIn, request: Request, user: AdminUser, s: DB):
    """新增价格版本（不修改历史版本），可指定未来生效时间实现定时调价。"""
    if not (await s.execute(select(ModelMeta.id).where(ModelMeta.name == body.model))).first():
        raise NotFound("模型不存在，请先创建模型")
    data = body.validated()
    data["effective_at"] = body.effective_at or datetime.now(UTC)
    p = ModelPrice(**data, created_by=user.id)
    s.add(p)
    await s.flush()
    await audit(s, request, user, "price.set", "model", body.model, {**data, "effective_at": data["effective_at"].isoformat()})
    await s.commit()
    await bump(DOMAIN_CATALOG)
    return p


class BatchPriceIn(BaseModel):
    items: list[PriceIn]


@router.post("/prices/batch", response_model=OK)
async def set_prices(body: BatchPriceIn, request: Request, user: AdminUser, s: DB):
    now = datetime.now(UTC)
    names = set((await s.execute(select(ModelMeta.name))).scalars())
    for it in body.items:
        if it.model not in names:
            raise NotFound(f"模型 {it.model} 不存在")
        s.add(ModelPrice(**{**it.validated(), "effective_at": it.effective_at or now}, created_by=user.id))
    await audit(s, request, user, "price.batch_set", "model", "", {"count": len(body.items)})
    await s.commit()
    await bump(DOMAIN_CATALOG)
    return OK(message=f"已更新 {len(body.items)} 个模型价格")


@router.delete("/prices/{pid}", response_model=OK)
async def delete_pending_price(pid: int, request: Request, user: AdminUser, s: DB):
    p = await s.get(ModelPrice, pid)
    if p is None:
        raise NotFound()
    if p.effective_at <= datetime.now(UTC):
        raise AppError("已生效的价格版本不可删除（用于历史账单追溯），请新增版本覆盖")
    await s.delete(p)
    await audit(s, request, user, "price.delete_pending", "model", p.model)
    await s.commit()
    await bump(DOMAIN_CATALOG)
    return OK()


class PreviewIn(BaseModel):
    model: str
    group: str = "default"
    prompt_tokens: int = 1000
    completion_tokens: int = 1000
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    at: datetime | None = None  # 按该时刻匹配时段规则，默认当前


@router.post("/prices/preview")
async def preview(body: PreviewIn, _: AdminUser, s: DB):
    now = datetime.now(UTC)
    p = (await s.execute(select(ModelPrice).where(ModelPrice.model == body.model, ModelPrice.effective_at <= now)
                         .order_by(ModelPrice.effective_at.desc()).limit(1))).scalar_one_or_none()
    if p is None:
        raise AppError("模型未定价")
    g = await s.get(UserGroup, body.group)
    snap = PriceSnapshot(model=p.model, billing_type=p.billing_type, input_price=p.input_price,
                         output_price=p.output_price, cache_read_price=p.cache_read_price,
                         cache_write_price=p.cache_write_price, per_call_price=p.per_call_price,
                         group_ratio=Decimal(g.price_ratio) if g else Decimal(1))
    from app.billing.pricing import match_time_rules

    hit = match_time_rules(p.time_rules, body.at or datetime.now(UTC))
    if hit:
        snap.time_multiplier, snap.period = hit
    u = Usage(body.prompt_tokens, body.completion_tokens, body.cache_read_tokens, body.cache_write_tokens)
    return {"base_cost": snap.base_cost(u), "cost": snap.cost(u), "group_ratio": str(snap.group_ratio),
            "time_multiplier": str(snap.time_multiplier), "period": snap.period}


# ---------------------------------------------------------------- 分组
class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_\-]+$")
    display_name: str
    description: str = ""
    price_ratio: Decimal = Field(Decimal(1), ge=0)
    topup_ratio: Decimal = Field(Decimal(1), gt=0)
    usable_groups: list[str] = []
    sort: int = 0


class GroupOut(GroupIn, ORM):
    user_count: int = 0


@router.get("/groups", response_model=list[GroupOut])
async def groups(_: AdminUser, s: DB):
    counts = dict((await s.execute(select(User.group, func.count()).group_by(User.group))).all())
    out = []
    for g in (await s.execute(select(UserGroup).order_by(UserGroup.sort))).scalars():
        d = GroupOut.model_validate(g)
        d.user_count = counts.get(g.name, 0)
        out.append(d)
    return out


@router.post("/groups", response_model=GroupOut)
async def upsert_group(body: GroupIn, request: Request, user: AdminUser, s: DB):
    g = await s.get(UserGroup, body.name)
    if g is None:
        g = UserGroup(name=body.name)
        s.add(g)
    for k, v in body.model_dump().items():
        setattr(g, k, v)
    if body.name not in g.usable_groups:
        g.usable_groups = [body.name, *g.usable_groups]
    await audit(s, request, user, "group.upsert", "group", body.name, body.model_dump(mode="json"))
    await s.commit()
    await bump(DOMAIN_CATALOG)
    return GroupOut.model_validate(g)


@router.delete("/groups/{name}", response_model=OK)
async def delete_group(name: str, request: Request, user: AdminUser, s: DB):
    if name == "default":
        raise AppError("默认分组不可删除")
    if (await s.execute(select(User.id).where(User.group == name).limit(1))).first():
        raise AppError("仍有用户属于该分组")
    g = await s.get(UserGroup, name)
    if g:
        await s.delete(g)
        await audit(s, request, user, "group.delete", "group", name)
        await s.commit()
        await bump(DOMAIN_CATALOG)
    return OK()
