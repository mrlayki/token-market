import { useQueryClient } from "@tanstack/react-query";
import { dayjs, yuanToMicro } from "@/lib/format";
import { yuanStr } from "../../components/form";
import { qk } from "../../lib/queries";
import type { TimeRule } from "@/api/types";
import { normalizeTimeRules, validateTimeRules } from "../../components/time-rules-editor";
import type { PriceVersion } from "../../lib/types";

export interface PriceDraft {
  billing_type: "token" | "per_call";
  input: string;
  output: string;
  cache_read: string;
  cache_write: string;
  per_call: string;
  time_rules: TimeRule[];
}

export interface PriceBody {
  model: string;
  billing_type: "token" | "per_call";
  input_price: number;
  output_price: number;
  cache_read_price: number;
  cache_write_price: number;
  per_call_price: number;
  effective_at: string | null;
  time_rules: TimeRule[];
  remark: string;
}

export function draftFromPrice(p: PriceVersion | null | undefined): PriceDraft {
  return {
    billing_type: p?.billing_type ?? "token",
    input: p ? yuanStr(p.input_price) : "",
    output: p ? yuanStr(p.output_price) : "",
    cache_read: p ? yuanStr(p.cache_read_price) : "",
    cache_write: p ? yuanStr(p.cache_write_price) : "",
    per_call: p ? yuanStr(p.per_call_price) : "",
    time_rules: p?.time_rules ? p.time_rules.map((r) => ({ ...r, days: [...(r.days ?? [])] })) : [],
  };
}

const y = (s: string) => (s.trim() === "" ? 0 : yuanToMicro(s));

/** 校验价格草稿，返回错误信息或 null */
export function validateDraft(d: PriceDraft): string | null {
  const fields = d.billing_type === "token" ? [d.input, d.output, d.cache_read, d.cache_write] : [d.per_call];
  for (const f of fields) {
    if (f.trim() !== "" && (!Number.isFinite(Number(f)) || Number(f) < 0)) return "价格需为非负数字";
  }
  if (d.billing_type === "token" && y(d.input) === 0 && y(d.output) === 0) return "输入与输出价格不能同时为 0";
  if (d.billing_type === "per_call" && y(d.per_call) === 0) return "请填写按次价格";
  return validateTimeRules(d.time_rules);
}

export function bodyFromDraft(model: string, d: PriceDraft, effectiveLocal: string, remark: string): PriceBody {
  const token = d.billing_type === "token";
  return {
    model,
    billing_type: d.billing_type,
    input_price: token ? y(d.input) : 0,
    output_price: token ? y(d.output) : 0,
    cache_read_price: token ? y(d.cache_read) : 0,
    cache_write_price: token ? y(d.cache_write) : 0,
    per_call_price: token ? 0 : y(d.per_call),
    effective_at: effectiveLocal ? dayjs(effectiveLocal).toISOString() : null,
    time_rules: normalizeTimeRules(d.time_rules),
    remark: remark.trim(),
  };
}

export function validateEffective(local: string): string | null {
  if (!local) return null;
  if (!dayjs(local).isValid()) return "时间格式错误";
  if (dayjs(local).isBefore(dayjs())) return "生效时间需晚于当前时间；如需立即生效请留空";
  return null;
}

export function useInvalidatePrices() {
  const qc = useQueryClient();
  return (model?: string) => {
    qc.invalidateQueries({ queryKey: ["/api/admin/models"] });
    qc.invalidateQueries({ queryKey: qk.allModels });
    qc.invalidateQueries({ queryKey: ["admin", "models-missing"] });
    if (model) qc.invalidateQueries({ queryKey: ["admin", "price-history", model] });
  };
}

/** 折扣展示：0.9 → 9 折；1 → 原价；1.2 → 加价 ×1.2 */
export function ratioLabel(r: string | number): string {
  const n = Number(r);
  if (!Number.isFinite(n)) return String(r);
  if (n === 1) return "原价";
  if (n === 0) return "免费";
  if (n < 1) return `${parseFloat((n * 10).toFixed(2))} 折`;
  return `加价 ×${parseFloat(n.toFixed(4))}`;
}
