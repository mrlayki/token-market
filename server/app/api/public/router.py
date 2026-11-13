"""公开接口：站点信息、模型广场、套餐商品、公告、支付回调。"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from app.api.deps import DB
from app.billing.pricing import PriceSnapshot
from app.commerce.orders import PROVIDER_BY_NAME, handle_payment
from app.core import runtime_settings as rs
from app.models.billing import PackageProduct
from app.models.catalog import ModelMeta, Vendor
from app.models.ops import Announcement
from app.models.user import UserGroup
from app.relay.catalog import catalog_cache, channel_cache
from app.schemas.common import PackageProductOut

router = APIRouter(prefix="/api/public", tags=["public"])

PUBLIC_SETTING_KEYS = ("site.name", "site.logo", "site.footer", "site.about", "site.home_content",
                       "site.api_base_url", "site.docs_url", "site.terms", "site.privacy", "auth.register_enabled",
                       "auth.password_login_enabled", "billing.currency_symbol", "payment.methods",
                       "payment.topup_options", "payment.min_topup", "payment.max_topup", "payment.discounts")


@router.get("/site")
async def site():
    cfg = await rs.get_all()
    return {k: cfg[k] for k in PUBLIC_SETTING_KEYS}


def _price_view(p: PriceSnapshot) -> dict:
    return {"billing_type": p.billing_type, "input_price": p.input_price, "output_price": p.output_price,
            "cache_read_price": p.cache_read_price, "cache_write_price": p.cache_write_price,
            "per_call_price": p.per_call_price}


@router.get("/models")
async def marketplace(s: DB, group: str | None = Query(None)):
    """模型广场：已上架、已定价、且至少有一个可用渠道的模型，附各分组价格。"""
    cat = await catalog_cache.get()
    table = await channel_cache.get()
    available: dict[str, set[str]] = {}
    for (g, m), abs_ in table.abilities.items():
        if any(a.channel_id in table.channels for a in abs_):
            available.setdefault(m, set()).add(g)
    vendors = {v.id: v for v in (await s.execute(select(Vendor).where(Vendor.enabled.is_(True)))).scalars()}
    groups = sorted((await s.execute(select(UserGroup))).scalars().all(), key=lambda g: g.sort)
    metas = (await s.execute(select(ModelMeta).where(ModelMeta.listed.is_(True)).order_by(ModelMeta.sort, ModelMeta.name))).scalars()
    out = []
    for m in metas:
        base = cat.prices.get(m.name)
        if base is None or m.name not in available:
            continue
        v = vendors.get(m.vendor_id)
        enable_groups = sorted(available[m.name])
        if group and group not in enable_groups:
            continue
        out.append({
            "name": m.name, "display_name": m.display_name or m.name, "description": m.description, "icon": m.icon,
            "tags": m.tags, "mode": m.mode, "endpoints": m.endpoints, "context_length": m.context_length,
            "max_output_tokens": m.max_output_tokens,
            "vendor": {"name": v.name, "display_name": v.display_name, "icon": v.icon} if v else None,
            "price": {**_price_view(base), "time_rules": cat.time_rules.get(m.name, [])},
            "enable_groups": enable_groups,
        })
    return {
        "models": out,
        "vendors": [{"name": v.name, "display_name": v.display_name, "icon": v.icon}
                    for v in sorted(vendors.values(), key=lambda x: x.sort)],
        "groups": [{"name": g.name, "display_name": g.display_name, "price_ratio": str(g.price_ratio),
                    "description": g.description} for g in groups],
    }


@router.get("/packages", response_model=list[PackageProductOut])
async def packages(s: DB):
    rows = await s.execute(select(PackageProduct).where(PackageProduct.on_sale.is_(True))
                           .order_by(PackageProduct.sort, PackageProduct.id))
    return rows.scalars().all()


@router.get("/announcements")
async def announcements(s: DB):
    rows = await s.execute(select(Announcement).where(Announcement.published.is_(True))
                           .order_by(Announcement.pinned.desc(), Announcement.created_at.desc()).limit(20))
    return [{"id": a.id, "title": a.title, "content": a.content, "level": a.level, "pinned": a.pinned,
             "created_at": a.created_at} for a in rows.scalars()]


# ---------------------------------------------------------------- 支付回调（网关服务器调用）
@router.post("/pay/notify/{provider}", response_class=PlainTextResponse)
async def pay_notify(provider: str, request: Request):
    prov = PROVIDER_BY_NAME.get(provider)
    if prov is None:
        return PlainTextResponse("fail", status_code=404)
    form = await request.form()
    params = {k: str(v) for k, v in form.items()} or {k: str(v) for k, v in (await request.json()).items()}
    try:
        notice = prov.parse_notify(params)
    except (ValueError, KeyError):
        return PlainTextResponse("fail", status_code=400)
    try:
        await handle_payment(notice, provider)
    except Exception:  # noqa: BLE001
        return PlainTextResponse("fail", status_code=500)  # 网关会重试
    return PlainTextResponse(prov.notify_ack())

