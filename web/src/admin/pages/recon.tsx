import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, CircleAlert, Database, FileSearch, Loader2, Play, RotateCcw, Scale, Zap } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { OK } from "@/api/types";
import { DataTable } from "@/components/data-table";
import { confirm, StatusBadge } from "@/components/misc";
import { Empty, KV, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTableQuery } from "@/hooks/use-table-query";
import { api, toastError } from "@/lib/api";
import { dt, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TimeCell } from "../components/cells";
import { FilterSelect, hasFilters, ResetButton } from "../components/filters";
import { JsonBlock } from "../components/json";
import { RECON_KIND } from "../lib/labels";
import { useIsRoot } from "../lib/queries";
import type { ReconReport } from "../lib/types";

const DEFAULTS = { kind: "", status: "" };
const KIND_ICON = { ledger_vs_balance: Scale, calllog_vs_ledger: FileSearch, redis_vs_db: Zap } as const;

const SUMMARY_LABEL: Record<string, string> = {
  wallets: "钱包数",
  packages: "套餐数",
  n: "调用笔数",
  cost: "成本",
  amount: "售价",
  wallet: "钱包扣费",
  loaded_users: "已加载用户",
};
const MONEY_KEYS = new Set(["cost", "amount", "wallet", "db", "ledger", "call_wallet", "ledger_wallet", "redis_available", "redis_frozen", "diff"]);

function summaryText(s: Record<string, unknown>) {
  const parts = Object.entries(s).map(([k, v]) => `${SUMMARY_LABEL[k] ?? k} ${typeof v === "number" && MONEY_KEYS.has(k) && k !== "n" ? money(v) : String(v)}`);
  return parts.join(" · ") || "-";
}

function StatusTag({ r }: { r: Pick<ReconReport, "status" | "resolved"> }) {
  if (r.status === "ok") return <StatusBadge tone="success" dot>一致</StatusBadge>;
  return r.resolved ? <StatusBadge tone="muted" dot>差异 · 已处理</StatusBadge> : <StatusBadge tone="danger" dot>存在差异</StatusBadge>;
}

function useRebuild() {
  return useMutation({
    mutationFn: (uid: number) => api.post<OK>(`/api/admin/users/${uid}/rebuild-quota`),
    onSuccess: (r) => toast.success(r.message || "已重建"),
    onError: toastError,
  });
}

