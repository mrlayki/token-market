import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, BadgeDollarSign, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable } from "@/components/data-table";
import { confirm, Mono, StatusBadge, VendorIcon } from "@/components/misc";
import { PageHeader } from "@/components/page";
import { useTableQuery } from "@/hooks/use-table-query";
import { api, toastError } from "@/lib/api";
import { compact } from "@/lib/format";
import { FilterSelect, hasFilters, ResetButton, SearchInput } from "../components/filters";
import { SubmitButton } from "../components/form";
import { PendingPriceBadge, PriceSummary } from "../components/pricing-summary";
import { MODEL_MODE } from "../lib/labels";
import { useVendors } from "../lib/queries";
import type { ModelMeta } from "../lib/types";
import { invalidateModels, ModelEditor, toModelIn } from "./models/model-editor";
import { VendorsTab } from "./models/vendors-tab";

const ENDPOINT_SHORT: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", embeddings: "Embeddings" };

// ---------------------------------------------------------------- 缺失模型提示
function MissingBanner() {
  const qc = useQueryClient();
  const vendors = useVendors();
  const [vendorId, setVendorId] = useState<string>("");
  const missing = useQuery({
    queryKey: ["admin", "models-missing"],
    queryFn: () => api.get<{ no_meta: string[]; no_price: string[] }>("/api/admin/models/missing"),
  });
  const batch = useMutation({
    mutationFn: (names: string[]) =>
      api.post<{ message: string }>("/api/admin/models/batch", { names, vendor_id: vendorId ? Number(vendorId) : null, mode: "chat" }),
    onSuccess: (r) => {
      toast.success(r.message || "已创建");
      invalidateModels(qc);
    },
    onError: toastError,
  });
  const noMeta = missing.data?.no_meta ?? [];
  const noPrice = missing.data?.no_price ?? [];
  if (!noMeta.length && !noPrice.length) return null;
  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-2">
      {noMeta.length > 0 && (
        <Alert className="border-warning/40 bg-warning/5">
          <AlertTriangle className="text-warning" />
          <AlertTitle>{noMeta.length} 个渠道模型尚未建立模型元数据</AlertTitle>
          <AlertDescription className="space-y-2.5">
            <p>这些模型已在渠道中配置，但不会出现在模型广场，也无法定价。</p>
            <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
              {noMeta.map((n) => (
                <Badge key={n} variant="secondary" className="font-mono text-[11px] font-normal">
                  {n}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={vendorId || "__none__"} onValueChange={(v) => setVendorId(v === "__none__" ? "" : v)}>
                <SelectTrigger size="sm" className="w-40 bg-background">
                  <SelectValue placeholder="归属供应商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不指定供应商</SelectItem>
                  {vendors.data?.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SubmitButton size="sm" loading={batch.isPending} onClick={() => batch.mutate(noMeta)}>
                <Sparkles />
                批量创建 {noMeta.length} 个模型
              </SubmitButton>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {noPrice.length > 0 && (
        <Alert className="border-destructive/30 bg-destructive/5">
          <BadgeDollarSign className="text-destructive" />
          <AlertTitle>{noPrice.length} 个渠道模型尚未定价</AlertTitle>
          <AlertDescription className="space-y-2.5">
            <p>未定价的模型调用会被拒绝，请尽快设置价格。</p>
            <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
              {noPrice.map((n) => (
                <Link key={n} to={`/pricing?keyword=${encodeURIComponent(n)}`}>
                  <Badge variant="secondary" className="font-mono text-[11px] font-normal hover:bg-accent">
                    {n}
                  </Badge>
                </Link>
              ))}
            </div>
            <Button size="sm" variant="outline" asChild>
              <Link to="/pricing?priced=false">前往模型计费</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 模型列表
function ModelsTab({ onEdit }: { onEdit: (m: ModelMeta) => void }) {
  const qc = useQueryClient();
  const vendors = useVendors();
  const t = useTableQuery<ModelMeta>("/api/admin/models", { keyword: "", vendor_id: "", listed: "", priced: "" });
  const vendorById = new Map((vendors.data ?? []).map((v) => [v.id, v]));

  const toggleListed = useMutation({
    mutationFn: (m: ModelMeta) => api.put(`/api/admin/models/${m.id}`, { ...toModelIn(m), listed: !m.listed }),
    onSuccess: (_, m) => {
      toast.success(m.listed ? `已下架 ${m.name}` : `已上架 ${m.name}`);
      invalidateModels(qc);
    },
    onError: toastError,
  });
  const del = useMutation({
    mutationFn: (m: ModelMeta) => api.del(`/api/admin/models/${m.id}`),
    onSuccess: () => {
      toast.success("模型已删除");
      invalidateModels(qc);
    },
    onError: toastError,
  });

  const columns: ColumnDef<ModelMeta>[] = [
    {
      header: "模型",
      cell: ({ row: { original: m } }) => {
        const v = m.vendor_id ? vendorById.get(m.vendor_id) : undefined;
        return (
          <div className="flex min-w-56 items-center gap-2.5">
            <VendorIcon vendor={v?.name ?? m.name} icon={m.icon || v?.icon} size={30} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Mono className="text-[13px] font-medium">{m.name}</Mono>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {m.display_name && m.display_name !== m.name && <span>{m.display_name}</span>}
                {m.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      header: "供应商",
      cell: ({ row: { original: m } }) => {
        const v = m.vendor_id ? vendorById.get(m.vendor_id) : undefined;
        return v ? <span className="text-sm">{v.display_name}</span> : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      header: "类型 / 端点",
      cell: ({ row: { original: m } }) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge tone="muted">{MODEL_MODE[m.mode] ?? m.mode}</StatusBadge>
          {m.endpoints.map((e) => (
            <Badge key={e} variant="outline" className="text-[11px] font-normal">
              {ENDPOINT_SHORT[e] ?? e}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      header: "上下文 / 输出",
      cell: ({ row: { original: m } }) => (
        <span className="num text-xs whitespace-nowrap">
          {m.context_length ? compact(m.context_length) : "-"}
          <span className="text-muted-foreground"> / </span>
          {m.max_output_tokens ? compact(m.max_output_tokens) : "-"}
        </span>
      ),
    },
    {
      header: "价格（元 / 百万 token）",
      cell: ({ row: { original: m } }) => (
        <div className="flex flex-col items-start gap-1">
          <Link to={`/pricing?keyword=${encodeURIComponent(m.name)}`} className="hover:opacity-80">
            <PriceSummary price={m.price} />
          </Link>
          <PendingPriceBadge price={m.pending_price} />
        </div>
      ),
    },
    {
      header: "提供渠道",
      cell: ({ row: { original: m } }) =>
        m.channels.length ? (
          <div className="flex max-w-[260px] flex-wrap gap-1">
            {m.channels.map((c) => (
              <Tooltip key={c.id}>
                <TooltipTrigger asChild>
                  <Link to={`/channels?keyword=${encodeURIComponent(c.name)}`}>
                    <StatusBadge tone={c.status === 1 ? "success" : c.status === 3 ? "danger" : "muted"} dot>
                      {c.name}
                    </StatusBadge>
                  </Link>
                </TooltipTrigger>
                <TooltipContent className="text-xs leading-relaxed">
                  <div>渠道 #{c.id}（{c.status === 1 ? "启用" : c.status === 3 ? "自动禁用" : "手动禁用"}）</div>
                  <div>优先级 {c.priority} · 权重 {c.weight}</div>
                  <div>分组 {c.groups.join(", ")}</div>
                  {c.upstream_model !== m.name && <div>上游模型名 {c.upstream_model}</div>}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <StatusBadge tone="warning">无可用渠道</StatusBadge>
              </span>
            </TooltipTrigger>
            <TooltipContent>还没有渠道提供这个模型，用户调用会失败。到「渠道管理」编辑渠道，把它加入模型列表。</TooltipContent>
          </Tooltip>
        ),
    },
    {
      header: "上架",
      cell: ({ row: { original: m } }) => (
        <Switch
          checked={m.listed}
          disabled={toggleListed.isPending && toggleListed.variables?.id === m.id}
          onCheckedChange={() => toggleListed.mutate(m)}
        />
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-right">操作</div>,
      cell: ({ row: { original: m } }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => onEdit(m)}>
            <Pencil />
            编辑
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/pricing?keyword=${encodeURIComponent(m.name)}`}>
                  <BadgeDollarSign />
                  设置价格
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `删除模型 ${m.name}？`,
                      description: "仅删除模型元数据，价格历史与渠道配置不受影响。删除后该模型不会出现在模型广场。",
                      danger: true,
                      confirmText: "删除",
                    })
                  )
                    del.mutate(m);
                }}
              >
                <Trash2 />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
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
      rowKey={(m) => m.id}
      toolbar={
        <>
          <SearchInput value={t.filters.keyword} onChange={(v) => t.setFilters({ keyword: v })} placeholder="模型名 / 显示名称" />
          <FilterSelect
            value={t.filters.vendor_id}
            onChange={(v) => t.setFilters({ vendor_id: v })}
            placeholder="供应商"
            options={(vendors.data ?? []).map((v) => ({ value: String(v.id), label: v.display_name }))}
          />
          <FilterSelect
            value={t.filters.listed}
            onChange={(v) => t.setFilters({ listed: v })}
            placeholder="上架状态"
            allLabel="全部状态"
            options={[
              { value: "true", label: "已上架" },
              { value: "false", label: "已下架" },
            ]}
          />
          <FilterSelect
            value={t.filters.priced}
            onChange={(v) => t.setFilters({ priced: v })}
            placeholder="定价"
            allLabel="全部定价"
            options={[
              { value: "true", label: "已定价" },
              { value: "false", label: "未定价" },
            ]}
          />
          <ResetButton show={hasFilters(t.filters)} onClick={t.resetFilters} />
        </>
      }
    />
  );
}

export default function ModelsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "vendors" ? "vendors" : "models";
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ModelMeta | null>(null);
  const [creatingVendor, setCreatingVendor] = useState(false);

  return (
    <>
      <PageHeader
        title="模型管理"
        description="维护对外提供的模型元数据与供应商；渠道中配置但未建档的模型会在此提示。"
        actions={
          tab === "models" ? (
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus />
              新增模型
            </Button>
          ) : (
            <Button onClick={() => setCreatingVendor(true)}>
              <Plus />
              新增供应商
            </Button>
          )
        }
      />
      {tab === "models" && <RoutingExplainer />}
      <Tabs value={tab} onValueChange={(v) => setSp(v === "vendors" ? { tab: "vendors" } : {}, { replace: true })} className="gap-4">
        <TabsList>
          <TabsTrigger value="models">模型</TabsTrigger>
          <TabsTrigger value="vendors">供应商</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-4">
        {tab === "models" ? (
          <>
            <MissingBanner />
            <ModelsTab
              onEdit={(m) => {
                setEditing(m);
                setEditorOpen(true);
              }}
            />
          </>
        ) : (
          <VendorsTab creating={creatingVendor} onCreatingChange={setCreatingVendor} />
        )}
      </div>
      <ModelEditor open={editorOpen} onOpenChange={setEditorOpen} model={editing} />
    </>
  );
}

/** 说明「模型、价格、渠道」三者的关系：三者齐备，模型才能被调用并出现在模型广场 */
function RoutingExplainer() {
  const steps = [
    { title: "模型管理", desc: "对外售卖的模型名（用户请求里的 model），以及介绍、上下文长度、是否上架" },
    { title: "模型计费", desc: "该模型的售价：输入 / 输出 / 缓存，按版本生效" },
    { title: "渠道管理", desc: "真正提供这个模型的上游（厂商地址 + Key）。一个模型可由多个渠道提供，按优先级与权重选择、失败自动切换" },
  ];
  return (
    <div className="mb-4 rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm font-medium">一个模型要能被调用，三项缺一不可</div>
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map((st, i) => (
          <div key={st.title} className="flex gap-3">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {i + 1}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{st.title}</div>
              <div className="text-xs leading-relaxed text-muted-foreground">{st.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        调用时：请求的 model + 用户分组 → 找到「模型列表包含它、分组匹配、状态启用」的渠道 → 最高优先级中按权重随机选一个；渠道可通过「模型映射」把对外名称改写成上游的真实模型名。
      </p>
    </div>
  );
}
