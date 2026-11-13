import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { AdminCallLog } from "@/api/types";
import { DataTable } from "@/components/data-table";
import { CopyButton, Mono, StatusBadge } from "@/components/misc";
import { KV, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTableQuery } from "@/hooks/use-table-query";
import { download } from "@/lib/api";
import { compact, dayjs, dt, money, ms, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TimeCell, UserRef } from "../components/cells";
import { FilterSelect, hasFilters, ResetButton, SearchInput } from "../components/filters";
import { JsonBlock } from "../components/json";
import { LOG_STATUS, lbl } from "../lib/labels";

const DEFAULTS = {
  start: "",
  end: "",
  user_id: "",
  model: "",
  channel_id: "",
  status: "",
  request_id: "",
  token_name: "",
};

interface LogSummary {
  count: number;
  amount: number;
  cost: number;
  prompt_tokens: number;
  completion_tokens: number;
}

/** URL 中保存带时区的 ISO 字符串，输入框显示本地时间 */
function toLocalInput(iso: string) {
  return iso ? dayjs(iso).format("YYYY-MM-DDTHH:mm") : "";
}
function fromLocalInput(v: string) {
  return v ? dayjs(v).format() : "";
}

function DateTimeFilter({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="datetime-local"
        value={toLocalInput(value)}
        onChange={(e) => onChange(fromLocalInput(e.target.value))}
        className="h-8 w-[188px] text-xs"
      />
    </div>
  );
}

