import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Camera, Download, FileUp, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/data-table";
import { confirm, StatusBadge, type Tone } from "@/components/misc";
import { Empty, KV, PageHeader, Section, StatCard } from "@/components/page";
import { api, authHeaders, download, errorMessage, toastError } from "@/lib/api";
import { compact, dayjs, dt, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Page } from "@/api/types";
import { Field, SubmitButton } from "../components/form";

// ---------------------------------------------------------------- 类型
interface ReconChannel {
  id: number;
  name: string;
  type: string;
  status: number;
  balance_supported: boolean;
}

interface PlatformSide {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  cost: number;
  revenue: number;
  estimated: number;
}

interface UpstreamSide {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  amount: number;
  raw_amount: string;
  currency: string;
}

type RowStatus = "ok" | "mismatch" | "platform_only" | "upstream_only";

interface CompareRow {
  date: string;
  model: string;
  platform: PlatformSide | null;
  upstream: UpstreamSide | null;
  status: RowStatus;
  diff_pct?: Record<"input_tokens" | "output_tokens" | "amount" | "requests", number | null>;
  mismatch_fields?: string[];
}

interface CompareResp {
  rows: CompareRow[];
  summary: {
    platform_cost: number;
    upstream_amount: number;
    platform_input: number;
    upstream_input: number;
    platform_output: number;
    upstream_output: number;
    amount_diff: number;
    amount_diff_pct: number | null;
    tolerance_pct: number;
  };
  mismatched: number;
}

interface Bill {
  id: number;
  channel_id: number;
  bill_date: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  amount: number;
  raw_amount: string;
  currency: string;
  source: string;
  batch_no: string;
  created_at: string;
}

interface Snapshot {
  id: number;
  channel_id: number;
  balance: string;
  currency: string;
  taken_at: string;
  note: string;
}

interface BalanceCompare {
  from: { id: number; taken_at: string; balance: string };
  to: { id: number; taken_at: string; balance: string };
  currency: string;
  upstream_spend: number;
  platform_cost: number;
  platform_revenue: number;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  diff: number;
  diff_pct: number | null;
  tolerance_pct: number;
  status: "ok" | "mismatch";
  note: string;
}

const STATUS: Record<RowStatus, { label: string; tone: Tone }> = {
  ok: { label: "一致", tone: "success" },
  mismatch: { label: "有差异", tone: "danger" },
  platform_only: { label: "仅平台有", tone: "warning" },
  upstream_only: { label: "仅上游有", tone: "warning" },
};

