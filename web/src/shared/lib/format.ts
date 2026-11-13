import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

export const MICRO = 1_000_000;

/** 微元 → 元（number） */
export function microToYuan(v: number | null | undefined): number {
  return (v ?? 0) / MICRO;
}

/** 元 → 微元 */
export function yuanToMicro(v: number | string): number {
  return Math.round(Number(v) * MICRO);
}

/**
 * 金额显示。小额自动保留更多小数，避免单次调用显示为 ¥0.00。
 * money(41) → ¥0.000041；money(12_340_000) → ¥12.34
 */
export function money(v: number | null | undefined, opts: { symbol?: string; precise?: boolean } = {}): string {
  const symbol = opts.symbol ?? "¥";
  const y = microToYuan(v);
  const abs = Math.abs(y);
  let digits = 2;
  if (opts.precise || (abs > 0 && abs < 0.01)) digits = abs >= 0.01 ? 4 : 6;
  const s = y.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${y < 0 ? "-" : ""}${symbol}${s.replace("-", "")}`;
}

/** 单价：微元 / 百万 token → "¥2.00 / M" */
export function pricePerM(v: number, symbol = "¥"): string {
  const y = microToYuan(v);
  const digits = y === 0 ? 2 : y < 0.1 ? 4 : 2;
  return `${symbol}${y.toFixed(digits)}`;
}

/** token 数量紧凑显示：1234 → 1.23K，2_000_000 → 2M */
export function compact(n: number | null | undefined): string {
  const v = n ?? 0;
  const abs = Math.abs(v);
  const fmt = (x: number, u: string) => `${parseFloat(x.toFixed(2))}${u}`;
  if (abs >= 1e9) return fmt(v / 1e9, "B");
  if (abs >= 1e6) return fmt(v / 1e6, "M");
  if (abs >= 1e3) return fmt(v / 1e3, "K");
  return String(v);
}

export function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("zh-CN");
}

export function dt(v: string | null | undefined, fmt = "YYYY-MM-DD HH:mm:ss"): string {
  return v ? dayjs(v).format(fmt) : "-";
}

export function fromNow(v: string | null | undefined): string {
  return v ? dayjs(v).fromNow() : "-";
}

export function ms(v: number | null | undefined): string {
  const x = v ?? 0;
  return x >= 1000 ? `${(x / 1000).toFixed(2)}s` : `${x}ms`;
}

export { dayjs };