function TokenCell({ log }: { log: AdminCallLog }) {
  return (
    <div className="num text-xs leading-5 whitespace-nowrap">
      <div>
        <span className="text-muted-foreground">入</span> {num(log.prompt_tokens)}
        <span className="mx-1 text-muted-foreground">/</span>
        <span className="text-muted-foreground">出</span> {num(log.completion_tokens)}
      </div>
      {(log.cache_read_tokens > 0 || log.cache_write_tokens > 0 || log.usage_estimated) && (
        <div className="flex items-center gap-1 text-muted-foreground">
          {log.cache_read_tokens > 0 && <span>缓存读 {num(log.cache_read_tokens)}</span>}
          {log.cache_write_tokens > 0 && <span>写 {num(log.cache_write_tokens)}</span>}
          {log.usage_estimated && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <StatusBadge tone="warning" className="h-4 px-1 text-[10px]">
                    估算
                  </StatusBadge>
                </span>
              </TooltipTrigger>
              <TooltipContent>上游未返回 usage，按本地 tokenizer 估算</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

function StatusCell({ log }: { log: AdminCallLog }) {
  const s = lbl(LOG_STATUS, log.status);
  const badge = (
    <StatusBadge tone={s.tone} dot>
      {s.label}
      {log.status !== "success" && log.http_status ? <span className="num">{log.http_status}</span> : null}
    </StatusBadge>
  );
  if (!log.error) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-md break-all">{log.error}</TooltipContent>
    </Tooltip>
  );
}

function ModelCell({ log }: { log: AdminCallLog }) {
  return (
    <div className="flex items-center gap-1 text-xs whitespace-nowrap">
      <span className="font-medium">{log.model}</span>
      {log.upstream_model && log.upstream_model !== log.model && (
        <>
          <ArrowRight className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">{log.upstream_model}</span>
        </>
      )}
    </div>
  );
}

const columns: ColumnDef<AdminCallLog, unknown>[] = [
  { header: "时间", cell: ({ row }) => <TimeCell v={row.original.created_at} /> },
  { header: "用户", cell: ({ row }) => <UserRef id={row.original.user_id} name={row.original.username} /> },
  {
    header: "令牌",
    cell: ({ row }) => <span className="block max-w-28 truncate text-xs">{row.original.token_name || "-"}</span>,
  },
  { header: "模型", cell: ({ row }) => <ModelCell log={row.original} /> },
  {
    header: "渠道",
    cell: ({ row }) =>
      row.original.channel_id ? (
        <span className="num text-xs">
          #{row.original.channel_id}
          {row.original.channel_key_id ? <span className="text-muted-foreground"> · K{row.original.channel_key_id}</span> : null}
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  { header: "Tokens", cell: ({ row }) => <TokenCell log={row.original} /> },
  { header: "售价", cell: ({ row }) => <span className="num text-xs font-medium">{money(row.original.amount)}</span> },
  {
    header: "钱包扣费",
    cell: ({ row }) => <span className="num text-xs">{row.original.wallet_amount ? money(row.original.wallet_amount) : "-"}</span>,
  },
  {
    header: "套餐 Token",
    cell: ({ row }) => <span className="num text-xs">{row.original.package_tokens ? num(row.original.package_tokens) : "-"}</span>,
  },
  { header: "成本", cell: ({ row }) => <span className="num text-xs text-muted-foreground">{money(row.original.cost)}</span> },
  {
    header: "首字 / 总耗时",
    cell: ({ row }) => (
      <span className="num text-xs whitespace-nowrap">
        <span className="text-muted-foreground">{row.original.is_stream ? ms(row.original.first_token_ms) : "-"}</span>
        <span className="mx-1 text-muted-foreground">/</span>
        <span className={cn(row.original.duration_ms > 10_000 && "text-destructive", row.original.duration_ms > 3000 && row.original.duration_ms <= 10_000 && "text-warning")}>
          {ms(row.original.duration_ms)}
        </span>
      </span>
    ),
  },
  {
    header: "流式",
    cell: ({ row }) =>
      row.original.is_stream ? (
        <StatusBadge tone="info">流式</StatusBadge>
      ) : (
        <StatusBadge tone="muted">非流式</StatusBadge>
      ),
  },
  {
    header: "重试",
    cell: ({ row }) =>
      row.original.retry_count ? (
        <StatusBadge tone="warning" className="num">
          {row.original.retry_count}
        </StatusBadge>
      ) : (
        <span className="text-xs text-muted-foreground">0</span>
      ),
  },
  { header: "状态", cell: ({ row }) => <StatusCell log={row.original} /> },
  { header: "IP", cell: ({ row }) => <Mono className="text-muted-foreground">{row.original.client_ip || "-"}</Mono> },
];

function SummaryBar({ total, summary }: { total: number; summary?: LogSummary }) {
  // 后端汇总若与分页总数不一致，说明汇总口径异常（参见报告），不展示可能错误的金额
  const reliable = !!summary && summary.count === total;
  const val = (v: string) =>
    reliable ? (
      v
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help text-muted-foreground">—</span>
        </TooltipTrigger>
        <TooltipContent>汇总口径异常（后端汇总与筛选结果条数不一致），暂不展示</TooltipContent>
      </Tooltip>
    );
  const items: [string, React.ReactNode][] = [
    ["请求数", num(total)],
    ["售价合计", val(money(summary?.amount))],
    ["成本合计", val(money(summary?.cost))],
    ["毛利", val(money((summary?.amount ?? 0) - (summary?.cost ?? 0)))],
    ["输入 Tokens", val(compact(summary?.prompt_tokens))],
    ["输出 Tokens", val(compact(summary?.completion_tokens))],
  ];
  return (
    <div className="mb-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-6">
      {items.map(([k, v]) => (
        <div key={k} className="bg-card px-4 py-2.5">
          <div className="text-xs text-muted-foreground">{k}</div>
          <div className="num mt-0.5 text-base font-semibold">{v}</div>
        </div>
      ))}
    </div>
  );
}

function LogDetail({ log, onClose }: { log: AdminCallLog | null; onClose: () => void }) {
  const s = log ? lbl(LOG_STATUS, log.status) : null;
  return (
    <Sheet open={!!log} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {log && s && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                调用详情 <StatusBadge tone={s.tone} dot>{s.label}</StatusBadge>
              </SheetTitle>
              <SheetDescription className="flex items-center gap-1 font-mono text-xs">
                {log.request_id}
                <CopyButton text={log.request_id} />
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <div>
                <div className="mb-2 text-sm font-medium">基本信息</div>
                <KV
                  items={[
                    ["时间", dt(log.created_at)],
                    ["用户", <UserRef id={log.user_id} name={log.username} />],
                    ["令牌", `${log.token_name || "-"}${log.token_id ? ` (#${log.token_id})` : ""}`],
                    ["分组", log.group],
                    ["接口", log.endpoint],
                    ["模型", log.model],
                    ["上游模型", log.upstream_model || "-"],
                    ["渠道", log.channel_id ? `#${log.channel_id}${log.channel_key_id ? ` / Key #${log.channel_key_id}` : ""}` : "-"],
                    ["客户端 IP", log.client_ip || "-"],
                    ["HTTP 状态", log.http_status],
                    ["流式", log.is_stream ? "是" : "否"],
                    ["重试次数", log.retry_count],
                    ["首字耗时", log.is_stream ? ms(log.first_token_ms) : "-"],
                    ["总耗时", ms(log.duration_ms)],
                  ]}
                />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium">用量与计费</div>
                <KV
                  items={[
                    ["输入 Tokens", num(log.prompt_tokens)],
                    ["输出 Tokens", num(log.completion_tokens)],
                    ["缓存读 / 写", `${num(log.cache_read_tokens)} / ${num(log.cache_write_tokens)}`],
                    ["用量来源", log.usage_estimated ? <StatusBadge tone="warning">本地估算</StatusBadge> : "上游返回"],
                    ["售价", <span className="num font-medium">{money(log.amount, { precise: true })}</span>],
                    ["钱包扣费", <span className="num">{money(log.wallet_amount, { precise: true })}</span>],
                    ["套餐抵扣 Token", <span className="num">{num(log.package_tokens)}</span>],
                    ["渠道成本", <span className="num">{money(log.cost, { precise: true })}</span>],
                    ["毛利", <span className="num">{money(log.amount - log.cost, { precise: true })}</span>],
                  ]}
                />
              </div>
              {log.error && (
                <div>
                  <div className="mb-2 text-sm font-medium">错误信息</div>
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs break-all text-destructive">{log.error}</div>
                </div>
              )}
              <div>
                <div className="mb-2 text-sm font-medium">价格快照</div>
                {log.price_snapshot?.time_multiplier && String(log.price_snapshot.time_multiplier) !== "1" ? (
                  <div className="mb-2 text-xs text-warning">
                    计价时段：{String(log.price_snapshot.period || "时段")} ×{parseFloat(String(log.price_snapshot.time_multiplier))}
                  </div>
                ) : null}
                <JsonBlock value={log.price_snapshot} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function LogsPage() {
  const [auto, setAuto] = useState(false);
  const [detail, setDetail] = useState<AdminCallLog | null>(null);
  const t = useTableQuery<AdminCallLog, typeof DEFAULTS>("/api/admin/logs", DEFAULTS, { refetchInterval: auto ? 5000 : undefined });
  const f = t.filters;
  const summary = t.data?.summary as LogSummary | undefined;

  const exportCsv = () =>
    download("/api/admin/logs/export", {
      start: f.start,
      end: f.end,
      user_id: f.user_id,
      model: f.model,
      channel_id: f.channel_id,
      status: f.status,
    }, `call_logs_${dayjs().format("YYYYMMDD_HHmmss")}.csv`);

  return (
    <div>
      <PageHeader
        title="调用日志"
        description="每次 API 调用的用量、计费与耗时明细。未指定时间范围时默认查询近 7 天。"
        actions={
          <>
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <Switch id="auto-refresh" checked={auto} onCheckedChange={setAuto} />
              <Label htmlFor="auto-refresh" className="text-xs font-normal">
                自动刷新
              </Label>
            </div>
            <Button variant="outline" size="sm" onClick={() => t.refetch()} disabled={t.isFetching}>
              <RefreshCw className={cn(t.isFetching && "animate-spin")} />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download />
              导出 CSV
            </Button>
          </>
        }
      />
      <SummaryBar total={t.total} summary={summary} />
      <DataTable
        columns={columns}
        data={t.items}
        loading={t.isLoading || t.isFetching}
        total={t.total}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        rowKey={(r) => r.id}
        onRowClick={setDetail}
        toolbar={
          <>
            <DateTimeFilter label="从" value={f.start} onChange={(v) => t.setFilters({ start: v })} />
            <DateTimeFilter label="至" value={f.end} onChange={(v) => t.setFilters({ end: v })} />
            <SearchInput className="w-28" icon={false} value={f.user_id} onChange={(v) => t.setFilters({ user_id: v.replace(/\D/g, "") })} placeholder="用户 ID" />
            <SearchInput className="w-40" icon={false} value={f.model} onChange={(v) => t.setFilters({ model: v })} placeholder="模型（精确）" />
            <SearchInput className="w-28" icon={false} value={f.channel_id} onChange={(v) => t.setFilters({ channel_id: v.replace(/\D/g, "") })} placeholder="渠道 ID" />
            <SearchInput className="w-32" icon={false} value={f.token_name} onChange={(v) => t.setFilters({ token_name: v })} placeholder="令牌名称" />
            <SearchInput className="w-56" value={f.request_id} onChange={(v) => t.setFilters({ request_id: v })} placeholder="Request ID" />
            <FilterSelect
              value={f.status}
              onChange={(v) => t.setFilters({ status: v })}
              placeholder="状态"
              options={Object.entries(LOG_STATUS).map(([value, x]) => ({ value, label: x.label }))}
            />
            <ResetButton show={hasFilters(f)} onClick={t.resetFilters} />
            {auto && (
              <Badge variant="outline" className="ml-auto gap-1.5 font-normal text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-success" />
                每 5 秒刷新
              </Badge>
            )}
          </>
        }
      />
      <LogDetail log={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
