import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { compact, dayjs, money, num } from "@/lib/format";
import type { UsageStats } from "../lib/data";

type Metric = "amount" | "requests" | "tokens";

const META: Record<Metric, { label: string; fmt: (v: number) => string; axis: (v: number) => string }> = {
  amount: { label: "消费金额", fmt: (v) => money(v), axis: (v) => money(v).replace(/\.?0+$/, "") },
  requests: { label: "请求数", fmt: (v) => `${num(v)} 次`, axis: (v) => compact(v) },
  tokens: { label: "Tokens", fmt: (v) => num(v), axis: (v) => compact(v) },
};

/** 每日用量趋势：单一指标切换（不使用双轴） */
export function UsageTrendChart({ data, days, loading, height = 260 }: { data?: UsageStats; days: number; loading?: boolean; height?: number }) {
  const [metric, setMetric] = useState<Metric>("amount");
  const rows = useMemo(() => {
    const map = new Map((data?.trend ?? []).map((r) => [r.day, r]));
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = dayjs().subtract(i, "day").format("YYYY-MM-DD");
      const r = map.get(d);
      out.push({
        day: d,
        label: dayjs(d).format("MM-DD"),
        amount: r?.amount ?? 0,
        wallet_amount: r?.wallet_amount ?? 0,
        package_tokens: r?.package_tokens ?? 0,
        requests: r?.requests ?? 0,
        tokens: (r?.prompt_tokens ?? 0) + (r?.completion_tokens ?? 0),
      });
    }
    return out;
  }, [data, days]);
  const m = META[metric];
  const config: ChartConfig = { [metric]: { label: m.label, color: "var(--chart-1)" } };
  return (
    <div className="space-y-3">
      <ToggleGroup type="single" variant="outline" size="sm" value={metric} onValueChange={(v) => v && setMetric(v as Metric)}>
        {(Object.keys(META) as Metric[]).map((k) => (
          <ToggleGroupItem key={k} value={k} className="px-3 text-xs">
            {META[k].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {loading ? (
        <Skeleton style={{ height }} />
      ) : (
        <ChartContainer config={config} className="w-full" style={{ height }}>
          <AreaChart data={rows} margin={{ left: 4, right: 8, top: 8 }}>
            <defs>
              <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`var(--color-${metric})`} stopOpacity={0.25} />
                <stop offset="100%" stopColor={`var(--color-${metric})`} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={m.axis} allowDecimals={false} />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, p) => (p?.[0]?.payload?.day as string) ?? ""}
                  formatter={(v, _n, item) => (
                    <div className="flex w-full flex-col gap-0.5">
                      <div className="flex justify-between gap-6">
                        <span className="text-muted-foreground">{m.label}</span>
                        <span className="num font-medium text-foreground">{m.fmt(Number(v))}</span>
                      </div>
                      {metric === "amount" && (
                        <>
                          <div className="flex justify-between gap-6">
                            <span className="text-muted-foreground">余额扣费</span>
                            <span className="num text-foreground">{money(item.payload.wallet_amount)}</span>
                          </div>
                          <div className="flex justify-between gap-6">
                            <span className="text-muted-foreground">套餐抵扣</span>
                            <span className="num text-foreground">{compact(item.payload.package_tokens)} tokens</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                />
              }
            />
            <Area dataKey={metric} type="linear" stroke={`var(--color-${metric})`} strokeWidth={2} fill={`url(#fill-${metric})`} activeDot={{ r: 4 }} />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}

/** 模型用量横向条形图 */
export function ModelUsageBars({ data, metric = "amount", height }: { data: UsageStats["by_model"]; metric?: "amount" | "requests" | "tokens"; height?: number }) {
  const label = { amount: "消费金额", requests: "请求数", tokens: "Tokens" }[metric];
  const fmt = metric === "amount" ? (v: number) => money(v) : (v: number) => num(v);
  const rows = [...data].sort((a, b) => b[metric] - a[metric]).slice(0, 10);
  const config: ChartConfig = { [metric]: { label, color: "var(--chart-1)" } };
  return (
    <ChartContainer config={config} className="w-full" style={{ height: height ?? Math.max(120, rows.length * 40 + 20) }}>
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 16 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={metric === "amount" ? (v) => money(v).replace(/\.?0+$/, "") : compact} />
        <YAxis type="category" dataKey="model" tickLine={false} axisLine={false} width={130} tick={{ fontSize: 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<ChartTooltipContent formatter={(v) => <span className="num font-medium text-foreground">{label}：{fmt(Number(v))}</span>} />} />
        <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}
