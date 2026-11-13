import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Info, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { CopyButton, Mono, StatusBadge, confirm, copyText } from "@/components/misc";
import { Empty, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, toastError } from "@/lib/api";
import { dayjs, dt, fromNow, money, yuanToMicro } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ApiToken, ApiTokenCreated } from "@/api/types";
import { useTableQuery } from "@/hooks/use-table-query";
import { CodeTabs } from "../components/code-block";
import { ModelMultiSelect } from "../components/model-multi-select";
import { claudeCodeEnv, curlOpenAI, pythonOpenAI } from "../components/snippets";
import { ratioText, useBaseUrl, useMarketplace, useMyGroups } from "../lib/data";

const URL = "/api/console/tokens";

export default function TokensPage() {
  const t = useTableQuery<ApiToken, { keyword: string }>(URL, { keyword: "" });
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [kw, setKw] = useState(t.filters.keyword);
  const [editing, setEditing] = useState<ApiToken | null | undefined>(undefined); // undefined 关闭；null 新建
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);

  useEffect(() => {
    if (sp.get("create") === "1") {
      setEditing(null);
      setSp(
        (p) => {
          p.delete("create");
          return p;
        },
        { replace: true },
      );
    }
  }, [sp, setSp]);

  useEffect(() => {
    const h = setTimeout(() => kw !== t.filters.keyword && t.setFilters({ keyword: kw }), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kw]);

  const refresh = () => qc.invalidateQueries({ queryKey: [URL] });

  const toggle = useMutation({
    mutationFn: (r: ApiToken) => api.post<ApiToken>(`${URL}/${r.id}/status`, { status: r.status === 1 ? 2 : 1 }),
    onSuccess: (r) => {
      toast.success(r.status === 1 ? "已启用" : "已禁用");
      refresh();
    },
    onError: toastError,
  });

  async function remove(r: ApiToken) {
    const ok = await confirm({
      title: `删除 API Key「${r.name}」？`,
      description: "删除后使用该 Key 的请求将立即失败，且无法恢复。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`${URL}/${r.id}`);
      toast.success("已删除");
      refresh();
    } catch (e) {
      toastError(e);
    }
  }

  const columns: ColumnDef<ApiToken>[] = [
    {
      header: "名称",
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-1.5 font-medium">
          {r.name}
          {r.key_mask.startsWith("sk-pg") && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
              系统
            </Badge>
          )}
        </div>
      ),
    },
    {
      header: "Key",
      cell: ({ row: { original: r } }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help items-center gap-1 rounded bg-muted px-1.5 py-0.5">
              <Mono>{r.key_mask}</Mono>
            </span>
          </TooltipTrigger>
          <TooltipContent>完整 Key 仅在创建时显示一次</TooltipContent>
        </Tooltip>
      ),
    },
    {
      header: "状态",
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-2">
          <Switch checked={r.status === 1} disabled={toggle.isPending && toggle.variables?.id === r.id} onCheckedChange={() => toggle.mutate(r)} onClick={(e) => e.stopPropagation()} aria-label="启用/禁用" />
          {r.status === 3 && <StatusBadge tone="warning">已过期</StatusBadge>}
          {r.status === 4 && <StatusBadge tone="danger">额度耗尽</StatusBadge>}
        </div>
      ),
    },
    {
      header: "额度",
      cell: ({ row: { original: r } }) =>
        r.unlimited ? (
          <div className="text-sm">
            <span className="text-muted-foreground">不限额</span>
            <div className="num text-xs text-muted-foreground">已用 {money(r.used_quota)}</div>
          </div>
        ) : (
          <div className="w-36 space-y-1">
            <div className="num text-xs">
              {money(r.used_quota)} <span className="text-muted-foreground">/ {money(r.quota_limit)}</span>
            </div>
            <Progress value={r.quota_limit ? Math.min(100, (r.used_quota / r.quota_limit) * 100) : 100} className="h-1.5" />
          </div>
        ),
    },
    {
      header: "分组",
      cell: ({ row: { original: r } }) => (r.group ? <Badge variant="secondary" className="font-normal">{r.group}</Badge> : <span className="text-xs text-muted-foreground">跟随账户</span>),
    },
    {
      header: "模型限制",
      cell: ({ row: { original: r } }) =>
        r.model_limits.length ? (
          <Popover>
            <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button type="button" className="text-sm text-primary hover:underline">
                {r.model_limits.length} 个模型
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <div className="mb-2 text-xs text-muted-foreground">仅允许调用以下模型</div>
              <div className="flex flex-wrap gap-1">
                {r.model_limits.map((m) => (
                  <Badge key={m} variant="secondary" className="font-mono text-[11px] font-normal">
                    {m}
                  </Badge>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-xs text-muted-foreground">全部模型</span>
        ),
    },
    {
      header: "IP 白名单",
      cell: ({ row: { original: r } }) =>
        r.allow_ips.length ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-sm">{r.allow_ips.length} 条</span>
            </TooltipTrigger>
            <TooltipContent className="font-mono text-xs whitespace-pre">{r.allow_ips.join("\n")}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-xs text-muted-foreground">不限</span>
        ),
    },
    {
      header: "过期时间",
      cell: ({ row: { original: r } }) => {
        if (!r.expired_at) return <span className="text-xs text-muted-foreground">永不过期</span>;
        const exp = dayjs(r.expired_at).isBefore(dayjs());
        return exp ? (
          <StatusBadge tone="warning">已过期</StatusBadge>
        ) : (
          <span className="text-xs whitespace-nowrap" title={dt(r.expired_at)}>
            {dt(r.expired_at, "YYYY-MM-DD HH:mm")}
          </span>
        );
      },
    },
    {
      header: "最近使用",
      cell: ({ row: { original: r } }) => <span className="text-xs whitespace-nowrap text-muted-foreground" title={dt(r.accessed_at)}>{r.accessed_at ? fromNow(r.accessed_at) : "从未使用"}</span>,
    },
    {
      header: "创建时间",
      cell: ({ row: { original: r } }) => <span className="text-xs whitespace-nowrap text-muted-foreground">{dt(r.created_at, "YYYY-MM-DD HH:mm")}</span>,
    },
    {
      id: "actions",
      size: 48,
      cell: ({ row: { original: r } }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditing(r)}>
              <Pencil /> 编辑
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => remove(r)}>
              <Trash2 /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="API Key"
        description="为不同应用创建独立的 Key，可分别设置额度、模型白名单、IP 白名单与限流"
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus /> 创建 API Key
          </Button>
        }
      />
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
          <div className="relative w-full max-w-xs">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索名称" className="h-9 pl-8" />
          </div>
        }
        empty={
          t.filters.keyword ? (
            <Empty title="没有匹配的 API Key" />
          ) : (
            <Empty
              title="还没有 API Key"
              description="创建一个 Key，即可通过 OpenAI / Anthropic 兼容接口调用全部模型"
              action={
                <Button size="sm" onClick={() => setEditing(null)}>
                  <Plus /> 创建 API Key
                </Button>
              }
            />
          )
        }
      />

      <TokenFormDialog
        token={editing}
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
        onSaved={(r) => {
          setEditing(undefined);
          refresh();
          if ("key" in r) setCreated(r as ApiTokenCreated);
          else toast.success("已保存");
        }}
      />
      <KeyCreatedDialog token={created} onClose={() => setCreated(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- 表单
type ExpirePreset = "never" | "7" | "30" | "90" | "custom";

interface FormState {
  name: string;
  preset: ExpirePreset;
  customExpire: string; // datetime-local
  unlimited: boolean;
  quotaYuan: string;
  model_limits: string[];
  ips: string;
  group: string;
  rpm: string;
}

function initForm(t: ApiToken | null): FormState {
  if (!t) return { name: "", preset: "never", customExpire: "", unlimited: true, quotaYuan: "", model_limits: [], ips: "", group: "", rpm: "0" };
  return {
    name: t.name,
    preset: t.expired_at ? "custom" : "never",
    customExpire: t.expired_at ? dayjs(t.expired_at).format("YYYY-MM-DDTHH:mm") : "",
    unlimited: t.unlimited,
    quotaYuan: t.unlimited ? "" : String(t.quota_limit / 1_000_000),
    model_limits: t.model_limits,
    ips: t.allow_ips.join("\n"),
    group: t.group,
    rpm: String(t.rpm_limit),
  };
}

function TokenFormDialog({ token, open, onOpenChange, onSaved }: { token: ApiToken | null | undefined; open: boolean; onOpenChange: (o: boolean) => void; onSaved: (r: ApiToken | ApiTokenCreated) => void }) {
  const [f, setF] = useState<FormState>(() => initForm(token ?? null));
  const [err, setErr] = useState("");
  const myGroups = useMyGroups();
  const isEdit = !!token;

  useEffect(() => {
    if (open) {
      setF(initForm(token ?? null));
      setErr("");
    }
  }, [open, token]);

  const save = useMutation({
    mutationFn: (body: unknown) => (isEdit ? api.put<ApiToken>(`${URL}/${token!.id}`, body) : api.post<ApiTokenCreated>(URL, body)),
    onSuccess: onSaved,
    onError: toastError,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (!f.name.trim()) return setErr("请输入名称");
    let expired_at: string | null = null;
    if (f.preset === "custom") {
      if (!f.customExpire) return setErr("请选择过期时间");
      expired_at = dayjs(f.customExpire).toISOString();
    } else if (f.preset !== "never") {
      expired_at = dayjs().add(Number(f.preset), "day").toISOString();
    }
    if (!f.unlimited && !(Number(f.quotaYuan) > 0)) return setErr("请输入大于 0 的额度");
    const ips = f.ips
      .split(/[\n,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bad = ips.find((ip) => !/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(ip));
    if (bad) return setErr(`IP 格式不正确：${bad}`);
    const rpm = Number(f.rpm || 0);
    if (!Number.isInteger(rpm) || rpm < 0) return setErr("RPM 限制需为非负整数");
    save.mutate({
      name: f.name.trim(),
      expired_at,
      unlimited: f.unlimited,
      quota_limit: f.unlimited ? 0 : yuanToMicro(f.quotaYuan),
      model_limits: f.model_limits,
      allow_ips: ips,
      group: f.group,
      rpm_limit: rpm,
    });
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑 API Key" : "创建 API Key"}</DialogTitle>
          <DialogDescription>{isEdit ? "修改后立即生效" : "创建后完整 Key 仅显示一次，请妥善保存"}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="tk-name">名称</Label>
            <Input id="tk-name" value={f.name} maxLength={64} onChange={(e) => set("name", e.target.value)} placeholder="例如：生产环境 / 测试脚本" autoFocus />
          </div>

          <div className="grid gap-2">
            <Label>过期时间</Label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["never", "永不过期"],
                  ["7", "7 天"],
                  ["30", "30 天"],
                  ["90", "90 天"],
                  ["custom", "自定义"],
                ] as [ExpirePreset, string][]
              ).map(([v, l]) => (
                <Button key={v} type="button" size="sm" variant={f.preset === v ? "default" : "outline"} onClick={() => set("preset", v)}>
                  {l}
                </Button>
              ))}
            </div>
            {f.preset === "custom" && <Input type="datetime-local" value={f.customExpire} onChange={(e) => set("customExpire", e.target.value)} min={dayjs().format("YYYY-MM-DDTHH:mm")} />}
            {f.preset !== "never" && f.preset !== "custom" && (
              <p className="text-xs text-muted-foreground">将于 {dayjs().add(Number(f.preset), "day").format("YYYY-MM-DD HH:mm")} 过期</p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>额度上限</Label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={f.unlimited} onCheckedChange={(v) => set("unlimited", v)} /> 不限额
              </label>
            </div>
            {f.unlimited ? (
              <p className="text-xs text-muted-foreground">该 Key 可使用账户全部余额与套餐</p>
            ) : (
              <div className="relative">
                <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">¥</span>
                <Input type="number" min={0} step="0.01" value={f.quotaYuan} onChange={(e) => set("quotaYuan", e.target.value)} className="pl-7" placeholder="该 Key 最多可消费的金额（元）" />
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label>模型白名单</Label>
            <ModelMultiSelect value={f.model_limits} onChange={(v) => set("model_limits", v)} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tk-ips">IP 白名单</Label>
            <Textarea id="tk-ips" rows={3} value={f.ips} onChange={(e) => set("ips", e.target.value)} placeholder={"每行一个，支持 CIDR，例如\n203.0.113.10\n10.0.0.0/8"} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">留空表示不限制来源 IP</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>使用分组</Label>
              <Select value={f.group || "__inherit"} onValueChange={(v) => set("group", v === "__inherit" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__inherit">跟随账户分组</SelectItem>
                  {(myGroups.data ?? []).filter((g) => !g.is_default).map((g) => (
                    <SelectItem key={g.name} value={g.name}>
                      {g.display_name} <span className="text-muted-foreground">{ratioText(g.price_ratio)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tk-rpm">RPM 限制</Label>
              <Input id="tk-rpm" type="number" min={0} step={1} value={f.rpm} onChange={(e) => set("rpm", e.target.value)} />
            </div>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">非账户所在分组需获得授权方可使用；RPM 为每分钟最大请求数，0 表示不限制。</p>

          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {isEdit ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 创建成功
function KeyCreatedDialog({ token, onClose }: { token: ApiTokenCreated | null; onClose: () => void }) {
  const base = useBaseUrl();
  const mk = useMarketplace();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [token]);
  if (!token) return null;
  const model = token.model_limits[0] ?? mk.data?.models[0]?.name ?? "gpt-4o-mini";
  return (
    <Dialog
      open={!!token}
      onOpenChange={async (o) => {
        if (o) return;
        if (!copied && !(await confirm({ title: "确认已保存 API Key？", description: "关闭后将无法再次查看完整 Key。", confirmText: "已保存，关闭" }))) return;
        onClose();
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-success" /> API Key 创建成功
          </DialogTitle>
          <DialogDescription>「{token.name}」已创建，可立即使用。</DialogDescription>
        </DialogHeader>
        <Alert className="border-warning/40 bg-warning/10">
          <AlertTriangle className="text-[oklch(0.55_0.13_70)] dark:text-warning" />
          <AlertTitle>仅显示一次</AlertTitle>
          <AlertDescription>请立即复制并妥善保存。关闭此窗口后将无法再次查看完整 Key，如遗失只能删除后重新创建。</AlertDescription>
        </Alert>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 pl-3">
          <code className="min-w-0 flex-1 font-mono text-sm break-all">{token.key}</code>
          <Button
            size="sm"
            onClick={async () => {
              await copyText(token.key, "API Key 已复制");
              setCopied(true);
            }}
          >
            {copied ? "已复制" : "复制"}
          </Button>
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Info className="size-4 text-muted-foreground" /> 使用示例
          </div>
          <CodeTabs
            tabs={[
              { key: "curl", label: "cURL", code: curlOpenAI(base, model, token.key) },
              { key: "py", label: "Python", code: pythonOpenAI(base, model, token.key) },
              { key: "cc", label: "Claude Code", code: claudeCodeEnv(base, token.key) },
            ]}
          />
        </div>
        <DialogFooter>
          <div className={cn("mr-auto flex items-center gap-1 text-xs text-muted-foreground")}>
            Base URL <Mono>{base}/v1</Mono>
            <CopyButton text={`${base}/v1`} className="size-6" />
          </div>
          <Button
            onClick={async () => {
              if (!copied && !(await confirm({ title: "确认已保存 API Key？", description: "关闭后将无法再次查看完整 Key。", confirmText: "已保存，关闭" }))) return;
              onClose();
            }}
          >
            我已保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