function DiffTable({ report }: { report: ReconReport }) {
  const isRoot = useIsRoot();
  const rebuild = useRebuild();
  const keys = Array.from(new Set(report.diffs.flatMap((d) => Object.keys(d))));
  const canRebuild = isRoot && report.kind === "redis_vs_db";
  const fmt = (k: string, v: unknown) => {
    if (v == null) return <span className="text-muted-foreground">-</span>;
    if (k === "user_id") return <Link to={`/users?keyword=${v}`} className="num hover:underline">#{String(v)}</Link>;
    if (k === "request_id") return <Link to={`/logs?request_id=${v}`} className="font-mono text-xs hover:underline">{String(v)}</Link>;
    if (typeof v === "number") {
      const pkg = report.diffs.some((d) => d.type === "package");
      return <span className="num">{MONEY_KEYS.has(k) && !pkg ? money(v, { precise: true }) : num(v)}</span>;
    }
    if (typeof v === "object") return <span className="font-mono text-xs">{JSON.stringify(v)}</span>;
    return String(v);
  };
  if (!report.diffs.length) return <Empty title="没有差异" description="本次对账所有记录均一致。" />;
  return (
    <div className="overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            {keys.map((k) => (
              <TableHead key={k} className="font-mono text-xs">{k}</TableHead>
            ))}
            {canRebuild && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.diffs.map((d, i) => (
            <TableRow key={i}>
              {keys.map((k) => (
                <TableCell key={k} className="text-xs whitespace-nowrap">{fmt(k, d[k])}</TableCell>
              ))}
              {canRebuild && (
                <TableCell>
                  {typeof d.user_id === "number" && (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={rebuild.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `重建用户 #${d.user_id} 的额度缓存？`,
                          description: "将丢弃该用户在 Redis 中的热数据，下次请求时从数据库重新加载。存在进行中的预扣时会被拒绝。",
                          confirmText: "重建",
                        });
                        if (ok) rebuild.mutate(d.user_id as number);
                      }}
                    >
                      <RotateCcw />
                      重建额度
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReportSheet({ report, onClose, onResolve, resolving }: { report: ReconReport | null; onClose: () => void; onResolve: (r: ReconReport) => void; resolving: boolean }) {
  return (
    <Sheet open={!!report} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        {report && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {RECON_KIND[report.kind]?.label ?? report.kind}
                <StatusTag r={report} />
              </SheetTitle>
              <SheetDescription>{RECON_KIND[report.kind]?.desc}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <KV
                items={[
                  ["报告 ID", `#${report.id}`],
                  ["对账时间", dt(report.created_at)],
                  ...(report.period_start ? ([["对账区间", `${dt(report.period_start)} ~ ${dt(report.period_end)}`]] as [string, string][]) : []),
                  ["检查条数", num(report.checked)],
                  ["差异条数", <span className={cn("num", report.mismatched > 0 && "font-medium text-destructive")}>{num(report.mismatched)}</span>],
                  ["汇总", summaryText(report.summary)],
                ]}
              />
              {report.status === "mismatch" && !report.resolved && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                  <span>核实并修复差异后，可将该报告标记为已处理。</span>
                  <Button size="sm" variant="outline" disabled={resolving} onClick={() => onResolve(report)}>
                    {resolving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                    标记已处理
                  </Button>
                </div>
              )}
              <div>
                <div className="mb-2 text-sm font-medium">差异明细{report.diffs.length >= 500 && <span className="ml-2 text-xs font-normal text-muted-foreground">（最多保留 500 条）</span>}</div>
                <DiffTable report={report} />
              </div>
              {report.diffs.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-medium">原始数据</div>
                  <JsonBlock value={report.diffs} maxHeight={280} />
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ResultCard({ r, onOpen }: { r: ReconReport; onOpen: () => void }) {
  const Icon = KIND_ICON[r.kind] ?? Database;
  const ok = r.status === "ok";
  return (
    <Card className={cn("cursor-pointer gap-3 py-4 transition-colors hover:bg-muted/30", !ok && "border-destructive/40")} onClick={onOpen}>
      <CardContent className="space-y-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4 text-muted-foreground" />
            {RECON_KIND[r.kind]?.label ?? r.kind}
          </div>
          {ok ? <CheckCircle2 className="size-5 text-success" /> : <CircleAlert className="size-5 text-destructive" />}
        </div>
        <div className="flex items-baseline gap-4">
          <div>
            <div className="text-xs text-muted-foreground">检查</div>
            <div className="num text-xl font-semibold">{num(r.checked)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">差异</div>
            <div className={cn("num text-xl font-semibold", !ok && "text-destructive")}>{num(r.mismatched)}</div>
          </div>
        </div>
        <div className="truncate text-xs text-muted-foreground">{summaryText(r.summary)}</div>
      </CardContent>
    </Card>
  );
}

export default function ReconPage() {
  const qc = useQueryClient();
  const t = useTableQuery<ReconReport, typeof DEFAULTS>("/api/admin/recon", DEFAULTS);
  const f = t.filters;
  const [open, setOpen] = useState<ReconReport | null>(null);
  const [results, setResults] = useState<ReconReport[] | null>(null);

  const run = useMutation({
    mutationFn: () => api.post<ReconReport[]>("/api/admin/recon/run", { kind: "all" }),
    onSuccess: (r) => {
      setResults(r);
      const bad = r.filter((x) => x.status !== "ok").length;
      if (bad) toast.warning(`对账完成：${bad} 项存在差异`);
      else toast.success("对账完成：全部一致");
      qc.invalidateQueries({ queryKey: ["/api/admin/recon"] });
    },
    onError: toastError,
  });

  const resolve = useMutation({
    mutationFn: (r: ReconReport) => api.post<OK>(`/api/admin/recon/${r.id}/resolve`),
    onSuccess: (_, r) => {
      toast.success("已标记为已处理");
      setOpen((o) => (o && o.id === r.id ? { ...o, resolved: true } : o));
      setResults((rs) => rs?.map((x) => (x.id === r.id ? { ...x, resolved: true } : x)) ?? null);
      qc.invalidateQueries({ queryKey: ["/api/admin/recon"] });
    },
    onError: toastError,
  });

  const columns: ColumnDef<ReconReport, unknown>[] = [
    { header: "ID", cell: ({ row }) => <span className="num text-xs text-muted-foreground">{row.original.id}</span> },
    { header: "对账项", cell: ({ row }) => <span className="font-medium whitespace-nowrap">{RECON_KIND[row.original.kind]?.label ?? row.original.kind}</span> },
    { header: "结果", cell: ({ row }) => <StatusTag r={row.original} /> },
    { header: "检查", cell: ({ row }) => <span className="num">{num(row.original.checked)}</span> },
    {
      header: "差异",
      cell: ({ row }) => <span className={cn("num", row.original.mismatched ? "font-medium text-destructive" : "text-muted-foreground")}>{num(row.original.mismatched)}</span>,
    },
    {
      header: "汇总",
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block max-w-[320px] truncate text-xs text-muted-foreground">{summaryText(row.original.summary)}</span>
          </TooltipTrigger>
          <TooltipContent>{summaryText(row.original.summary)}</TooltipContent>
        </Tooltip>
      ),
    },
    { header: "对账时间", cell: ({ row }) => <TimeCell v={row.original.created_at} /> },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); setOpen(row.original); }}>
            详情
          </Button>
          {row.original.status === "mismatch" && !row.original.resolved && (
            <Button
              variant="ghost"
              size="xs"
              disabled={resolve.isPending}
              onClick={(e) => {
                e.stopPropagation();
                resolve.mutate(row.original);
              }}
            >
              标记已处理
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="对账中心"
        description="定期核对资金数据的一致性，及时发现计费异常。系统会定时自动对账，也可随时手动执行。"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/upstream">上游对账</Link>
            </Button>
            <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="animate-spin" /> : <Play />}
              立即对账
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        {results
          ? results.map((r) => <ResultCard key={r.id} r={r} onOpen={() => setOpen(r)} />)
          : Object.entries(RECON_KIND).filter(([k]) => k in KIND_ICON).map(([k, v]) => {
              const Icon = KIND_ICON[k as keyof typeof KIND_ICON];
              return (
                <Card key={k} className="gap-2 py-4">
                  <CardContent className="space-y-1.5 px-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="size-4 text-muted-foreground" />
                      {v.label}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{v.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium">对账报告</h2>
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
          onRowClick={setOpen}
          empty={<Empty title="暂无对账报告" description="点击右上角「立即对账」执行一次。" />}
          toolbar={
            <>
              <FilterSelect
                value={f.kind}
                onChange={(v) => t.setFilters({ kind: v })}
                placeholder="对账项"
                className="w-48"
                options={Object.entries(RECON_KIND).map(([value, x]) => ({ value, label: x.label }))}
              />
              <FilterSelect
                value={f.status}
                onChange={(v) => t.setFilters({ status: v })}
                placeholder="结果"
                options={[
                  { value: "ok", label: "一致" },
                  { value: "mismatch", label: "存在差异" },
                ]}
              />
              <ResetButton show={hasFilters(f)} onClick={t.resetFilters} />
            </>
          }
        />
      </div>

      <ReportSheet report={open} onClose={() => setOpen(null)} onResolve={(r) => resolve.mutate(r)} resolving={resolve.isPending} />
    </div>
  );
}
