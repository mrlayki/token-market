"""上游账单对账集成测试（本地 Postgres）。"""

import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete

from app.billing.upstream_recon import compare_bill, import_bill_csv
from app.core.db import SessionLocal, engine
from app.models.channel import Channel, UpstreamBill
from app.models.logs import CallLog

TZ = ZoneInfo("Asia/Shanghai")


@pytest.fixture(scope="module", autouse=True)
async def _dispose():
    yield
    await engine.dispose()


async def _setup() -> int:
    async with SessionLocal() as s:
        ch = Channel(name=f"recon-test-{uuid.uuid4().hex[:6]}", type="deepseek", models=["x"], groups=["default"])
        s.add(ch)
        await s.flush()

        def log(day: int, model: str, pt: int, ct: int, cost: int):
            return CallLog(created_at=datetime(2026, 1, day, 12, tzinfo=TZ), request_id=uuid.uuid4().hex, user_id=1,
                           channel_id=ch.id, model=model, upstream_model=model, status="success",
                           prompt_tokens=pt, completion_tokens=ct, cost=cost)

        s.add_all([
            log(10, "deepseek-flash", 1000, 500, 3000), log(10, "deepseek-flash", 1000, 500, 3000),  # 与账单一致
            log(10, "deepseek-v4-pro", 2000, 1000, 20000),  # 账单金额偏差 10%
            log(11, "deepseek-flash", 100, 50, 300),  # 平台有、账单无
        ])
        await s.commit()
        return ch.id


async def test_import_and_compare():
    cid = await _setup()
    csv_text = (
        "日期,模型,请求数,输入,输出,缓存命中,金额,币种\n"
        "2026-01-10,deepseek-flash,2,2000,1000,0,0.006,CNY\n"
        "2026-01-10,deepseek-v4-pro,1,2000,1000,0,0.022,CNY\n"
        "2026-01-12,deepseek-flash,1,10,10,0,0.000001,USD\n"
        "bad-date,x,1,1,1,0,1,CNY\n"
    )
    res = await import_bill_csv(cid, csv_text)
    assert res["imported"] == 3 and len(res["errors"]) == 1
    # 重复导入同一份账单：按 渠道 × 日期 × 模型 覆盖，不会翻倍
    await import_bill_csv(cid, csv_text)

    cmp = await compare_bill(cid, date(2026, 1, 10), date(2026, 1, 12))
    by = {(r["date"], r["model"]): r for r in cmp.rows}
    assert by[("2026-01-10", "deepseek-flash")]["status"] == "ok"
    v4 = by[("2026-01-10", "deepseek-v4-pro")]
    assert v4["status"] == "mismatch" and v4["mismatch_fields"] == ["amount"]
    assert by[("2026-01-11", "deepseek-flash")]["status"] == "platform_only"
    assert by[("2026-01-12", "deepseek-flash")]["status"] == "upstream_only"
    assert by[("2026-01-12", "deepseek-flash")]["upstream"]["amount"] == 7  # 0.000001 USD × 7.2 ≈ 7 微元
    assert cmp.mismatched == 3

    async with SessionLocal() as s:
        await s.execute(delete(UpstreamBill).where(UpstreamBill.channel_id == cid))
        await s.execute(delete(CallLog).where(CallLog.channel_id == cid))
        await s.execute(delete(Channel).where(Channel.id == cid))
        await s.commit()
