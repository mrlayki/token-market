"""数据面只读目录：模型、当前价格、分组倍率、渠道（含解密后的 Key）、能力表。

全部常驻进程内存，通过 VersionedCache 在控制面变更后秒级刷新。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select

from app.billing.pricing import PriceSnapshot, match_time_rules
from app.core.cache import VersionedCache
from app.core.db import SessionLocal
from app.core.security import decrypt_secret
from app.models.catalog import ModelMeta, ModelPrice, Vendor
from app.models.channel import CH_ENABLED, CHANNEL_TYPES, Ability, Channel, ChannelKey
from app.models.user import UserGroup

log = logging.getLogger(__name__)

DOMAIN_CATALOG = "catalog"  # 模型 / 价格 / 分组
DOMAIN_CHANNELS = "channels"


@dataclass(slots=True)
class ModelInfo:
    name: str
    vendor: str | None
    mode: str
    listed: bool
    max_output_tokens: int


@dataclass(slots=True)
class Catalog:
    models: dict[str, ModelInfo]
    prices: dict[str, PriceSnapshot]  # 当前生效原价（group_ratio=1）
    groups: dict[str, UserGroup]
    time_rules: dict[str, list] = field(default_factory=dict)  # 模型 → 分时规则

    def price_for(self, model: str, group: str, at: datetime | None = None) -> PriceSnapshot | None:
        """价格快照：当前版本 × 分组倍率 × 请求时刻命中的时段倍率。"""
        base = self.prices.get(model)
        if base is None:
            return None
        g = self.groups.get(group)
        snap = PriceSnapshot.from_dict(base.to_dict())
        snap.group_ratio = Decimal(g.price_ratio) if g else Decimal("1")
        hit = match_time_rules(self.time_rules.get(model), at or datetime.now(UTC))
        if hit:
            snap.time_multiplier, snap.period = hit
        return snap


@dataclass(slots=True)
class ChannelKeyRT:
    id: int
    key: str


@dataclass(slots=True)
class ChannelRT:
    id: int
    name: str
    type: str
    provider: str
    base_url: str
    model_mapping: dict[str, str]
    multi_key_mode: str
    auto_ban: bool
    cost_ratio: Decimal
    param_override: dict
    header_override: dict
    keys: list[ChannelKeyRT] = field(default_factory=list)
    cost_time_rules: list = field(default_factory=list)

    def upstream_model(self, model: str) -> str:
        return self.model_mapping.get(model) or model


@dataclass(slots=True)
class AbilityRT:
    channel_id: int
    priority: int
    weight: int


@dataclass(slots=True)
class ChannelTable:
    channels: dict[int, ChannelRT]
    # (group, model) -> abilities，已按 priority 降序
    abilities: dict[tuple[str, str], list[AbilityRT]]

    def tiers(self, group: str, model: str) -> list[list[AbilityRT]]:
        """按优先级分档，高优先级在前。"""
        items = [a for a in self.abilities.get((group, model), []) if a.channel_id in self.channels]
        tiers: list[list[AbilityRT]] = []
        last = None
        for a in items:
            if a.priority != last:
                tiers.append([])
                last = a.priority
            tiers[-1].append(a)
        return tiers


async def _load_catalog() -> Catalog:
    now = datetime.now(UTC)
    async with SessionLocal() as s:
        vendors = {v.id: v.name for v in (await s.execute(select(Vendor))).scalars()}
        models = {
            m.name: ModelInfo(name=m.name, vendor=vendors.get(m.vendor_id), mode=m.mode, listed=m.listed,
                              max_output_tokens=m.max_output_tokens)
            for m in (await s.execute(select(ModelMeta))).scalars()
        }
        prices: dict[str, PriceSnapshot] = {}
        time_rules: dict[str, list] = {}
        rows = await s.execute(
            select(ModelPrice).where(ModelPrice.effective_at <= now)
            .order_by(ModelPrice.model, ModelPrice.effective_at.desc(), ModelPrice.id.desc())
            .distinct(ModelPrice.model)
        )
        for p in rows.scalars():
            prices[p.model] = PriceSnapshot(
                model=p.model, billing_type=p.billing_type, input_price=p.input_price,
                output_price=p.output_price, cache_read_price=p.cache_read_price,
                cache_write_price=p.cache_write_price, per_call_price=p.per_call_price, price_id=p.id,
            )
            if p.time_rules:
                time_rules[p.model] = list(p.time_rules)
        groups = {g.name: g for g in (await s.execute(select(UserGroup))).scalars()}
    return Catalog(models=models, prices=prices, groups=groups, time_rules=time_rules)


async def _load_channels() -> ChannelTable:
    async with SessionLocal() as s:
        chans = (await s.execute(select(Channel).where(Channel.status == CH_ENABLED))).scalars().all()
        keys = (await s.execute(
            select(ChannelKey).where(ChannelKey.status == CH_ENABLED).order_by(ChannelKey.id)
        )).scalars().all()
        abilities = (await s.execute(
            select(Ability).where(Ability.enabled.is_(True)).order_by(Ability.priority.desc())
        )).scalars().all()

    by_channel: dict[int, list[ChannelKeyRT]] = {}
    for k in keys:
        try:
            by_channel.setdefault(k.channel_id, []).append(ChannelKeyRT(id=k.id, key=decrypt_secret(k.key_enc)))
        except Exception:  # noqa: BLE001
            log.error("channel key %s decrypt failed", k.id)

    table: dict[int, ChannelRT] = {}
    for c in chans:
        ks = by_channel.get(c.id, [])
        if not ks:
            continue  # 无可用 Key 的渠道不参与路由
        meta = CHANNEL_TYPES.get(c.type, CHANNEL_TYPES["openai_compatible"])
        table[c.id] = ChannelRT(
            id=c.id, name=c.name, type=c.type, provider=meta["provider"],
            base_url=(c.base_url or meta["base_url"]).rstrip("/"),
            model_mapping=c.model_mapping or {}, multi_key_mode=c.multi_key_mode, auto_ban=c.auto_ban,
            cost_ratio=Decimal(c.cost_ratio), param_override=c.param_override or {},
            header_override=c.header_override or {}, keys=ks, cost_time_rules=list(c.cost_time_rules or []),
        )
    ab: dict[tuple[str, str], list[AbilityRT]] = {}
    for a in abilities:
        ab.setdefault((a.group, a.model), []).append(AbilityRT(a.channel_id, a.priority, a.weight))
    return ChannelTable(channels=table, abilities=ab)


catalog_cache: VersionedCache[Catalog] = VersionedCache(DOMAIN_CATALOG, _load_catalog, check_interval=1.0,
                                                         max_age=30)
channel_cache: VersionedCache[ChannelTable] = VersionedCache(DOMAIN_CHANNELS, _load_channels,
                                                              check_interval=1.0, max_age=60)
