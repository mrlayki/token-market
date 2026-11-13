"""业务配置（setting 表），带默认值与类型校验，供各模块读取。"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.cache import VersionedCache, bump
from app.core.db import SessionLocal
from app.models.ops import Setting

DOMAIN = "settings"

# key -> (默认值, 分组, 说明)
DEFAULTS: dict[str, tuple[Any, str, str]] = {
    # 站点
    "site.name": ("Token Market", "site", "站点名称"),
    "site.logo": ("", "site", "Logo URL"),
    "site.footer": ("", "site", "页脚 HTML"),
    "site.about": ("", "site", "关于页内容（Markdown）"),
    "site.home_content": ("", "site", "首页自定义内容（Markdown），为空使用默认首页"),
    "site.api_base_url": ("", "site", "对外展示的 API 地址，为空使用当前域名"),
    "site.docs_url": ("", "site", "文档链接"),
    "site.terms": ("", "site", "用户协议（Markdown）"),
    "site.privacy": ("", "site", "隐私政策（Markdown）"),
    # 注册登录
    "auth.register_enabled": (True, "auth", "允许新用户注册"),
    "auth.password_login_enabled": (True, "auth", "允许密码登录"),
    "auth.email_domain_whitelist": ([], "auth", "注册邮箱域名白名单，空为不限"),
    # 计费
    "billing.currency_symbol": ("¥", "billing", "货币符号"),
    "billing.new_user_gift": (0, "billing", "新用户赠送余额（微元）"),
    "billing.overdraft_limit": (500_000, "billing", "结算允许透支额度（微元），用于吸收预估偏差"),
    "billing.default_max_tokens": (4096, "billing", "请求未指定 max_tokens 时用于预扣估算的输出 token 数"),
    "billing.max_est_output_tokens": (32768, "billing", "预扣估算的输出 token 上限"),
    "billing.quota_warn_threshold": (1_000_000, "billing", "余额低于该值时提醒（微元）"),
    # 支付
    "payment.methods": (["alipay", "wechat"], "payment", "启用的支付方式"),
    "payment.topup_options": ([10, 50, 100, 200, 500, 1000], "payment", "充值档位（元）"),
    "payment.min_topup": (1, "payment", "最低充值金额（元）"),
    "payment.max_topup": (50000, "payment", "单笔最高充值金额（元）"),
    "payment.discounts": ({"500": "0.97", "1000": "0.95"}, "payment", "满额折扣：{金额阈值: 折扣}"),
    "payment.order_expire_minutes": (30, "payment", "订单支付超时（分钟）"),
    # 渠道健康
    "channel.retry_times": (2, "channel", "失败重试次数（每次切换到下一优先级）"),
    "channel.retry_status_codes": ("429,500-599", "channel", "触发重试的上游状态码"),
    "channel.auto_disable": (True, "channel", "上游错误时自动禁用渠道 Key"),
    "channel.auto_enable": (True, "channel", "测试成功时自动启用被自动禁用的渠道"),
    "channel.disable_status_codes": ("401,403", "channel", "触发自动禁用的状态码"),
    "channel.disable_keywords": (
        ["insufficient_quota", "invalid_api_key", "account_deactivated", "billing_not_active",
         "credit balance is too low", "permission_error", "Your account", "已欠费", "余额不足"],
        "channel", "错误信息命中关键词时自动禁用"),
    "channel.slow_threshold_ms": (0, "channel", "测试耗时超过该值视为失败，0 为不限"),
    "channel.auto_test_minutes": (0, "channel", "定时巡检间隔（分钟），0 为关闭"),
    "channel.cooldown_seconds": (30, "channel", "429/5xx 后渠道临时冷却时间"),
    # 限流
    "ratelimit.user_rpm": (0, "ratelimit", "每用户每分钟请求数，0 不限"),
    "ratelimit.global_rpm": (0, "ratelimit", "全站每分钟请求数，0 不限"),
    # 通知
    "notify.webhook_url": ("", "notify", "管理员告警 Webhook"),
    # 对账
    "recon.timezone": ("Asia/Shanghai", "recon", "对账日期的时区（与厂商账单日期口径一致）"),
    "recon.tolerance_pct": (1.0, "recon", "对账允许误差（%），超过即标记差异"),
    "recon.usd_cny_rate": ("7.2", "recon", "美元账单折算人民币汇率"),
    "recon.balance_snapshot_minutes": (60, "recon", "上游余额快照间隔（分钟），0 为关闭"),
    # 日志
    "log.retention_days": (180, "log", "调用流水保留天数"),
}


async def _load() -> dict[str, Any]:
    values = {k: v[0] for k, v in DEFAULTS.items()}
    async with SessionLocal() as s:
        for row in (await s.execute(select(Setting))).scalars():
            if row.key in DEFAULTS:
                values[row.key] = row.value
    return values


_cache: VersionedCache[dict[str, Any]] = VersionedCache(DOMAIN, _load, check_interval=2.0, max_age=120)


async def get_all() -> dict[str, Any]:
    return await _cache.get()


async def get(key: str) -> Any:
    return (await _cache.get())[key]


async def update(values: dict[str, Any]) -> None:
    unknown = set(values) - set(DEFAULTS)
    if unknown:
        raise KeyError(f"未知配置项: {', '.join(sorted(unknown))}")
    async with SessionLocal() as s:
        for k, v in values.items():
            default = DEFAULTS[k][0]
            if isinstance(default, bool) and not isinstance(v, bool):
                raise ValueError(f"{k} 需要布尔值")
            if isinstance(default, int) and not isinstance(default, bool) and not isinstance(v, int):
                raise ValueError(f"{k} 需要整数")
            stmt = insert(Setting).values(key=k, value=v).on_conflict_do_update(
                index_elements=[Setting.key], set_={"value": v})
            await s.execute(stmt)
        await s.commit()
    _cache.invalidate_local()
    await bump(DOMAIN)


def parse_code_ranges(spec: str) -> list[tuple[int, int]]:
    """解析 "429,500-599" 形式的状态码范围。"""
    out = []
    for part in (spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            out.append((int(a), int(b)))
        else:
            out.append((int(part), int(part)))
    return out


def code_in(code: int, ranges: list[tuple[int, int]]) -> bool:
    return any(a <= code <= b for a, b in ranges)
