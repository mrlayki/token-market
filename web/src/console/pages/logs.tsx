import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { DataTable } from "@/components/data-table";
import { CopyButton, Mono, StatusBadge } from "@/components/misc";
import { Empty, KV, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { compact, dayjs, dt, money, ms, num } from "@/lib/format";
import type { ApiToken, CallLog, Page } from "@/api/types";
import { useTableQuery } from "@/hooks/use-table-query";
import { useMarketplace } from "../lib/data";
import { LogStatusBadge } from "../lib/labels";

const ENDPOINTS: Record<string, string> = { chat: "Chat Completions", messages: "Messages", embeddings: "Embeddings" };

function Charge({ r }: { r: CallLog }) {
  if (r.status !== "success" && r.status !== "client_abort" && r.amount === 0) return <span className="text-xs text-muted-foreground">未计费</span>;
  return (
    <div className="num text-sm whitespace-nowrap">
      {r.wallet_amount > 0 && <div className="font-medium">{money(r.wallet_amount)}</div>}
      {r.package_tokens > 0 && <div className="text-xs text-primary">套餐 {compact(r.package_tokens)} tokens</div>}
      {r.wallet_amount === 0 && r.package_tokens === 0 && <span className="text-muted-foreground">{money(0)}</span>}
    </div>
  );
}

export default function LogsPage() {
  const [sp] = useSearchParams();
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  // 日期按本地时区换算为 ISO 时间（from/to 本身仅保存在 URL 中，后端会忽略）
  const extra = {
    start: from ? dayjs(from).startOf("day").toISOString() : undefined,
    end: to ? dayjs(to).add(1, "day").startOf("day").toISOString() : undefined,
  };
  const t = useTableQuery<CallLog, { model: string; token_name: string; status: string; from: string; to: string; request_id: string }>(
    "/api/console/logs",
    { model: "", token_name: "", status: "", from: "", to: "", request_id: "" },
    { extra },
  );
  const tq = t;
  const mk = useMarketplace();
  const tokens = useQuery({ queryKey: ["/api/console/tokens", "all"], queryFn: () => api.get<Page<ApiToken>>("/api/console/tokens", { page_size: 100 }) });
  const [rid, setRid] = useState(t.filters.request_id);
  const [detail, setDetail] = useState<CallLog | null>(null);
  useEffect(() => setRid(t.filters.request_id), [t.filters.request_id]);

  const columns: ColumnDef<CallLog>[] = [
    { header: "时间", cell: ({ row: { original: r } }) => <span className="text-xs whitespace-nowrap">{dt(r.created_at, "MM-DD HH:mm:ss")}</span> },
    { header: "模型", cell: ({ row: { original: r } }) => <Mono className="whitespace-nowrap">{r.model}</Mono> },
    { header: "令牌", cell: ({ row: { original: r } }) => <span className="text-sm whitespace-nowrap">{r.token_name || "-"}</span> },
    {
      header: "输入 / 输出",
      cell: ({ row: { original: r } }) => (
        <div className="num text-sm whitespace-nowrap">
          <span>{num(r.prompt_tokens)}</span>
          <span className="text-muted-foreground"> / </span>
          <span>{num(r.completion_tokens)}</span>
          {r.usage_estimated && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-1.5 inline-block">
                  <StatusBadge tone="warning" className="h-4 px-1 text-[10px]">
                    估算
                  </StatusBadge>
                </span>
              </TooltipTrigger>
              <TooltipContent>上游未返回用量，按文本长度估算</TooltipContent>
            </Tooltip>
          )}
          {r.cache_read_tokens > 0 && <div className="text-[11px] text-muted-foreground">缓存命中 {num(r.cache_read_tokens)}</div>}
        </div>
      ),
    },
    { header: "扣费", cell: ({ row: { original: r } }) => <Charge r={r} /> },
    {
      header: "首字 / 总耗时",
      cell: ({ row: { original: r } }) => (
        <div className="num text-xs whitespace-nowrap">
          {r.is_stream ? ms(r.first_token_ms) : "-"} <span className="text-muted-foreground">/</span> {ms(r.duration_ms)}
          {r.is_stream && (
            <StatusBadge tone="info" className="ml-1.5 h-4 px-1 text-[10px]">
              流式
            </StatusBadge>
          )}
        </div>
      ),
    },
    {
      header: "状态",
      cell: ({ row: { original: r } }) =>
        r.error ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">
                <LogStatusBadge status={r.status} />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm break-all">{r.error}</TooltipContent>
          </Tooltip>
        ) : (
          <LogStatusBadge status={r.status} />
        ),
    },
  ];

  const hasFilter = Object.values(t.filters).some(Boolean);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="调用日志" description="默认展示近 30 天的调用记录，点击行查看详情" />
      <DataTable
        columns={columns}
        data={tq.items}
        loading={tq.isFetching}
        total={tq.total}
        page={tq.page}
        pageSize={tq.pageSize}
        onPageChange={tq.setPage}
        onPageSizeChange={tq.setPageSize}
        onRowClick={setDetail}
        rowKey={(r) => r.id}
        toolbar={
          <>
            <Select value={t.filters.model || "all"} onValueChange={(v) => t.setFilters({ model: v === "all" ? "" : v })}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模型</SelectItem>
                {(mk.data?.models ?? []).map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={t.filters.token_name || "all"} onValueChange={(v) => t.setFilters({ token_name: v === "all" ? "" : v })}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="令牌" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部令牌</SelectItem>
                {[...new Set((tokens.data?.items ?? []).map((x) => x.name))].map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={t.filters.status || "all"} onValueChange={(v) => t.setFilters({ status: v === "all" ? "" : v })}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
                <SelectItem value="client_abort">客户端中断</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input type="date" value={t.filters.from} max={t.filters.to || undefined} onChange={(e) => t.setFilters({ from: e.target.value })} className="w-[150px]" aria-label="开始日期" />
              <span className="text-muted-foreground">~</span>
              <Input type="date" value={t.filters.to} min={t.filters.from || undefined} onChange={(e) => t.setFilters({ to: e.target.value })} className="w-[150px]" aria-label="结束日期" />
            </div>
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                t.setFilters({ request_id: rid.trim() });
              }}
            >
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={rid} onChange={(e) => setRid(e.target.value)} onBlur={() => rid.trim() !== t.filters.request_id && t.setFilters({ request_id: rid.trim() })} placeholder="Request ID" className="w-[220px] pl-8 font-mono text-xs" />
            </form>
            {hasFilter && (
              <Button variant="ghost" size="sm" onClick={t.resetFilters}>
                <RotateCcw /> 重置
              </Button>
            )}
          </>
        }
        empty={<Empty title="暂无调用记录" description={hasFilter ? "试试调整筛选条件" : "通过 API 或操练场发起调用后，记录会显示在这里"} />}
      />

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  调用详情 <LogStatusBadge status={detail.status} />
                </SheetTitle>
                <SheetDescription>{dt(detail.created_at)}</SheetDescription>
              </SheetHeader>
              <div className="space-y-5 px-4 pb-6">
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 pl-3">
                  <span className="text-xs text-muted-foreground">Request ID</span>
                  <Mono className="min-w-0 flex-1 truncate">{detail.request_id}</Mono>
                  <CopyButton text={detail.request_id} />
                </div>
                {detail.error && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm break-all text-destructive">
                    <div className="mb-1 font-medium">错误信息（HTTP {detail.http_status}）</div>
                    {detail.error}
                  </div>
                )}
                <KV
                  items={[
                    ["模型", <Mono>{detail.model}</Mono>],
                    ["令牌", detail.token_name || "-"],
                    ["分组", detail.group],
                    ["接口", ENDPOINTS[detail.endpoint] ?? detail.endpoint],
                    ["流式", detail.is_stream ? "是" : "否"],
                    ["HTTP 状态", detail.http_status],
                  ]}
                />
                <Separator />
                <KV
                  items={[
                    ["输入 tokens", <span className="num">{num(detail.prompt_tokens)}</span>],
                    ["输出 tokens", <span className="num">{num(detail.completion_tokens)}</span>],
                    ["缓存读取", <span className="num">{num(detail.cache_read_tokens)}</span>],
                    ["缓存写入", <span className="num">{num(detail.cache_write_tokens)}</span>],
                    ["用量来源", detail.usage_estimated ? <StatusBadge tone="warning">估算</StatusBadge> : "上游返回"],
                  ]}
                />
                <Separator />
                <KV
                  items={[
                    ["费用合计", <span className="num font-medium">{money(detail.amount)}</span>],
                    ["余额扣费", <span className="num">{money(detail.wallet_amount)}</span>],
                    ["套餐抵扣", <span className="num">{num(detail.package_tokens)} tokens</span>],
                  ]}
                />
                <Separator />
                <KV
                  items={[
                    ["首字耗时", detail.is_stream ? ms(detail.first_token_ms) : "-"],
                    ["总耗时", ms(detail.duration_ms)],
                    ["重试次数", detail.retry_count],
                  ]}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
