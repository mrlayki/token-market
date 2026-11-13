import { useQuery } from "@tanstack/react-query";
import {
  Activity, Bell, Cable, ChevronRight, Coins, Gauge, PiggyBank, Receipt, TrendingUp, Users, Wallet, Zap,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PageHeader, Section, StatCard, Empty } from "@/components/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { compact, dayjs, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Dashboard, UsageAgg } from "../lib/types";

const RANGES = [
  { v: "1", label: "今日" },
  { v: "7", label: "7 天" },
  { v: "30", label: "30 天" },
];

const amountChart = {
  amount: { label: "调用营收", color: "var(--chart-1)" },
  cost: { label: "渠道成本", color: "var(--chart-3)" },
} satisfies ChartConfig;

const reqChart = {
  ok: { label: "成功", color: "var(--chart-2)" },
  failed: { label: "失败", color: "var(--chart-4)" },
} satisfies ChartConfig;

function pct(a: number, b: number, digits = 1) {
  if (!b) return "0%";
  return `${((a / b) * 100).toFixed(digits)}%`;
}

export default function DashboardPage() {
  const [days, setDays] = useState("7");
  const q = useQuery({
    queryKey: ["admin", "dashboard", days],
    queryFn: () => api.get<Dashboard>("/api/admin/dashboard", { days }),
    refetchInterval: 60_000,
  });
  const d = q.data;
  const loading = q.isLoading;
  const t = d?.total;
  const hourly = days === "1";
  const trend = (d?.trend ?? []).map((r) => ({
    t: dayjs(r.t).format(hourly ? "HH:mm" : "MM-DD"),
    amount: r.amount / 1e6,
    cost: r.cost / 1e6,
    ok: r.requests - r.failed,
    failed: r.failed,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="数据看板"
        description="平台营收、成本与调用概览，数据按小时聚合"
        actions={
          <ToggleGroup type="single" variant="outline" size="sm" value={days} onValueChange={(v) => v && setDays(v)}>
            {RANGES.map((r) => (
              <ToggleGroupItem key={r.v} value={r.v} className="px-3">
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />

      {!!d?.unread_notifications && (
        <Alert className="border-warning/40 bg-warning/10">
          <Bell />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-foreground">
            <span>
              有 <b className="num">{d.unread_notifications}</b> 条未读系统通知（渠道禁用、对账异常等），请及时处理。
            </span>
            <Button asChild variant="outline" size="xs">
              <Link to="/notifications?unread=true">
                查看通知
                <ChevronRight />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard loading={loading} label="调用营收" icon={<Coins />} value={money(t?.amount)} hint={<>钱包扣费 {money(t?.wallet_amount)}</>} />
        <StatCard loading={loading} label="渠道成本" icon={<Receipt />} value={money(t?.cost)} hint="按渠道成本倍率折算" />
        <StatCard
          loading={loading}
          label="毛利"
          icon={<TrendingUp />}
          value={<span className={cn((t?.gross_profit ?? 0) < 0 && "text-destructive")}>{money(t?.gross_profit)}</span>}
          hint={<>毛利率 {pct(t?.gross_profit ?? 0, t?.amount ?? 0)}</>}
        />
        <StatCard
          loading={loading}
          label="请求数"
          icon={<Activity />}
          value={num(t?.requests)}
          hint={
            <span className={cn((t?.failed ?? 0) > 0 && "text-destructive")}>
              失败 {num(t?.failed)} · 失败率 {pct(t?.failed ?? 0, t?.requests ?? 0)}
            </span>
          }
        />
        <StatCard
          loading={loading}
          label="Token 消耗"
          icon={<Zap />}
          value={compact((t?.prompt_tokens ?? 0) + (t?.completion_tokens ?? 0))}
          hint={<>输入 {compact(t?.prompt_tokens)} · 输出 {compact(t?.completion_tokens)}</>}
        />
        <StatCard
          loading={loading}
          label="充值到账"
          icon={<Wallet />}
          value={money(d?.orders.paid_amount)}
          hint={<>{num(d?.orders.paid_count)} 笔 · 今日 {money(d?.orders.paid_amount_today)}</>}
        />
        <StatCard loading={loading} label="用户数" icon={<Users />} value={num(d?.users.total)} hint={<>今日新增 {num(d?.users.new_today)}</>} />
        <StatCard loading={loading} label="余额沉淀" icon={<PiggyBank />} value={money(d?.wallet_balance_total)} hint="全部用户钱包余额合计" />
        <StatCard
          loading={loading}
          label="渠道"
          icon={<Cable />}
          value={
            <>
              {num(d?.channels.enabled)}
              <span className="text-base font-normal text-muted-foreground"> / {num(d?.channels.total)}</span>
            </>
          }
          hint={
            <Link to="/channels" className="hover:underline">
              启用 / 总数，管理渠道 →
            </Link>
          }
        />
        <StatCard
          loading={loading}
          label="实时负载"
          icon={<Gauge />}
          value={
            <>
              {num(d?.realtime.rpm)}
              <span className="text-sm font-normal text-muted-foreground"> RPM</span>
            </>
          }
          hint={<>近 1 分钟 TPM {compact(d?.realtime.tpm)}</>}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="营收与成本趋势" description={hourly ? "按小时（元）" : "按天（元）"} className="xl:col-span-2">
          {loading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : trend.length ? (
            <ChartContainer config={amountChart} className="aspect-auto h-[260px] w-full">
              <AreaChart data={trend} margin={{ left: 4, right: 8, top: 8 }}>
                <defs>
                  {(["amount", "cost"] as const).map((k) => (
                    <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={`var(--color-${k})`} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={`var(--color-${k})`} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => `¥${compact(v)}`} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      formatter={(value, name) => (
                        <div className="flex w-full justify-between gap-4">
                          <span className="text-muted-foreground">{amountChart[name as keyof typeof amountChart]?.label ?? name}</span>
                          <span className="num font-medium">{money(Math.round(Number(value) * 1e6))}</span>
                        </div>
                      )}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Area dataKey="amount" type="monotone" stroke="var(--color-amount)" fill="url(#fill-amount)" strokeWidth={2} />
                <Area dataKey="cost" type="monotone" stroke="var(--color-cost)" fill="url(#fill-cost)" strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          ) : (
            <Empty title="暂无调用数据" />
          )}
        </Section>
        <Section title="请求量" description={hourly ? "按小时" : "按天"}>
          {loading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : trend.length ? (
            <ChartContainer config={reqChart} className="aspect-auto h-[260px] w-full">
              <BarChart data={trend} margin={{ left: 0, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => compact(v)} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="ok" stackId="r" fill="var(--color-ok)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed" stackId="r" fill="var(--color-failed)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          ) : (
            <Empty title="暂无调用数据" />
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <TopTable
          title="Top 模型"
          loading={loading}
          rows={d?.top_models}
          name={(r) => <span className="font-mono text-xs">{r.model}</span>}
          link={(r) => `/logs?model=${encodeURIComponent(r.model)}`}
        />
        <TopTable
          title="Top 用户"
          loading={loading}
          rows={d?.top_users}
          name={(r) => (
            <span>
              {r.username} <span className="num text-xs text-muted-foreground">#{r.user_id}</span>
            </span>
          )}
          link={(r) => `/logs?user_id=${r.user_id}`}
        />
        <TopTable
          title="Top 渠道"
          loading={loading}
          rows={d?.top_channels}
          name={(r) => (
            <span>
              {r.name} <span className="num text-xs text-muted-foreground">#{r.channel_id}</span>
            </span>
          )}
          link={(r) => `/logs?channel_id=${r.channel_id}`}
        />
      </div>
    </div>
  );
}

function TopTable<T extends UsageAgg>({
  title,
  rows,
  name,
  link,
  loading,
}: {
  title: string;
  rows: T[] | undefined;
  name: (r: T) => React.ReactNode;
  link: (r: T) => string;
  loading: boolean;
}) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.amount));
  return (
    <Section title={title} className="gap-2">
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : !rows?.length ? (
        <Empty title="暂无数据" />
      ) : (
        <div className="-mx-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 text-xs">名称</TableHead>
                <TableHead className="h-8 text-right text-xs">请求</TableHead>
                <TableHead className="h-8 text-right text-xs">Token</TableHead>
                <TableHead className="h-8 text-right text-xs">营收</TableHead>
                <TableHead className="h-8 text-right text-xs">毛利</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-[160px] py-1.5">
                    <Link to={link(r)} className="block truncate hover:underline">
                      {name(r)}
                    </Link>
                    <div className="mt-1 h-1 rounded-full bg-muted">
                      <div className="h-1 rounded-full bg-chart-1" style={{ width: `${(r.amount / max) * 100}%` }} />
                    </div>
                  </TableCell>
                  <TableCell className="num py-1.5 text-right text-xs">
                    {num(r.requests)}
                    {r.failed > 0 && <div className="text-destructive">失败 {num(r.failed)}</div>}
                  </TableCell>
                  <TableCell className="num py-1.5 text-right text-xs">{compact(r.prompt_tokens + r.completion_tokens)}</TableCell>
                  <TableCell className="num py-1.5 text-right text-xs">{money(r.amount)}</TableCell>
                  <TableCell className={cn("num py-1.5 text-right text-xs", r.gross_profit < 0 && "text-destructive")}>{money(r.gross_profit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}
