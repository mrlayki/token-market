import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { useSearchParams } from "react-router";
import { DataTable } from "@/components/data-table";
import { Mono } from "@/components/misc";
import { Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { compact, dayjs, dt, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LedgerEntry, Statement } from "@/api/types";
import { useTableQuery } from "@/hooks/use-table-query";
import { ModelUsageBars, UsageTrendChart } from "../components/usage-chart";
import { useUsageStats } from "../lib/data";
import { BIZ_TYPES, bizLabel } from "../lib/labels";

const TABS = [
  { value: "ledger", label: "账务流水" },
  { value: "month", label: "月度账单" },
  { value: "day", label: "日账单" },
  { value: "usage", label: "用量统计" },
];

export default function BillingPage() {
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.value === sp.get("tab")) ? sp.get("tab")! : "ledger";
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="账单明细" description="每一笔余额与套餐变动、按日 / 按月汇总的账单以及用量分析" />
      <Tabs value={tab} onValueChange={(v) => setSp(v === "ledger" ? {} : { tab: v }, { replace: true })}>
        <TabsList className="mb-5">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === "ledger" && <Ledger />}
      {(tab === "month" || tab === "day") && <Statements key={tab} period={tab} />}
      {tab === "usage" && <Usage />}
    </div>
  );
}

