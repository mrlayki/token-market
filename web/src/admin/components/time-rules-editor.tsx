import { Clock, Info, Plus, Trash2, Zap } from "lucide-react";
import type { TimeRule } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/misc";
import { DEFAULT_TZ, multMeaning, multRangeText, rangeText, ruleText, WEEKDAYS, daysText } from "@/lib/time-rules";
import { cn } from "@/lib/utils";
import { AffixInput } from "./form";

/** DeepSeek 官方高峰时段：工作日 09:00–12:00、14:00–18:00 价格 ×2（以闲时价为基础价） */
export const DEEPSEEK_PEAK_PRESET: TimeRule[] = [
  { name: "高峰", start: "09:00", end: "12:00", days: [1, 2, 3, 4, 5], multiplier: "2", tz: DEFAULT_TZ },
  { name: "高峰", start: "14:00", end: "18:00", days: [1, 2, 3, 4, 5], multiplier: "2", tz: DEFAULT_TZ },
];

const HM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

/** 校验规则列表，返回错误信息或 null */
export function validateTimeRules(rules: TimeRule[]): string | null {
  for (const [i, r] of rules.entries()) {
    const at = `时段规则第 ${i + 1} 条`;
    if (!HM.test(r.start) || !HM.test(r.end)) return `${at}：请填写开始与结束时间（HH:MM）`;
    const m = String(r.multiplier).trim();
    if (m === "" || !Number.isFinite(Number(m)) || Number(m) < 0) return `${at}：倍率需为非负数字`;
  }
  return null;
}

/** 提交前规整：去空白、倍率转标准十进制字符串、星期排序去重 */
export function normalizeTimeRules(rules: TimeRule[]): TimeRule[] {
  return rules.map((r) => ({
    name: r.name.trim() || "时段",
    start: r.start,
    end: r.end,
    days: Array.from(new Set(r.days)).sort((a, b) => a - b),
    multiplier: String(parseFloat(Number(r.multiplier).toFixed(6))),
    tz: r.tz || DEFAULT_TZ,
  }));
}

export function TimeRulesEditor({ value, onChange, emptyText }: { value: TimeRule[]; onChange: (v: TimeRule[]) => void; emptyText?: string }) {
  const set = (i: number, patch: Partial<TimeRule>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">{emptyText ?? "未设置时段规则：全天按基础价计费"}</div>
      ) : (
        value.map((r, i) => {
          const valid = HM.test(r.start) && HM.test(r.end) && r.multiplier !== "" && Number(r.multiplier) >= 0;
          return (
            <div key={i} className="space-y-2 rounded-md border bg-muted/20 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="名称，如 高峰" className="h-8 w-28" aria-label="名称" />
                <Input type="time" value={r.start} onChange={(e) => set(i, { start: e.target.value })} className="num h-8 w-[6.5rem]" aria-label="开始" />
                <span className="text-xs text-muted-foreground">至</span>
                <Input type="time" value={r.end} onChange={(e) => set(i, { end: e.target.value })} className="num h-8 w-[6.5rem]" aria-label="结束" />
                <AffixInput
                  type="number"
                  min={0}
                  step="0.1"
                  prefix="×"
                  value={r.multiplier}
                  onChange={(e) => set(i, { multiplier: e.target.value })}
                  className="w-24 [&_input]:h-8 [&_input]:pr-2"
                  aria-label="倍率"
                />
                <span className="w-12 text-xs text-muted-foreground">{r.multiplier !== "" && multMeaning(r.multiplier)}</span>
                <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="删除">
                  <Trash2 />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  size="sm"
                  value={r.days.map(String)}
                  onValueChange={(v) => set(i, { days: v.map(Number).sort((a, b) => a - b) })}
                >
                  {WEEKDAYS.map((w, k) => (
                    <ToggleGroupItem key={w} value={String(k + 1)} className="h-7 w-7 min-w-7 px-0 text-xs data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
                      {w}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <span className={cn("text-xs", valid ? "text-muted-foreground" : "text-destructive")}>
                  {valid ? `${daysText(r.days)} ${rangeText(r)} ${multMeaning(r.multiplier)}` : "请填写完整的时间与倍率"}
                  {r.tz && r.tz !== DEFAULT_TZ && ` · ${r.tz}`}
                </span>
              </div>
            </div>
          );
        })
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          onClick={() => onChange([...value, { name: "", start: "09:00", end: "18:00", days: [], multiplier: "1", tz: DEFAULT_TZ }])}
        >
          <Plus />
          添加时段
        </Button>
        <Button variant="ghost" size="xs" onClick={() => onChange(DEEPSEEK_PEAK_PRESET.map((r) => ({ ...r, days: [...r.days] })))}>
          <Zap />
          DeepSeek 高峰预设
        </Button>
        {value.length > 0 && (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onChange([])}>
            清空
          </Button>
        )}
      </div>
      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" />
        <span>按请求开始时刻匹配第一条命中的规则；结束早于开始表示跨零点；星期不选表示每天；时区 Asia/Shanghai。未命中任何规则时按基础价计费。</span>
      </p>
    </div>
  );
}

/** 只读展示：「分时 ×2」徽标，悬浮列出各时段 */
export function TimeRulesBadge({ rules, className }: { rules: TimeRule[] | null | undefined; className?: string }) {
  if (!rules?.length) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex", className)} onClick={(e) => e.stopPropagation()}>
          <StatusBadge tone="info" className="px-1.5 text-[11px]">
            <Clock className="size-3" />
            分时 {multRangeText(rules)}
          </StatusBadge>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5">
          {rules.map((r, i) => (
            <div key={i}>{ruleText(r, true)}</div>
          ))}
          <div className="opacity-70">其余时间按基础价</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** 规则文字列表（历史等处使用） */
export function TimeRulesText({ rules, className }: { rules: TimeRule[] | null | undefined; className?: string }) {
  if (!rules?.length) return <span className={cn("text-muted-foreground", className)}>全天基础价</span>;
  return (
    <div className={cn("space-y-0.5", className)}>
      {rules.map((r, i) => (
        <div key={i} className="whitespace-nowrap">
          {ruleText(r, true)}
        </div>
      ))}
    </div>
  );
}
