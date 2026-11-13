import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle, ArrowRight, Ban, CheckCircle2, Copy, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw,
  Tag, Trash2, Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable } from "@/components/data-table";
import { confirm, StatusBadge } from "@/components/misc";
import { PageHeader } from "@/components/page";
import { useTableQuery } from "@/hooks/use-table-query";
import type { OK } from "@/api/types";
import { api, toastError } from "@/lib/api";
import { compact, dt, fromNow, money, ms } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FilterSelect, hasFilters, ResetButton, SearchInput } from "../components/filters";
import { CHANNEL_STATUS } from "../lib/labels";
import { qk, useAllModels, useChannelTags, useChannelTypes, useGroups } from "../lib/queries";
import type { Channel, ChannelTestResult } from "../lib/types";
import { ChannelEditor } from "./channels/editor";
import { KeyManager } from "./channels/keys";
import { BatchTestDialog, CHANNELS_KEY, TestButton } from "./channels/test";

const FILTERS = { keyword: "", type: "", status: "", group: "", tag: "", model: "", sort: "" };

export default function ChannelsPage() {
  const qc = useQueryClient();
  const t = useTableQuery<Channel, typeof FILTERS>(CHANNELS_KEY, FILTERS);
  const types = useChannelTypes();
  const groups = useGroups();
  const tags = useChannelTags();
  const models = useAllModels();
  const [selected, setSelected] = useState<Channel[]>([]);
  const [selKey, setSelKey] = useState(0);
  const [editor, setEditor] = useState<{ open: boolean; channel: Channel | null }>({ open: false, channel: null });
  const [keysOf, setKeysOf] = useState<Channel | null>(null);
  const [batchTest, setBatchTest] = useState<{ open: boolean; results: ChannelTestResult[] | null; names: Record<number, string> }>({
    open: false,
    results: null,
    names: {},
  });

  const typeLabel = useMemo(() => Object.fromEntries((types.data ?? []).map((x) => [x.value, x.label])), [types.data]);
  const groupLabel = useMemo(() => Object.fromEntries((groups.data ?? []).map((g) => [g.name, g.display_name])), [groups.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [CHANNELS_KEY] });
    qc.invalidateQueries({ queryKey: qk.channelTags });
  };

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Channel> }) => api.put<Channel>(`/api/admin/channels/${id}`, body),
    onSuccess: () => {
      toast.success("已更新");
      invalidate();
    },
    onError: toastError,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => api.post<Channel>(`/api/admin/channels/${id}/status`, { status: on ? 1 : 2 }),
    onSuccess: (c) => {
      toast.success(`「${c.name}」已${c.status === 1 ? "启用" : "禁用"}`);
      invalidate();
    },
    onError: toastError,
  });
  const copy = useMutation({
    mutationFn: (id: number) => api.post<Channel>(`/api/admin/channels/${id}/copy`),
    onSuccess: (c) => {
      toast.success(`已复制为「${c.name}」`, { action: { label: "编辑", onClick: () => setEditor({ open: true, channel: c }) } });
      invalidate();
    },
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del<OK>(`/api/admin/channels/${id}`),
    onSuccess: () => {
      toast.success("渠道已删除");
      invalidate();
    },
    onError: toastError,
  });
  const balance = useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean; message?: string; balance?: string; currency?: string }>(`/api/admin/channels/${id}/balance`),
    onSuccess: (r) => {
      if (r.ok) toast.success(`余额：${r.balance} ${r.currency ?? ""}`);
      else toast.error(r.message ?? "查询失败");
      invalidate();
    },
    onError: toastError,
  });
  const batch = useMutation({
    mutationFn: (body: { ids: number[]; action: string; value?: string | number }) => api.post<OK>("/api/admin/channels/batch", body),
    onSuccess: (r) => {
      toast.success(r.message || "操作成功");
      invalidate();
    },
    onError: toastError,
  });
  const runBatchTest = useMutation({
    mutationFn: (body: { ids?: number[]; scope: "selected" | "enabled" | "all" | "auto_disabled" }) =>
      api.post<ChannelTestResult[]>("/api/admin/channels/test/batch", body),
    onMutate: () => setBatchTest((s) => ({ ...s, open: true, results: null })),
    onSuccess: (results) => {
      setBatchTest((s) => ({ ...s, results }));
      invalidate();
    },
    onError: (e) => {
      setBatchTest((s) => ({ ...s, open: false }));
      toastError(e);
    },
  });

  const startBatchTest = (scope: "selected" | "enabled" | "auto_disabled", ids?: number[]) => {
    const names: Record<number, string> = Object.fromEntries((t.items ?? []).map((c) => [c.id, c.name]));
    setBatchTest({ open: true, results: null, names });
    runBatchTest.mutate({ scope, ids });
  };

  const del = async (c: Channel) => {
    if (await confirm({ title: `删除渠道「${c.name}」？`, description: "渠道及其全部 Key 将被永久删除，历史调用日志保留。", danger: true, confirmText: "删除" }))
      remove.mutate(c.id);
  };

  const columns: ColumnDef<Channel, any>[] = [
    {
      header: "ID",
      accessorKey: "id",
      size: 56,
      cell: ({ row }) => <span className="num text-muted-foreground">{row.original.id}</span>,
    },
    {
      header: "名称",
      cell: ({ row }) => {
        const c = row.original;
        return (
          <div className="max-w-[220px] min-w-[140px]">
            <div className="flex items-center gap-1.5">
              <button className="truncate text-left font-medium hover:underline" onClick={() => setEditor({ open: true, channel: c })}>
                {c.name}
              </button>
              {c.tag && (
                <button onClick={() => t.setFilters({ tag: c.tag })} title="按标签筛选">
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
                    {c.tag}
                  </Badge>
                </button>
              )}
            </div>
            {c.remark && <div className="truncate text-xs text-muted-foreground" title={c.remark}>{c.remark}</div>}
          </div>
        );
      },
    },
    {
      header: "类型",
      cell: ({ row }) => <span className="text-xs whitespace-nowrap">{typeLabel[row.original.type] ?? row.original.type}</span>,
    },
    {
      header: "状态",
      cell: ({ row }) => {
        const c = row.original;
        const pending = setStatus.isPending && setStatus.variables?.id === c.id;
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={c.status === 1}
              disabled={pending}
              onCheckedChange={(on) => setStatus.mutate({ id: c.id, on })}
              aria-label="启用/禁用"
            />
            {c.status === 3 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <StatusBadge tone="warning">
                      <AlertTriangle className="size-3" />
                      自动禁用
                    </StatusBadge>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm break-all">
                  {c.status_reason || "无原因"}
                  {c.status_changed_at && <div className="mt-1 opacity-70">{dt(c.status_changed_at)}</div>}
                </TooltipContent>
              </Tooltip>
            ) : c.status === 2 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">{CHANNEL_STATUS["2"].label}</span>
                </TooltipTrigger>
                <TooltipContent>{c.status_reason || "手动禁用"}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        );
      },
    },
    {
      header: "分组",
      cell: ({ row }) => (
        <div className="flex max-w-[160px] flex-wrap gap-1">
          {row.original.groups.map((g) => (
            <Badge key={g} variant="secondary" className="h-5 px-1.5 text-[11px] font-normal" title={g}>
              {groupLabel[g] ?? g}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      header: "模型",
      cell: ({ row }) => <ModelsCell channel={row.original} />,
    },
    {
      header: () => (
        <Tooltip>
          <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">优先级 / 权重</TooltipTrigger>
          <TooltipContent>优先级大者优先；同优先级按权重随机。修改后回车或失焦保存。</TooltipContent>
        </Tooltip>
      ),
      id: "pw",
      cell: ({ row }) => {
        const c = row.original;
        return (
          <div className="flex items-center gap-1">
            <InlineNumber value={c.priority} onCommit={(v) => update.mutate({ id: c.id, body: { priority: v } })} title="优先级" />
            <span className="text-muted-foreground">/</span>
            <InlineNumber value={c.weight} min={0} onCommit={(v) => update.mutate({ id: c.id, body: { weight: v } })} title="权重" />
          </div>
        );
      },
    },
    {
      header: "Key",
      cell: ({ row }) => {
        const c = row.original;
        const tone = c.key_enabled === 0 ? "danger" : c.key_enabled < c.key_total ? "warning" : "success";
        return (
          <button onClick={() => setKeysOf(c)} className="group inline-flex items-center gap-1" title="Key 管理">
            <StatusBadge tone={tone} className="cursor-pointer group-hover:opacity-80">
              <KeyRound className="size-3" />
              <span className="num">
                {c.key_enabled}/{c.key_total}
              </span>
            </StatusBadge>
          </button>
        );
      },
    },
    {
      header: "响应时间",
      cell: ({ row }) => {
        const c = row.original;
        if (!c.tested_at) return <span className="text-xs text-muted-foreground">未测试</span>;
        const v = c.response_time_ms;
        const color = v < 1000 ? "text-success" : v < 3000 ? "text-[oklch(0.55_0.13_70)] dark:text-warning" : "text-destructive";
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="leading-tight">
                <div className={cn("num text-sm font-medium", color)}>{ms(v)}</div>
                <div className="text-[11px] whitespace-nowrap text-muted-foreground">{fromNow(c.tested_at)}</div>
              </div>
            </TooltipTrigger>
            <TooltipContent>测试于 {dt(c.tested_at)}</TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      header: "余额",
      cell: ({ row }) => {
        const c = row.original;
        const pending = balance.isPending && balance.variables === c.id;
        return (
          <div className="flex items-center gap-0.5">
            {c.balance != null ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="num text-sm">
                    {c.balance_currency === "USD" ? "$" : c.balance_currency === "CNY" ? "¥" : ""}
                    {Number(c.balance).toFixed(2)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {c.balance_currency} · 更新于 {fromNow(c.balance_updated_at)}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={pending} onClick={() => balance.mutate(c.id)} title="刷新余额">
              <RefreshCw className={cn(pending && "animate-spin")} />
            </Button>
          </div>
        );
      },
    },
    {
      header: "已用 / 请求",
      cell: ({ row }) => (
        <Link to={`/logs?channel_id=${row.original.id}`} className="block leading-tight hover:underline" title="查看该渠道日志">
          <div className="num text-sm">{money(row.original.used_amount)}</div>
          <div className="num text-[11px] text-muted-foreground">{compact(row.original.request_count)} 次</div>
        </Link>
      ),
    },
    {
      header: () => <div className="text-right">操作</div>,
      id: "actions",
      cell: ({ row }) => {
        const c = row.original;
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <TestButton channel={c} />
            <Button variant="ghost" size="icon-xs" onClick={() => setEditor({ open: true, channel: c })} title="编辑">
              <Pencil />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setKeysOf(c)}>
                  <KeyRound />
                  Key 管理
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copy.mutate(c.id)}>
                  <Copy />
                  复制渠道
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/logs?channel_id=${c.id}`}>
                    <ArrowRight />
                    查看日志
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => del(c)}>
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const ids = selected.map((c) => c.id);
  const f = t.filters;

  return (
    <div>
      <PageHeader
        title="渠道管理"
        description="管理上游供应商渠道、Key 与模型路由。优先级高的渠道优先，失败自动降级重试。"
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={runBatchTest.isPending}>
                  {runBatchTest.isPending ? <Loader2 className="animate-spin" /> : <Zap />}
                  测试渠道
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => startBatchTest("enabled")}>
                  <CheckCircle2 />
                  测试全部启用渠道
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => startBatchTest("auto_disabled")}>
                  <AlertTriangle />
                  测试自动禁用渠道（成功则恢复）
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setEditor({ open: true, channel: null })}>
              <Plus />
              新增渠道
            </Button>
          </>
        }
      />
      <DataTable
        key={selKey}
        columns={columns}
        data={t.items}
        loading={t.isFetching}
        total={t.total}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        rowKey={(r) => r.id}
        selectable
        onSelectionChange={setSelected}
        empty={
          hasFilters(f) ? undefined : (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="text-sm font-medium">还没有渠道</div>
              <div className="text-xs text-muted-foreground">添加一个上游渠道后，用户即可通过本平台调用模型。</div>
              <Button size="sm" className="mt-2" onClick={() => setEditor({ open: true, channel: null })}>
                <Plus />
                新增渠道
              </Button>
            </div>
          )
        }
        toolbar={
          selected.length > 0 ? (
            <BulkBar
              count={selected.length}
              busy={batch.isPending}
              onClear={() => {
                setSelected([]);
                setSelKey((k) => k + 1);
              }}
              onEnable={() => batch.mutate({ ids, action: "enable" })}
              onDisable={() => batch.mutate({ ids, action: "disable" })}
              onTest={() => startBatchTest("selected", ids)}
              onTag={(v) => batch.mutate({ ids, action: "set_tag", value: v })}
              onPriority={(v) => batch.mutate({ ids, action: "set_priority", value: v })}
              onDelete={async () => {
                if (await confirm({ title: `删除选中的 ${ids.length} 个渠道？`, description: "渠道及其 Key 将被永久删除。", danger: true, confirmText: "删除" }))
                  batch.mutate({ ids, action: "delete" });
              }}
              tags={tags.data ?? []}
            />
          ) : (
            <>
              <SearchInput value={f.keyword} onChange={(v) => t.setFilters({ keyword: v })} placeholder="名称 / 备注 / 地址" />
              <FilterSelect
                value={f.status}
                onChange={(v) => t.setFilters({ status: v })}
                placeholder="状态"
                className="w-28"
                options={Object.entries(CHANNEL_STATUS).map(([k, v]) => ({ value: k, label: v.label }))}
              />
              <FilterSelect
                value={f.type}
                onChange={(v) => t.setFilters({ type: v })}
                placeholder="类型"
                options={(types.data ?? []).map((x) => ({ value: x.value, label: x.label }))}
              />
              <FilterSelect
                value={f.group}
                onChange={(v) => t.setFilters({ group: v })}
                placeholder="分组"
                className="w-28"
                options={(groups.data ?? []).map((g) => ({ value: g.name, label: g.display_name }))}
              />
              {(tags.data?.length ?? 0) > 0 && (
                <FilterSelect
                  value={f.tag}
                  onChange={(v) => t.setFilters({ tag: v })}
                  placeholder="标签"
                  className="w-28"
                  options={(tags.data ?? []).map((x) => ({ value: x, label: x }))}
                />
              )}
              <FilterSelect
                value={f.model}
                onChange={(v) => t.setFilters({ model: v })}
                placeholder="模型"
                className="w-40"
                options={(models.data ?? []).map((m) => ({ value: m.name, label: m.name }))}
              />
              <FilterSelect
                value={f.sort}
                onChange={(v) => t.setFilters({ sort: v })}
                placeholder="排序"
                allLabel="按优先级"
                className="w-32"
                options={[
                  { value: "id", label: "按 ID" },
                  { value: "response_time", label: "按响应时间" },
                  { value: "used", label: "按已用金额" },
                ]}
              />
              <ResetButton show={hasFilters(f)} onClick={t.resetFilters} />
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="icon-sm" onClick={() => t.refetch()} title="刷新">
                  <RefreshCw className={cn(t.isFetching && "animate-spin")} />
                </Button>
              </div>
            </>
          )
        }
        className="[&_td]:align-middle"
      />

      <ChannelEditor open={editor.open} channel={editor.channel} onOpenChange={(o) => setEditor((s) => ({ ...s, open: o }))} />
      <KeyManager channel={keysOf} onOpenChange={(o) => !o && setKeysOf(null)} />
      <BatchTestDialog
        open={batchTest.open}
        onOpenChange={(o) => setBatchTest((s) => ({ ...s, open: o }))}
        loading={runBatchTest.isPending}
        results={batchTest.results}
        names={batchTest.names}
      />
    </div>
  );
}

/** 模型数 + 弹出列表（含映射） */
function ModelsCell({ channel }: { channel: Channel }) {
  const mapping = channel.model_mapping ?? {};
  const mapped = Object.keys(mapping).length;
  if (!channel.models.length) return <span className="text-xs text-destructive">未配置</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm hover:bg-muted">
          <span className="num font-medium">{channel.models.length}</span>
          <span className="text-xs text-muted-foreground">个</span>
          {mapped > 0 && (
            <Badge variant="outline" className="ml-0.5 h-4 px-1 text-[10px] font-normal text-muted-foreground">
              映射 {mapped}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          共 {channel.models.length} 个模型{channel.test_model && <>，测试模型 <span className="font-mono">{channel.test_model}</span></>}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {channel.models.map((m) => (
            <div key={m} className="flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xs hover:bg-muted">
              <span className="truncate">{m}</span>
              {mapping[m] && (
                <>
                  <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-muted-foreground">{mapping[m]}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 行内数字编辑：回车或失焦提交 */
function InlineNumber({ value, onCommit, min, title }: { value: number; onCommit: (v: number) => void; min?: number; title?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() === "" || !Number.isInteger(n) || (min != null && n < min)) {
      toast.error(`${title ?? "数值"}需为${min != null ? "非负" : ""}整数`);
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <Input
      type="number"
      title={title}
      value={draft ?? String(value)}
      min={min}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className="num h-7 w-14 px-1.5 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}

/** 选中后的批量操作条 */
function BulkBar({
  count, busy, onClear, onEnable, onDisable, onDelete, onTest, onTag, onPriority, tags,
}: {
  count: number;
  busy: boolean;
  onClear: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onTest: () => void;
  onTag: (v: string) => void;
  onPriority: (v: number) => void;
  tags: string[];
}) {
  const [tag, setTag] = useState("");
  const [prio, setPrio] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);
  return (
    <div className="flex h-8 w-full flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3">
      <span className="text-sm">
        已选 <b className="num">{count}</b> 个渠道
      </span>
      <Button variant="link" size="xs" className="text-muted-foreground" onClick={onClear}>
        取消选择
      </Button>
      <div className="ml-auto flex items-center gap-1">
        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <Button variant="ghost" size="xs" onClick={onEnable} disabled={busy}>
          <CheckCircle2 />
          启用
        </Button>
        <Button variant="ghost" size="xs" onClick={onDisable} disabled={busy}>
          <Ban />
          禁用
        </Button>
        <Button variant="ghost" size="xs" onClick={onTest} disabled={busy}>
          <Zap />
          批量测试
        </Button>
        <Popover open={tagOpen} onOpenChange={setTagOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" disabled={busy}>
              <Tag />
              设置标签
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2" align="end">
            <div className="text-sm font-medium">设置标签</div>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="留空则清除标签" list="bulk-tag-options" className="h-8" />
            <datalist id="bulk-tag-options">
              {tags.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                onTag(tag.trim());
                setTagOpen(false);
              }}
            >
              应用到 {count} 个渠道
            </Button>
          </PopoverContent>
        </Popover>
        <Popover open={prioOpen} onOpenChange={setPrioOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" disabled={busy}>
              设置优先级
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 space-y-2" align="end">
            <div className="text-sm font-medium">设置优先级</div>
            <Input type="number" value={prio} onChange={(e) => setPrio(e.target.value)} placeholder="整数，越大越优先" className="num h-8" />
            <Button
              size="sm"
              className="w-full"
              disabled={!Number.isInteger(Number(prio)) || prio.trim() === ""}
              onClick={() => {
                onPriority(Number(prio));
                setPrioOpen(false);
              }}
            >
              应用
            </Button>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={onDelete} disabled={busy}>
          <Trash2 />
          删除
        </Button>
      </div>
    </div>
  );
}

