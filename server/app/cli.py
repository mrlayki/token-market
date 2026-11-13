"""命令行：python -m app.cli seed | sync-catalog"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select

from app.billing.pricing import yuan_to_micro
from app.channels.service import save_channel
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models.billing import SCOPE_MODELS, PackageProduct
from app.models.catalog import BILLING_TOKEN, ModelMeta, ModelPrice, Vendor
from app.models.channel import Channel
from app.models.user import ROLE_ROOT, User, UserGroup

# 名称, 显示名, 图标
VENDORS = [
    ("openai", "OpenAI", "openai"),
    ("anthropic", "Anthropic", "anthropic"),
    ("deepseek", "DeepSeek", "deepseek"),
    ("mock", "Mock", "mock"),
]

# 模型, 厂商, 模式, 端点, 上下文, 最大输出, 标签, 输入价, 输出价, 缓存读价, 缓存写价（元 / 百万 token）
# 参考各厂商 2026-11 官方定价（美元按 7.2 折算，DeepSeek 取高峰时段价）。
# 上线前请在管理端「模型计费」中按实际采购成本与定价策略调整。
MODELS = [
    ("gpt-6-astra", "openai", "chat", ["openai"], 1000000, 128000, ["对话", "旗舰"], "72", "360", "7.2", "0"),
    ("gpt-6.1-sol", "openai", "chat", ["openai"], 1000000, 128000, ["对话", "均衡"], "14.4", "72", "0.72", "0"),
    ("gpt-6.1-terra", "openai", "chat", ["openai"], 1000000, 128000, ["对话", "高性价比"], "7.2", "36", "0.36", "0"),
    ("gpt-6-luna", "openai", "chat", ["openai"], 1000000, 128000, ["对话", "轻量"], "0.72", "3.6", "0.072", "0"),
    ("text-embedding-3-small", "openai", "embedding", ["embeddings"], 8191, 0, ["向量"], "0.144", "0", "0", "0"),
    ("text-embedding-3-large", "openai", "embedding", ["embeddings"], 8191, 0, ["向量"], "0.936", "0", "0", "0"),
    ("claude-fable-5-2", "anthropic", "chat", ["openai", "anthropic"], 1000000, 128000, ["推理", "Agent", "旗舰"],
     "57.6", "288", "1.44", "72"),
    ("claude-opus-5-5", "anthropic", "chat", ["openai", "anthropic"], 1000000, 128000, ["编程", "Agent"],
     "28.8", "144", "1.44", "36"),
    ("claude-sonnet-5-5", "anthropic", "chat", ["openai", "anthropic"], 1000000, 128000, ["对话", "编程"],
     "14.4", "72", "0.72", "18"),
    ("claude-haiku-5-5", "anthropic", "chat", ["openai", "anthropic"], 1000000, 128000, ["对话", "高速"],
     "0.72", "3.6", "0.072", "0.9"),
    # DeepSeek 为低谷价，高峰时段由 TIME_RULES 乘 2
    ("deepseek-flash", "deepseek", "chat", ["openai", "anthropic"], 1000000, 384000, ["对话", "国产", "高性价比"],
     "1.08", "4.32", "0.0216", "0"),
    ("deepseek-v4-pro", "deepseek", "chat", ["openai", "anthropic"], 1000000, 384000, ["推理", "国产"],
     "4.752", "14.256", "0.1584", "0"),
    ("mock-gpt", "mock", "chat", ["openai", "anthropic"], 32000, 4096, ["测试"], "1", "2", "0", "0"),
    ("mock-claude", "mock", "chat", ["openai", "anthropic"], 32000, 4096, ["测试"], "1", "2", "0", "0"),
]

# 早期版本初始化过、现已被厂商新模型取代的模型（sync-catalog 时下架，不删除，可在管理端恢复）
OBSOLETE_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o", "claude-sonnet-4-5", "claude-haiku-4-5",
                   "deepseek-chat", "deepseek-reasoner"]

DEEPSEEK = ["deepseek-flash", "deepseek-v4-pro"]

# DeepSeek 官方高峰时段：UTC 01:00-04:00、06:00-10:00（工作日）= 北京时间 09:00-12:00、14:00-18:00，价格为低谷 2 倍
DEEPSEEK_PEAK = [
    {"name": "高峰", "start": "09:00", "end": "12:00", "days": [1, 2, 3, 4, 5], "multiplier": "2", "tz": "Asia/Shanghai"},
    {"name": "高峰", "start": "14:00", "end": "18:00", "days": [1, 2, 3, 4, 5], "multiplier": "2", "tz": "Asia/Shanghai"},
]
TIME_RULES = {m: DEEPSEEK_PEAK for m in DEEPSEEK}
CLAUDE = ["claude-sonnet-5-5", "claude-opus-5-5"]

GROUPS = [
    ("default", "默认分组", Decimal("1"), ["default"], 0),
    ("vip", "VIP", Decimal("0.9"), ["default", "vip"], 1),
]


async def _ensure_models(s, vendor_ids: dict[str, int]) -> list[str]:
    """补齐缺失的模型元数据与价格；已存在的模型与已设置的价格不覆盖。返回新增的模型名。"""
    now = datetime.now(UTC)
    added = []
    for i, (m, vendor, mode, eps, ctx, max_out, tags, pin, pout, pcr, pcw) in enumerate(MODELS):
        if (await s.execute(select(ModelMeta).where(ModelMeta.name == m))).scalar_one_or_none() is None:
            s.add(ModelMeta(name=m, vendor_id=vendor_ids[vendor], display_name=m, mode=mode, endpoints=eps,
                            context_length=ctx, max_output_tokens=max_out, tags=tags, listed=True, sort=i))
            added.append(m)
        if (await s.execute(select(ModelPrice).where(ModelPrice.model == m))).first() is None:
            s.add(ModelPrice(model=m, billing_type=BILLING_TOKEN, input_price=yuan_to_micro(pin),
                             output_price=yuan_to_micro(pout), cache_read_price=yuan_to_micro(pcr),
                             cache_write_price=yuan_to_micro(pcw), effective_at=now, remark="初始化参考价",
                             time_rules=TIME_RULES.get(m, [])))
    return added


async def sync_catalog() -> None:
    """已有数据库升级模型目录：补齐新模型与参考价、下架旧模型、更新预置套餐适用范围、Mock 渠道去掉真实模型名。"""
    from sqlalchemy import update

    from app.channels.service import rebuild_abilities
    from app.core.cache import bump
    from app.relay.catalog import DOMAIN_CATALOG, DOMAIN_CHANNELS

    async with SessionLocal() as s:
        vendor_ids = {v.name: v.id for v in (await s.execute(select(Vendor))).scalars()}
        added = await _ensure_models(s, vendor_ids)
        r = await s.execute(update(ModelMeta).where(ModelMeta.name.in_(OBSOLETE_MODELS), ModelMeta.listed.is_(True))
                            .values(listed=False, sort=1000))
        print(f"新增模型 {len(added)} 个：{', '.join(added) or '-'}；下架旧模型 {r.rowcount} 个")
        for name, scope in (("DeepSeek 体验包", DEEPSEEK), ("DeepSeek 千万包", DEEPSEEK), ("Claude 编程包", CLAUDE)):
            p = (await s.execute(select(PackageProduct).where(PackageProduct.name == name))).scalar_one_or_none()
            if p and set(p.scope_values or []) & set(OBSOLETE_MODELS):
                p.scope_values = scope
                if name == "Claude 编程包":
                    p.description = "Claude Sonnet 5.5 / Opus 5.5 通用，输出 token 按 5 倍计量"
                print(f"套餐「{name}」适用模型更新为 {scope}（已售出的套餐实例保持购买时的范围）")
        mock = (await s.execute(select(Channel).where(Channel.name == "Mock 上游"))).scalar_one_or_none()
        if mock:
            keep = [m for m in mock.models or [] if m.startswith("mock-")]
            if keep != list(mock.models or []):
                mock.models = keep
                mock.model_mapping = {}
                await rebuild_abilities(s, mock)
                print("Mock 渠道仅保留 mock-* 模型，避免与真实渠道争抢流量")
        await s.commit()
    await bump(DOMAIN_CATALOG, DOMAIN_CHANNELS)
    print("sync-catalog done")


async def seed() -> None:
    async with SessionLocal() as s:
        for name, display, ratio, usable, sort in GROUPS:
            if not await s.get(UserGroup, name):
                s.add(UserGroup(name=name, display_name=display, price_ratio=ratio, topup_ratio=Decimal("1"),
                                usable_groups=usable, sort=sort))
        await s.flush()

        root = (await s.execute(select(User).where(User.username == settings.root_username))).scalar_one_or_none()
        if root is None:
            s.add(User(username=settings.root_username, password_hash=hash_password(settings.root_password),
                       display_name="超级管理员", role=ROLE_ROOT, group="default"))
            print(f"created root user: {settings.root_username}")

        vendor_ids = {}
        for i, (name, display, icon) in enumerate(VENDORS):
            v = (await s.execute(select(Vendor).where(Vendor.name == name))).scalar_one_or_none()
            if v is None:
                v = Vendor(name=name, display_name=display, icon=icon, sort=i)
                s.add(v)
                await s.flush()
            vendor_ids[name] = v.id

        await _ensure_models(s, vendor_ids)

        if (await s.execute(select(PackageProduct))).first() is None:
            s.add_all([
                PackageProduct(name="DeepSeek 体验包", description="DeepSeek 全系模型通用，输入输出按 1:1 计量",
                               price=yuan_to_micro("9.9"), original_price=yuan_to_micro("16"), tokens=2_000_000,
                               scope_type=SCOPE_MODELS, scope_values=DEEPSEEK,
                               valid_days=30, limit_per_user=1, badge="新人", sort=0),
                PackageProduct(name="DeepSeek 千万包", description="DeepSeek 全系模型通用，输出 token 按 4 倍计量",
                               price=yuan_to_micro("99"), original_price=yuan_to_micro("120"), tokens=50_000_000,
                               scope_type=SCOPE_MODELS, scope_values=DEEPSEEK,
                               output_weight=Decimal("4"), valid_days=90, badge="热销", sort=1),
                PackageProduct(name="Claude 编程包", description="Claude Sonnet 5.5 / Opus 5.5 通用，输出 token 按 5 倍计量",
                               price=yuan_to_micro("199"), original_price=yuan_to_micro("240"), tokens=20_000_000,
                               scope_type=SCOPE_MODELS, scope_values=CLAUDE,
                               output_weight=Decimal("5"), valid_days=30, badge="推荐", sort=2),
            ])

        async def ensure_channel(name: str, type_: str, base_url: str, models: list[str], key: str | None, **kw):
            if not key:
                return
            if (await s.execute(select(Channel).where(Channel.name == name))).scalar_one_or_none():
                return
            await save_channel(s, {"name": name, "type": type_, "base_url": base_url, "models": models,
                                   "groups": ["default", "vip"], "test_model": models[0], **kw}, keys=[key])
            print(f"created channel: {name}")

        mock_base = os.getenv("SEED_MOCK_BASE_URL", "http://mock-upstream:8090/v1")
        await ensure_channel("Mock 上游", "openai_compatible", mock_base, ["mock-gpt", "mock-claude"], "sk-mock",
                             priority=0, remark="压测与故障注入专用")
        await ensure_channel("OpenAI 官方", "openai", "", ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna",
                                                          "text-embedding-3-small", "text-embedding-3-large"],
                             os.getenv("SEED_OPENAI_API_KEY"))
        await ensure_channel("Anthropic 官方", "anthropic", "", ["claude-fable-5-2", "claude-opus-5-5",
                                                                "claude-sonnet-5-5", "claude-haiku-5-5"],
                             os.getenv("SEED_ANTHROPIC_API_KEY"))
        await ensure_channel("DeepSeek 官方", "deepseek", "", DEEPSEEK, os.getenv("SEED_DEEPSEEK_API_KEY"))
        await s.commit()
    print("seed done")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "seed"
    if cmd == "seed":
        asyncio.run(seed())
    elif cmd == "sync-catalog":
        asyncio.run(sync_catalog())
    else:
        print(f"unknown command {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