// ---------------------------------------------------------------- 流水
function Ledger() {
  const t = useTableQuery<LedgerEntry, { bucket_type: string; biz_type: string }>("/api/console/ledger", { bucket_type: "", biz_type: "" });
  const columns: ColumnDef<LedgerEntry>[] = [
    { header: "时间", cell: ({ row: { original: r } }) => <span className="text-xs whitespace-nowrap">{dt(r.created_at)}</span> },
    {
      header: "账户",
      cell: ({ row: { original: r } }) =>
        r.bucket_type === "wallet" ? (
          <Badge variant="outline" className="font-normal">
            余额
          </Badge>
        ) : (
          <Badge variant="outline" className="border-primary/30 font-normal text-primary">
            套餐{r.package_id ? ` #${r.package_id}` : ""}
          </Badge>
        ),
    },
    { header: "类型", cell: ({ row: { original: r } }) => <Badge variant="secondary" className="font-normal">{bizLabel(r.biz_type)}</Badge> },
    {
      header: "变动",
      cell: ({ row: { original: r } }) => (
        <span className={cn("num font-medium whitespace-nowrap", r.amount > 0 ? "text-success" : r.amount < 0 ? "text-foreground" : "text-muted-foreground")}>
          {r.amount > 0 ? "+" : ""}
          {r.bucket_type === "wallet" ? money(r.amount) : `${num(r.amount)} tokens`}
        </span>
      ),
    },
    {
      header: "变动后",
      cell: ({ row: { original: r } }) =>
        r.balance_after == null ? <span className="text-muted-foreground">-</span> : <span className="num text-sm">{r.bucket_type === "wallet" ? money(r.balance_after) : `${num(r.balance_after)} tokens`}</span>,
    },
    { header: "备注", cell: ({ row: { original: r } }) => <span className="text-sm text-muted-foreground">{r.remark || "-"}</span> },
    { header: "关联单号", cell: ({ row: { original: r } }) => (r.biz_id ? <Mono className="text-muted-foreground">{r.biz_id}</Mono> : <span className="text-muted-foreground">-</span>) },
  ];
  return (
    <DataTable
      columns={columns}
      data={t.items}
      loading={t.isFetching}
      total={t.total}
      page={t.page}
      pageSize={t.pageSize}
      onPageChange={t.setPage}
      onPageSizeChange={t.setPageSize}
      rowKey={(r) => r.id}
      toolbar={
        <>
          <Select value={t.filters.bucket_type || "all"} onValueChange={(v) => t.setFilters({ bucket_type: v === "all" ? "" : v })}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部账户</SelectItem>
              <SelectItem value="wallet">余额</SelectItem>
              <SelectItem value="package">套餐</SelectItem>
            </SelectContent>
          </Select>
          <Select value={t.filters.biz_type || "all"} onValueChange={(v) => t.setFilters({ biz_type: v === "all" ? "" : v })}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {Object.entries(BIZ_TYPES).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
      empty={<Empty title="暂无流水" />}
    />
  );
}

// ---------------------------------------------------------------- 日 / 月账单
function Statements({ period }: { period: "day" | "month" }) {
  const t = useTableQuery<Statement>("/api/console/statements", {}, { extra: { period_type: period } });
  const [open, setOpen] = useState<number | null>(null);
  const items = t.items ?? [];
  const pages = Math.max(1, Math.ceil(t.total / t.pageSize));
  const label = (s: Statement) => (period === "month" ? dayjs(s.period_start).format("YYYY 年 MM 月") : dayjs(s.period_start).format("YYYY-MM-DD"));

  if (t.isLoading) return <Skeleton className="h-64 rounded-lg" />;
  if (!items.length)
    return (
      <div className="rounded-lg border bg-card">
        <Empty title={period === "month" ? "暂无月度账单" : "暂无日账单"} description={`账单在每${period === "month" ? "月初" : "日凌晨"}自动生成，汇总上一${period === "month" ? "月" : "日"}的收支与用量`} />
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              {["账期", "期初余额", "充值", "消费", "退款", "期末余额", "套餐抵扣", "请求数", "输入 / 输出 tokens"].map((h, i) => (
                <TableHead key={h} className={cn("text-xs whitespace-nowrap", i > 0 && "text-right")}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => {
              const models = Object.entries(s.detail?.by_model ?? {}).sort((a, b) => b[1].amount - a[1].amount);
              const expanded = open === s.id;
              return (
                <Fragment key={s.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(expanded ? null : s.id)}>
                    <TableCell className="py-2.5">
                      <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{label(s)}</TableCell>
                    <TableCell className="num text-right">{money(s.opening_balance)}</TableCell>
                    <TableCell className="num text-right text-success">{s.recharged ? `+${money(s.recharged)}` : "-"}</TableCell>
                    <TableCell className="num text-right">{s.consumed ? `-${money(s.consumed)}` : "-"}</TableCell>
                    <TableCell className="num text-right">{s.refunded ? money(s.refunded) : "-"}</TableCell>
                    <TableCell className="num text-right font-medium">{money(s.closing_balance)}</TableCell>
                    <TableCell className="num text-right">{s.package_tokens ? `${compact(s.package_tokens)} tokens` : "-"}</TableCell>
                    <TableCell className="num text-right">{num(s.requests)}</TableCell>
                    <TableCell className="num text-right whitespace-nowrap">
                      {compact(s.prompt_tokens)} / {compact(s.completion_tokens)}
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell />
                      <TableCell colSpan={9} className="py-3">
                        {models.length ? (
                          <div className="overflow-hidden rounded-md border bg-background">
                            <Table>
                              <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                  {["模型", "请求数", "输入 tokens", "输出 tokens", "费用合计", "余额扣费", "套餐抵扣"].map((h, i) => (
                                    <TableHead key={h} className={cn("h-8 text-xs", i > 0 && "text-right")}>
                                      {h}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {models.map(([m, d]) => (
                                  <TableRow key={m}>
                                    <TableCell className="py-1.5">
                                      <Mono>{m}</Mono>
                                    </TableCell>
                                    <TableCell className="num py-1.5 text-right">{num(d.requests)}</TableCell>
                                    <TableCell className="num py-1.5 text-right">{num(d.prompt_tokens)}</TableCell>
                                    <TableCell className="num py-1.5 text-right">{num(d.completion_tokens)}</TableCell>
                                    <TableCell className="num py-1.5 text-right">{money(d.amount)}</TableCell>
                                    <TableCell className="num py-1.5 text-right">{money(d.wallet_amount)}</TableCell>
                                    <TableCell className="num py-1.5 text-right">{num(d.package_tokens)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">本期无模型调用</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {t.total} 期</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" disabled={t.page <= 1} onClick={() => t.setPage(t.page - 1)}>
            <ChevronLeft />
          </Button>
          <span className="num">
            {t.page} / {pages}
          </span>
          <Button variant="outline" size="icon" className="size-8" disabled={t.page >= pages} onClick={() => t.setPage(t.page + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 用量统计
function Usage() {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<"amount" | "requests" | "tokens">("amount");
  const stats = useUsageStats(days);
  const rows = stats.data?.by_model ?? [];
  const totals = rows.reduce((a, r) => ({ requests: a.requests + r.requests, tokens: a.tokens + r.tokens, amount: a.amount + r.amount }), { requests: 0, tokens: 0, amount: 0 });
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">近 7 天</SelectItem>
            <SelectItem value="30">近 30 天</SelectItem>
            <SelectItem value="90">近 90 天</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          合计 <span className="num font-medium text-foreground">{num(totals.requests)}</span> 次请求 · <span className="num font-medium text-foreground">{compact(totals.tokens)}</span> tokens ·{" "}
          <span className="num font-medium text-foreground">{money(totals.amount)}</span>
        </span>
      </div>
      <Section title="每日趋势">
        <UsageTrendChart data={stats.data} days={days} loading={stats.isLoading} />
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="模型分布"
          description="Top 10"
          actions={
            <ToggleGroup type="single" variant="outline" size="sm" value={metric} onValueChange={(v) => v && setMetric(v as typeof metric)}>
              <ToggleGroupItem value="amount" className="px-3 text-xs">
                消费
              </ToggleGroupItem>
              <ToggleGroupItem value="requests" className="px-3 text-xs">
                请求
              </ToggleGroupItem>
              <ToggleGroupItem value="tokens" className="px-3 text-xs">
                Tokens
              </ToggleGroupItem>
            </ToggleGroup>
          }
        >
          {stats.isLoading ? <Skeleton className="h-60" /> : rows.length ? <ModelUsageBars data={rows} metric={metric} /> : <Empty title="暂无用量" />}
        </Section>
        <Section title="模型明细">
          {rows.length ? (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs">模型</TableHead>
                    <TableHead className="text-right text-xs">请求数</TableHead>
                    <TableHead className="text-right text-xs">Tokens</TableHead>
                    <TableHead className="text-right text-xs">费用</TableHead>
                    <TableHead className="text-right text-xs">占比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.model}>
                      <TableCell>
                        <Mono>{r.model}</Mono>
                      </TableCell>
                      <TableCell className="num text-right">{num(r.requests)}</TableCell>
                      <TableCell className="num text-right">{compact(r.tokens)}</TableCell>
                      <TableCell className="num text-right">{money(r.amount)}</TableCell>
                      <TableCell className="num text-right text-muted-foreground">{totals.amount ? `${((r.amount / totals.amount) * 100).toFixed(1)}%` : "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : stats.isLoading ? (
            <Skeleton className="h-60" />
          ) : (
            <Empty title="暂无用量" />
          )}
        </Section>
      </div>
    </div>
  );
}
