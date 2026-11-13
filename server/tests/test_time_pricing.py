from datetime import datetime
from decimal import Decimal

import pytest

from app.billing.pricing import PriceSnapshot, Usage, match_time_rules, validate_time_rules

PEAK = validate_time_rules([
    {"name": "高峰", "start": "09:00", "end": "12:00", "days": [1, 2, 3, 4, 5], "multiplier": "2"},
    {"name": "夜间", "start": "23:00", "end": "07:00", "multiplier": "0.5"},
])


@pytest.mark.parametrize("ts,expect", [
    ("2026-11-13T02:30:00+00:00", ("2", "高峰")),   # 周五 10:30 北京时间
    ("2026-11-14T02:30:00+00:00", None),            # 周六 10:30 不是高峰
    ("2026-11-13T05:00:00+00:00", None),            # 周五 13:00
    ("2026-11-13T16:00:00+00:00", ("0.5", "夜间")),  # 周六 00:00 跨零点规则
    ("2026-11-13T22:59:00+00:00", ("0.5", "夜间")),  # 周六 06:59
])
def test_match(ts, expect):
    hit = match_time_rules(PEAK, datetime.fromisoformat(ts))
    assert (hit and (str(hit[0]), hit[1])) == (expect and (expect[0], expect[1])) or (hit is None and expect is None)


def test_cost_with_time_and_group_and_channel():
    p = PriceSnapshot(model="m", input_price=1_000_000, output_price=4_000_000, group_ratio=Decimal("0.9"),
                      time_multiplier=Decimal("2"))
    u = Usage(prompt_tokens=1000, completion_tokens=500)
    base = 1000 * 1 + 500 * 4  # 3000 微元
    assert p.base_cost(u) == base
    assert p.cost(u) == 5400  # 3000 × 2 × 0.9
    assert p.channel_cost(u, Decimal("0.8")) == 4800  # 跟随售价时段 ×2
    assert p.channel_cost(u, Decimal("0.8"), Decimal("1")) == 2400  # 渠道单独规则未命中高峰


def test_snapshot_roundtrip_keeps_multiplier():
    p = PriceSnapshot(model="m", time_multiplier=Decimal("2"), period="高峰")
    q = PriceSnapshot.from_dict(p.to_dict())
    assert q.time_multiplier == Decimal("2") and q.period == "高峰"


def test_invalid_rule():
    with pytest.raises(ValueError):
        validate_time_rules([{"start": "9:00", "end": "12:00", "multiplier": "2"}])
