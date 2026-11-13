/** 分时计价规则：文字描述与客户端匹配（与 server/app/billing/pricing.py TimeRule 一致） */
import type { TimeRule } from "@/api/types";

export const DEFAULT_TZ = "Asia/Shanghai";
export const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/** 星期描述：[] → 每天；[1..5] → 工作日；[6,7] → 周末；连续 → 周一至周三；否则 周一、三、五 */
export function daysText(days: number[] | undefined): string {
  const d = Array.from(new Set(days ?? [])).sort((a, b) => a - b);
  if (!d.length || d.length === 7) return "每天";
  const key = d.join(",");
  if (key === "1,2,3,4,5") return "工作日";
  if (key === "6,7") return "周末";
  const consecutive = d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (consecutive) return `周${WEEKDAYS[d[0] - 1]}至周${WEEKDAYS[d[d.length - 1] - 1]}`;
  return `周${d.map((x) => WEEKDAYS[x - 1]).join("、")}`;
}

/** 倍率展示：2 → ×2；0.5 → ×0.5 */
export function multText(m: string | number): string {
  const n = Number(m);
  return Number.isFinite(n) ? `×${parseFloat(n.toFixed(4))}` : `×${m}`;
}

/** 倍率含义：×2 → 2 倍；×0.5 → 5 折 */
export function multMeaning(m: string | number): string {
  const n = Number(m);
  if (!Number.isFinite(n)) return "";
  if (n === 1) return "原价";
  if (n === 0) return "免费";
  if (n < 1) return `${parseFloat((n * 10).toFixed(2))} 折`;
  return `${parseFloat(n.toFixed(4))} 倍`;
}

export function crossesMidnight(r: Pick<TimeRule, "start" | "end">): boolean {
  return r.end <= r.start;
}

/** 时间段：09:00–12:00；跨零点 22:00–次日 06:00；开始 = 结束 → 全天 */
export function rangeText(r: Pick<TimeRule, "start" | "end">): string {
  if (r.start === r.end) return "全天";
  return crossesMidnight(r) ? `${r.start}–次日 ${r.end}` : `${r.start}–${r.end}`;
}

/** 单条规则描述，如「工作日 09:00–12:00 ×2」 */
export function ruleText(r: TimeRule, withName = false): string {
  const tz = r.tz && r.tz !== DEFAULT_TZ ? `（${r.tz}）` : "";
  return `${withName && r.name ? `${r.name}：` : ""}${daysText(r.days)} ${rangeText(r)} ${multText(r.multiplier)}${tz}`;
}

/** 倍率范围摘要：×2 或 ×0.5~2 */
export function multRangeText(rules: TimeRule[]): string {
  const ns = rules.map((r) => Number(r.multiplier)).filter(Number.isFinite);
  if (!ns.length) return "";
  const lo = Math.min(...ns);
  const hi = Math.max(...ns);
  const f = (n: number) => String(parseFloat(n.toFixed(4)));
  return lo === hi ? `×${f(lo)}` : `×${f(lo)}~${f(hi)}`;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** 指定时区下的 ISO 星期与 "HH:MM" */
export function localParts(at: Date, tz: string): { weekday: number; hm: string } {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(at).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { weekday: WD[parts.weekday] ?? 1, hm: `${hour}:${parts.minute}` };
}

export function ruleMatches(r: TimeRule, at: Date): boolean {
  let p: { weekday: number; hm: string };
  try {
    p = localParts(at, r.tz || DEFAULT_TZ);
  } catch {
    return false; // 浏览器不支持的时区
  }
  if (r.days?.length && !r.days.includes(p.weekday)) return false;
  if (r.start < r.end) return r.start <= p.hm && p.hm < r.end;
  return p.hm >= r.start || p.hm < r.end; // 跨零点
}

/** 返回第一条命中的规则（按请求开始时刻），未命中返回 null */
export function matchTimeRule(rules: TimeRule[] | null | undefined, at: Date = new Date()): TimeRule | null {
  for (const r of rules ?? []) if (ruleMatches(r, at)) return r;
  return null;
}