function pctText(v: number | null | undefined) {
  if (v === null || v === undefined) return "-";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ---------------------------------------------------------------- 页面
export default function UpstreamPage() {
  const [sp, setSp] = useSearchParams();
  const channels = useQuery({ queryKey: ["admin", "upstream-channels"], queryFn: () => api.get<ReconChannel[]>("/api/admin/upstream/channels") });
  const list = (channels.data ?? []).filter((c) => !c.name.startsWith("Mock"));
  const channelId = Number(sp.get("channel_id") || list[0]?.id || 0);
  const channel = channels.data?.find((c) => c.id === channelId);
  const end = sp.get("end") || dayjs().subtract(1, "day").format("YYYY-MM-DD");
  const start = sp.get("start") || dayjs(end).subtract(6, "day").format("YYYY-MM-DD");
  const tab = sp.get("tab") || "bill";
  const set = (patch: Record<string, string>) =>
    setSp((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
      return n;
    }, { replace: true });

  return (
    <>
      <PageHeader
        title="上游对账"
        description="把平台记录的调用与厂商侧的实际扣费逐日核对，发现上游多扣、漏扣或平台计量偏差。"
        actions={
          <Button variant="outline" asChild>
            <Link to="/recon">
              <Scale />
              对账报告
            </Link>
          </Button>
        }
      />
      <Alert className="mb-4 bg-muted/40">
        <AlertDescription className="block space-y-1 text-xs leading-relaxed">
          <p>
            <b>账单比对</b>：导出厂商控制台的用量账单（CSV），按「日期 × 模型」与平台记录比对请求数、输入输出 token 和金额，适用于所有厂商。
          </p>
          <p>
            <b>余额快照</b>：对提供余额接口的厂商（目前为 DeepSeek），定时记录上游余额；两次快照之间余额减少量就是上游实际扣费，再与平台在同一时段核算的渠道成本比对。
          </p>
        </AlertDescription>
      </Alert>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="渠道" className="w-60">
          <Select value={channelId ? String(channelId) : ""} onValueChange={(v) => set({ channel_id: v })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择渠道" />
            </SelectTrigger>
            <SelectContent>
              {list.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  #{c.id} {c.name}
                  {c.balance_supported && <span className="ml-1 text-xs text-muted-foreground">· 支持余额</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {tab !== "balance" && (
          <>
            <Field label="开始日期">
              <Input type="date" value={start} max={end} onChange={(e) => set({ start: e.target.value })} />
            </Field>
            <Field label="结束日期">
              <Input type="date" value={end} min={start} onChange={(e) => set({ end: e.target.value })} />
            </Field>
          </>
        )}
      </div>
      {!channelId ? (
        <Empty title="没有可对账的渠道" description="先在「渠道管理」中添加真实厂商渠道。" />
      ) : (
        <Tabs value={tab} onValueChange={(v) => set({ tab: v === "bill" ? "" : v })}>
          <TabsList>
            <TabsTrigger value="bill">账单比对</TabsTrigger>
            <TabsTrigger value="balance">余额快照</TabsTrigger>
            <TabsTrigger value="bills">账单明细</TabsTrigger>
          </TabsList>
          <TabsContent value="bill" className="mt-4">
            <BillCompare channelId={channelId} start={start} end={end} />
          </TabsContent>
          <TabsContent value="balance" className="mt-4">
            {channel?.balance_supported ? (
              <BalanceTab channelId={channelId} />
            ) : (
              <Empty
                title="该渠道的厂商未提供余额接口"
                description="目前只有 DeepSeek 支持通过接口查询余额。其他厂商请使用「账单比对」：导出厂商用量账单后导入。"
              />
            )}
          </TabsContent>
          <TabsContent value="bills" className="mt-4">
            <BillsTab channelId={channelId} start={start} end={end} />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 账单比对
function BillCompare({ channelId, start, end }: { channelId: number; start: string; end: string }) {
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const q = useQuery({
    queryKey: ["admin", "upstream-compare", channelId, start, end],
    queryFn: () => api.get<CompareResp>("/api/admin/upstream/compare", { channel_id: channelId, start, end }),
    placeholderData: keepPreviousData,
  });
  const recon = useMutation({
    mutationFn: () => api.post<{ id: number; status: string; mismatched: number }>("/api/admin/upstream/recon", { channel_id: channelId, start, end }),
    onSuccess: (r) => {
      toast.success(r.status === "ok" ? "对账一致，报告已生成" : `发现 ${r.mismatched} 处差异，报告已生成`, {
        action: { label: "查看", onClick: () => (location.href = "/recon") },
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/recon"] });
    },
    onError: toastError,
  });
  const delBills = async () => {
    const ok = await confirm({ title: "删除该区间的上游账单？", description: `${start} 至 ${end} 导入的账单将被删除，可重新导入。`, danger: true, confirmText: "删除" });
    if (!ok) return;
    try {
      const r = await api.del<{ message: string }>(`/api/admin/upstream/bills?channel_id=${channelId}&start=${start}&end=${end}`);
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["admin", "upstream-compare"] });
      qc.invalidateQueries({ queryKey: ["admin", "upstream-bills"] });
    } catch (e) {
      toastError(e);
    }
  };
  const s = q.data?.summary;
  const tol = s?.tolerance_pct ?? 1;
  const over = (v: number | null | undefined) => v !== null && v !== undefined && Math.abs(v) > tol;
  const columns = useMemo<ColumnDef<CompareRow>[]>(() => {
    const bad = (r: CompareRow, f: string) => r.mismatch_fields?.includes(f);
    const pair = (r: CompareRow, f: "input_tokens" | "output_tokens") => (
      <div className={cn("num text-xs leading-5", bad(r, f) && "text-destructive")}>
        <div>{r.platform ? num(r.platform[f]) : "-"}</div>
        <div className="text-muted-foreground">{r.upstream ? num(r.upstream[f]) : "-"}</div>
        {r.diff_pct && <div className={cn(bad(r, f) ? "font-medium" : "text-muted-foreground")}>{pctText(r.diff_pct[f])}</div>}
      </div>
    );
    return [
      { header: "日期", cell: ({ row: { original: r } }) => <span className="num text-xs">{r.date}</span> },
      { header: "上游模型", cell: ({ row: { original: r } }) => <span className="font-mono text-xs">{r.model}</span> },
      {
        header: "请求数 平台 / 上游",
        cell: ({ row: { original: r } }) => (
          <div className="num text-xs leading-5">
            <div>{r.platform ? num(r.platform.requests) : "-"}</div>
            <div className="text-muted-foreground">{r.upstream ? num(r.upstream.requests) : "-"}</div>
          </div>
        ),
      },
      { header: "输入 tokens 平台 / 上游 / 差异", cell: ({ row: { original: r } }) => pair(r, "input_tokens") },
      { header: "输出 tokens 平台 / 上游 / 差异", cell: ({ row: { original: r } }) => pair(r, "output_tokens") },
      {
        header: "金额 平台成本 / 上游 / 差异",
        cell: ({ row: { original: r } }) => (
          <div className={cn("num text-xs leading-5", bad(r, "amount") && "text-destructive")}>
            <div>{r.platform ? money(r.platform.cost, { precise: true }) : "-"}</div>
            <div className="text-muted-foreground">
              {r.upstream ? money(r.upstream.amount, { precise: true }) : "-"}
              {r.upstream && r.upstream.currency !== "CNY" && ` (${r.upstream.raw_amount} ${r.upstream.currency})`}
            </div>
            {r.diff_pct && <div className={cn(bad(r, "amount") ? "font-medium" : "text-muted-foreground")}>{pctText(r.diff_pct.amount)}</div>}
          </div>
        ),
      },
      {
        header: "状态",
        cell: ({ row: { original: r } }) => (
          <div className="space-y-1">
            <StatusBadge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusBadge>
            {r.platform?.estimated ? <div className="text-[11px] text-muted-foreground">含 {r.platform.estimated} 笔估算</div> : null}
          </div>
        ),
      },
    ];
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="平台核算成本" value={money(s?.platform_cost ?? 0)} loading={q.isLoading} hint="渠道成本 = 原价 × 成本倍率 × 时段倍率" />
        <StatCard label="上游账单金额" value={money(s?.upstream_amount ?? 0)} loading={q.isLoading} hint="已导入的账单，外币按设置汇率折算" />
        <StatCard
          label="金额差异"
          value={<span className={cn(over(s?.amount_diff_pct) && "text-destructive")}>{money(s?.amount_diff ?? 0)}</span>}
          loading={q.isLoading}
          hint={`差异率 ${pctText(s?.amount_diff_pct)} · 容差 ±${tol}%`}
        />
        <StatCard
          label="Token 平台 / 上游"
          value={`${compact((s?.platform_input ?? 0) + (s?.platform_output ?? 0))} / ${compact((s?.upstream_input ?? 0) + (s?.upstream_output ?? 0))}`}
          loading={q.isLoading}
          hint={q.data ? `${q.data.rows.length} 行，${q.data.mismatched} 行需关注` : undefined}
        />
      </div>
      <DataTable
        columns={columns}
        data={q.data?.rows}
        loading={q.isFetching}
        rowKey={(r) => `${r.date}-${r.model}`}
        toolbar={
          <>
            <Button onClick={() => setImportOpen(true)}>
              <FileUp />
              导入账单
            </Button>
            <SubmitButton variant="secondary" loading={recon.isPending} onClick={() => recon.mutate()} disabled={!q.data?.rows.length}>
              <Scale />
              生成对账报告
            </SubmitButton>
            <Button variant="ghost" className="ml-auto text-destructive" onClick={delBills}>
              <Trash2 />
              删除该区间账单
            </Button>
          </>
        }
        empty={
          <Empty
            title="所选区间暂无数据"
            description="在厂商控制台导出该渠道的用量账单（按天、按模型），按模板整理为 CSV 后点击「导入账单」。平台侧数据来自调用流水，无需导入。"
            action={
              <Button variant="outline" size="sm" onClick={() => download("/api/admin/upstream/bills/template", undefined, "upstream_bill_template.csv")}>
                <Download />
                下载模板
              </Button>
            }
          />
        }
        footer={<>每格三行依次为：平台 / 上游 / 差异率（平台相对上游）。日期按对账时区（系统设置 → 对账）划分。</>}
      />
      <ImportDialog channelId={channelId} open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function ImportDialog({ channelId, open, onOpenChange }: { channelId: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [currency, setCurrency] = useState("CNY");
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("channel_id", String(channelId));
      fd.append("currency", currency);
      fd.append("file", file!);
      const res = await fetch("/api/admin/upstream/bills/import", { method: "POST", body: fd, headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `导入失败（${res.status}）`);
      return data as { imported: number; errors: string[] };
    },
    onSuccess: (r) => {
      setResult(r);
      toast.success(`已导入 ${r.imported} 行`);
      qc.invalidateQueries({ queryKey: ["admin", "upstream-compare"] });
      qc.invalidateQueries({ queryKey: ["admin", "upstream-bills"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setFile(null);
          setResult(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入上游账单</DialogTitle>
          <DialogDescription>
            CSV 列：date, model, requests, input_tokens, output_tokens, cache_tokens, amount, currency（支持常见中英文列名）。同一渠道同一天同一模型重复导入会覆盖，不会重复计算。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="账单文件">
            <Input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="默认币种" hint="CSV 中没有 currency 列时使用；美元按「系统设置 → 对账」中的汇率折算">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CNY">人民币 CNY</SelectItem>
                <SelectItem value="USD">美元 USD</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <button type="button" className="justify-self-start text-sm text-primary hover:underline" onClick={() => download("/api/admin/upstream/bills/template", undefined, "upstream_bill_template.csv")}>
            下载 CSV 模板
          </button>
          {result && (
            <Alert>
              <AlertDescription className="text-sm">
                成功导入 {result.imported} 行
                {result.errors.length > 0 && (
                  <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-xs text-destructive">
                    {result.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <SubmitButton loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>
            导入
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 余额快照
function BalanceTab({ channelId }: { channelId: number }) {
  const qc = useQueryClient();
  const snaps = useQuery({
    queryKey: ["admin", "upstream-snapshots", channelId],
    queryFn: () => api.get<Page<Snapshot>>("/api/admin/upstream/snapshots", { channel_id: channelId, page_size: 50 }),
  });
  const items = snaps.data?.items ?? [];
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const f = fromId || (items[1] ? String(items[1].id) : "");
  const t = toId || (items[0] ? String(items[0].id) : "");
  const take = useMutation({
    mutationFn: () => api.post<Snapshot>("/api/admin/upstream/snapshots", { channel_id: channelId }),
    onSuccess: (s) => {
      toast.success(`已记录余额 ${s.balance} ${s.currency}`);
      setFromId("");
      setToId("");
      qc.invalidateQueries({ queryKey: ["admin", "upstream-snapshots", channelId] });
    },
    onError: toastError,
  });
  const cmp = useQuery({
    queryKey: ["admin", "balance-compare", channelId, f, t],
    queryFn: () => api.get<BalanceCompare>("/api/admin/upstream/balance-compare", { channel_id: channelId, from_id: f, to_id: t }),
    enabled: !!f && !!t && f !== t,
  });
  const save = useMutation({
    mutationFn: () => api.post("/api/admin/upstream/balance-recon", { channel_id: channelId, from_id: Number(f), to_id: Number(t) }),
    onSuccess: () => {
      toast.success("已保存为对账报告");
      qc.invalidateQueries({ queryKey: ["/api/admin/recon"] });
    },
    onError: toastError,
  });
  const r = cmp.data;
  const label = (s: Snapshot) => `${dt(s.taken_at, "MM-DD HH:mm:ss")} · ${s.balance} ${s.currency}`;
  const columns: ColumnDef<Snapshot>[] = [
    { header: "时间", cell: ({ row: { original: s } }) => <span className="num text-xs">{dt(s.taken_at)}</span> },
    { header: "余额", cell: ({ row: { original: s } }) => <span className="num">{s.balance}</span> },
    { header: "币种", accessorKey: "currency" },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Section
        title="余额快照"
        description={`worker 按「系统设置 → 对账」中的间隔自动记录，也可手动记录。`}
        actions={
          <SubmitButton size="sm" loading={take.isPending} onClick={() => take.mutate()}>
            <Camera />
            立即快照
          </SubmitButton>
        }
      >
        <DataTable columns={columns} data={items} loading={snaps.isLoading} rowKey={(s) => s.id} empty={<Empty title="还没有快照" description="点击「立即快照」记录当前上游余额。" />} />
      </Section>
      <Section title="区间比对" description="两次快照之间：上游余额减少量 vs 平台对该渠道核算的成本">
        {items.length < 2 ? (
          <Empty title="至少需要两次快照" description="记录一次快照后，经过一段时间的调用再记录一次。" />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="起始快照">
                <Select value={f} onValueChange={setFromId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {label(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="结束快照">
                <Select value={t} onValueChange={setToId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {label(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {r && (
              <>
                <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center">
                  <div>
                    <div className="text-xs text-muted-foreground">上游扣费（余额减少）</div>
                    <div className="num mt-1 font-medium">{money(r.upstream_spend, { precise: true })}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">平台核算成本</div>
                    <div className="num mt-1 font-medium">{money(r.platform_cost, { precise: true })}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">差额 / 差异率</div>
                    <div className={cn("num mt-1 font-semibold", r.status === "ok" ? "text-success" : "text-destructive")}>
                      {money(r.diff, { precise: true })} · {pctText(r.diff_pct)}
                    </div>
                  </div>
                </div>
                <KV
                  items={[
                    ["结论", <StatusBadge tone={r.status === "ok" ? "success" : "danger"}>{r.status === "ok" ? `一致（容差 ±${r.tolerance_pct}%）` : "有差异"}</StatusBadge>],
                    ["区间", `${dt(r.from.taken_at)} → ${dt(r.to.taken_at)}`],
                    ["余额", `${r.from.balance} → ${r.to.balance} ${r.currency}`],
                    ["平台调用", `${num(r.requests)} 次 · 输入 ${compact(r.input_tokens)} · 输出 ${compact(r.output_tokens)} tokens · 营收 ${money(r.platform_revenue, { precise: true })}`],
                    ...(r.note ? ([["说明", <span className="text-warning">{r.note}</span>]] as [string, React.ReactNode][]) : []),
                  ]}
                />
                <SubmitButton variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>
                  <Scale />
                  保存为对账报告
                </SubmitButton>
              </>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              注意：同一个上游 Key 如果在平台之外也有使用，会计入上游扣费产生差异；厂商余额更新可能有几分钟延迟，快照时刻附近的调用也可能尚未落库，建议选择调用较少的时段作为区间端点。
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- 账单明细
function BillsTab({ channelId, start, end }: { channelId: number; start: string; end: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["admin", "upstream-bills", channelId, start, end, page],
    queryFn: () => api.get<Page<Bill>>("/api/admin/upstream/bills", { channel_id: channelId, start, end, page, page_size: 20 }),
    placeholderData: keepPreviousData,
  });
  const columns: ColumnDef<Bill>[] = [
    { header: "日期", cell: ({ row: { original: b } }) => <span className="num text-xs">{b.bill_date}</span> },
    { header: "模型", cell: ({ row: { original: b } }) => <span className="font-mono text-xs">{b.model}</span> },
    { header: "请求数", cell: ({ row: { original: b } }) => <span className="num">{num(b.requests)}</span> },
    { header: "输入 / 输出 / 缓存", cell: ({ row: { original: b } }) => <span className="num text-xs">{num(b.input_tokens)} / {num(b.output_tokens)} / {num(b.cache_tokens)}</span> },
    {
      header: "金额",
      cell: ({ row: { original: b } }) => (
        <span className="num text-xs">
          {money(b.amount, { precise: true })}
          {b.currency !== "CNY" && <span className="text-muted-foreground"> ({b.raw_amount} {b.currency})</span>}
        </span>
      ),
    },
    { header: "来源", cell: ({ row: { original: b } }) => <span className="text-xs text-muted-foreground">{b.source.toUpperCase()} · {b.batch_no}</span> },
    { header: "导入时间", cell: ({ row: { original: b } }) => <span className="num text-xs text-muted-foreground">{dt(b.created_at, "MM-DD HH:mm")}</span> },
  ];
  return <DataTable columns={columns} data={q.data?.items} loading={q.isFetching} total={q.data?.total ?? 0} page={page} pageSize={20} onPageChange={setPage} rowKey={(b) => b.id} />;
}
