"""计价：售价快照、金额计算、套餐 token 计量。全部使用整数（微元 / token）运算，向上取整。"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from decimal import ROUND_CEILING, Decimal
from zoneinfo import ZoneInfo

from app.models.catalog import BILLING_PER_CALL, BILLING_TOKEN

PER_M = 1_000_000


@dataclass(slots=True)
class Usage:
    prompt_tokens: int = 0  # 输入总数（含缓存命中与缓存写入）
    completion_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    estimated: bool = False

    @property
    def total(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class PriceSnapshot:
    model: str
    billing_type: str = BILLING_TOKEN
    input_price: int = 0  # 微元 / 百万 token
    output_price: int = 0
    cache_read_price: int = 0
    cache_write_price: int = 0
    per_call_price: int = 0  # 微元 / 次
    group_ratio: Decimal = field(default_factory=lambda: Decimal("1"))
    price_id: int | None = None
    # 分时计价：请求开始时刻命中的时段倍率与名称（如 DeepSeek 高峰 ×2）
    time_multiplier: Decimal = field(default_factory=lambda: Decimal("1"))
    period: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["group_ratio"] = str(self.group_ratio)
        d["time_multiplier"] = str(self.time_multiplier)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> PriceSnapshot:
        d = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        d["group_ratio"] = Decimal(str(d.get("group_ratio", "1")))
        d["time_multiplier"] = Decimal(str(d.get("time_multiplier", "1")))
        return cls(**d)

    def base_cost(self, u: Usage) -> int:
        """原价（未乘分组倍率），微元，向上取整。"""
        if self.billing_type == BILLING_PER_CALL:
            return self.per_call_price
        cache_read = min(u.cache_read_tokens, u.prompt_tokens)
        cache_write = min(u.cache_write_tokens, max(u.prompt_tokens - cache_read, 0))
        plain_in = max(u.prompt_tokens - cache_read - cache_write, 0)
        cr_price = self.cache_read_price or self.input_price
        cw_price = self.cache_write_price or self.input_price
        numer = (
            plain_in * self.input_price
            + cache_read * cr_price
            + cache_write * cw_price
            + u.completion_tokens * self.output_price
        )
        return -(-numer // PER_M)  # ceil

    def cost(self, u: Usage) -> int:
        """售价 = 原价 × 时段倍率 × 分组倍率，微元，向上取整。"""
        base = self.base_cost(u)
        if base == 0:
            return 0
        return int((Decimal(base) * self.time_multiplier * self.group_ratio).to_integral_value(rounding=ROUND_CEILING))

    def channel_cost(self, u: Usage, cost_ratio: Decimal, cost_time_multiplier: Decimal | None = None) -> int:
        """渠道成本 = 原价 × 成本倍率 × 时段倍率（渠道未单独配置采购时段时跟随售价时段）。"""
        base = self.base_cost(u)
        if base == 0:
            return 0
        tm = self.time_multiplier if cost_time_multiplier is None else cost_time_multiplier
        return int((Decimal(base) * cost_ratio * tm).to_integral_value(rounding=ROUND_CEILING))

    @property
    def is_free(self) -> bool:
        if self.group_ratio == 0:
            return True
        if self.billing_type == BILLING_PER_CALL:
            return self.per_call_price == 0
        return self.input_price == 0 and self.output_price == 0


@dataclass(slots=True)
class PackageRule:
    id: int
    input_weight: Decimal
    output_weight: Decimal
    expires_at: float  # unix ts
    scope_type: str
    scope_values: list[str]

    def tokens_for(self, u: Usage) -> int:
        v = Decimal(u.prompt_tokens) * self.input_weight + Decimal(u.completion_tokens) * self.output_weight
        return int(v.to_integral_value(rounding=ROUND_CEILING))

    def to_meta(self) -> dict:
        return {
            "iw": str(self.input_weight),
            "ow": str(self.output_weight),
            "exp": self.expires_at,
            "st": self.scope_type,
            "sv": self.scope_values,
        }

    @classmethod
    def from_meta(cls, pkg_id: int, m: dict) -> PackageRule:
        return cls(
            id=pkg_id,
            input_weight=Decimal(m["iw"]),
            output_weight=Decimal(m["ow"]),
            expires_at=float(m["exp"]),
            scope_type=m["st"],
            scope_values=list(m.get("sv") or []),
        )

    def applies_to(self, model: str, vendor: str | None) -> bool:
        from app.models.billing import SCOPE_ALL, SCOPE_MODELS, SCOPE_VENDORS

        if self.scope_type == SCOPE_ALL:
            return True
        if self.scope_type == SCOPE_MODELS:
            return model in self.scope_values
        if self.scope_type == SCOPE_VENDORS:
            return vendor is not None and vendor in self.scope_values
        return False


@dataclass(slots=True)
class TimeRule:
    """时段规则：在指定星期与时间段内，价格乘以 multiplier。end <= start 表示跨零点。"""

    name: str
    start: str  # "HH:MM"
    end: str
    multiplier: Decimal
    days: list[int] = field(default_factory=list)  # ISO 星期 1-7，空表示每天
    tz: str = "Asia/Shanghai"

    @classmethod
    def parse(cls, d: dict) -> TimeRule:
        return cls(name=str(d.get("name") or "时段"), start=str(d["start"]), end=str(d["end"]),
                   multiplier=Decimal(str(d.get("multiplier", "1"))), days=[int(x) for x in d.get("days") or []],
                   tz=str(d.get("tz") or "Asia/Shanghai"))

    def matches(self, at: datetime) -> bool:
        local = at.astimezone(ZoneInfo(self.tz))
        if self.days and local.isoweekday() not in self.days:
            return False
        hm = local.strftime("%H:%M")
        if self.start < self.end:
            return self.start <= hm < self.end
        return hm >= self.start or hm < self.end  # 跨零点


def validate_time_rules(rules: list[dict]) -> list[dict]:
    out = []
    for r in rules or []:
        tr = TimeRule.parse(r)
        for t in (tr.start, tr.end):
            hh, mm = t.split(":")
            if not (0 <= int(hh) <= 24 and 0 <= int(mm) < 60 and len(t) == 5):
                raise ValueError(f"时间格式应为 HH:MM：{t}")
        if tr.multiplier < 0:
            raise ValueError("时段倍率不能为负")
        if any(d < 1 or d > 7 for d in tr.days):
            raise ValueError("星期取值 1-7")
        ZoneInfo(tr.tz)
        out.append({"name": tr.name, "start": tr.start, "end": tr.end, "multiplier": str(tr.multiplier),
                    "days": tr.days, "tz": tr.tz})
    return out


def match_time_rules(rules: list[dict] | None, at: datetime) -> tuple[Decimal, str] | None:
    """返回第一条命中的 (倍率, 名称)；未命中返回 None。"""
    for r in rules or []:
        tr = TimeRule.parse(r)
        if tr.matches(at):
            return tr.multiplier, tr.name
    return None


def yuan_to_micro(v: Decimal | float | str) -> int:
    return int((Decimal(str(v)) * PER_M).to_integral_value(rounding=ROUND_CEILING))


def micro_to_yuan(v: int) -> Decimal:
    return (Decimal(v) / PER_M).quantize(Decimal("0.000001"))


def ceil_div(a: int, b: int) -> int:
    return -(-a // b) if b else 0


__all__ = [
    "PackageRule",
    "PriceSnapshot",
    "Usage",
    "ceil_div",
    "micro_to_yuan",
    "yuan_to_micro",
]
