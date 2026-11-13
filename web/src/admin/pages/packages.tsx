import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { PackageProduct } from "@/api/types";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/misc";
import { PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, toastError } from "@/lib/api";
import { compact, money, num } from "@/lib/format";
import { AffixInput, Field, FormSection, SubmitButton, toNum, yuanStr } from "../components/form";
import { MultiSelect } from "../components/tag-input";
import { SCOPE_TYPE } from "../lib/labels";
import { qk, useAllModels, useProducts, useVendors } from "../lib/queries";

type Scope = PackageProduct["scope_type"];

interface FormState {
  name: string;
  description: string;
  price: string;
  original_price: string;
  tokens: string;
  scope_type: Scope;
  scope_values: string[];
  input_weight: string;
  output_weight: string;
  valid_days: string;
  limit_per_user: string;
  on_sale: boolean;
  badge: string;
  sort: string;
}

const emptyForm: FormState = {
  name: "",
  description: "",
  price: "",
  original_price: "",
  tokens: "",
  scope_type: "models",
  scope_values: [],
  input_weight: "1",
  output_weight: "1",
  valid_days: "30",
  limit_per_user: "0",
  on_sale: true,
  badge: "",
  sort: "0",
};

function toBody(p: PackageProduct) {
  return {
    name: p.name,
    description: p.description,
    price: p.price,
    original_price: p.original_price,
    tokens: p.tokens,
    scope_type: p.scope_type,
    scope_values: p.scope_values,
    input_weight: p.input_weight,
    output_weight: p.output_weight,
    valid_days: p.valid_days,
    limit_per_user: p.limit_per_user,
    on_sale: p.on_sale,
    badge: p.badge,
    sort: p.sort,
  };
}

/** 元 / 百万 token */
function unitPrice(priceMicro: number, tokens: number): string {
  if (!tokens) return "-";
  const y = priceMicro / 1_000_000 / (tokens / 1_000_000);
  return `¥${y < 0.1 ? y.toFixed(4) : y.toFixed(2)}`;
}

const TOKEN_PRESETS = [1e6, 5e6, 10e6, 50e6, 100e6, 1e9];

function ProductDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: PackageProduct | null }) {
  const qc = useQueryClient();
  const models = useAllModels();
  const vendors = useVendors();
  const [f, setF] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = open ? `${editing?.id ?? "new"}-${editing?.name ?? ""}` : null;
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setErrors({});
      setF(
        editing
          ? {
              name: editing.name,
              description: editing.description,
              price: yuanStr(editing.price),
              original_price: editing.original_price ? yuanStr(editing.original_price) : "",
              tokens: String(editing.tokens),
              scope_type: editing.scope_type,
              scope_values: editing.scope_values,
              input_weight: String(Number(editing.input_weight)),
              output_weight: String(Number(editing.output_weight)),
              valid_days: String(editing.valid_days),
              limit_per_user: String(editing.limit_per_user),
              on_sale: editing.on_sale,
              badge: editing.badge,
              sort: String(editing.sort),
            }
          : emptyForm,
      );
    }
  }
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const isEdit = !!editing && editing.id > 0;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        description: f.description,
        price: Math.round(toNum(f.price) * 1_000_000),
        original_price: Math.round(toNum(f.original_price) * 1_000_000),
        tokens: Math.round(toNum(f.tokens)),
        scope_type: f.scope_type,
        scope_values: f.scope_type === "all" ? [] : f.scope_values,
        input_weight: f.input_weight,
        output_weight: f.output_weight,
        valid_days: Math.round(toNum(f.valid_days, 30)),
        limit_per_user: Math.round(toNum(f.limit_per_user)),
        on_sale: f.on_sale,
        badge: f.badge.trim(),
        sort: Math.round(toNum(f.sort)),
      };
      return isEdit ? api.put<PackageProduct>(`/api/admin/package-products/${editing!.id}`, body) : api.post<PackageProduct>("/api/admin/package-products", body);
    },
    onSuccess: () => {
      toast.success(isEdit ? "套餐已更新" : "套餐已创建");
      qc.invalidateQueries({ queryKey: qk.products });
      onOpenChange(false);
    },
    onError: toastError,
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "请填写名称";
    if (f.price.trim() === "" || toNum(f.price, -1) < 0) e.price = "请填写售价";
    if (toNum(f.tokens) <= 0) e.tokens = "Token 数量需大于 0";
    if (f.scope_type !== "all" && f.scope_values.length === 0) e.scope_values = "请选择适用范围";
    if (!(Number(f.input_weight) > 0)) e.input_weight = "需大于 0";
    if (!(Number(f.output_weight) > 0)) e.output_weight = "需大于 0";
    const vd = toNum(f.valid_days);
    if (vd < 1 || vd > 3650) e.valid_days = "1 ~ 3650 天";
    setErrors(e);
    if (Object.keys(e).length === 0) save.mutate();
  };

  const tokens = toNum(f.tokens);
  const price = toNum(f.price);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑套餐 · ${editing!.name}` : "新增套餐"}</DialogTitle>
          <DialogDescription>套餐为一次性购买的 Token 额度包，在有效期内按适用范围抵扣调用。</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <FormSection title="基本信息">
            <div className="grid grid-cols-2 gap-4">
              <Field label="名称" required error={errors.name}>
                <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="角标" hint="如：热销、推荐、新人">
                <Input value={f.badge} onChange={(e) => set("badge", e.target.value)} />
              </Field>
              <Field label="描述" className="col-span-2">
                <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection title="价格与额度">
            <div className="grid grid-cols-2 gap-4">
              <Field label="售价" required error={errors.price}>
                <AffixInput prefix="¥" suffix="元" type="number" min={0} step="0.01" value={f.price} onChange={(e) => set("price", e.target.value)} />
              </Field>
              <Field label="划线价" hint="留空或 0 不展示">
                <AffixInput prefix="¥" suffix="元" type="number" min={0} step="0.01" value={f.original_price} onChange={(e) => set("original_price", e.target.value)} />
              </Field>
              <Field
                label="Token 数量"
                required
                error={errors.tokens}
                className="col-span-2"
                hint={tokens > 0 ? <>约 {compact(tokens)} tokens，折合 {unitPrice(price * 1_000_000, tokens)} / 百万 token</> : undefined}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="number" min={1} value={f.tokens} onChange={(e) => set("tokens", e.target.value)} className="num w-48" />
                  {TOKEN_PRESETS.map((n) => (
                    <Button key={n} type="button" size="xs" variant={tokens === n ? "secondary" : "outline"} onClick={() => set("tokens", String(n))}>
                      {compact(n)}
                    </Button>
                  ))}
                </div>
              </Field>
            </div>
          </FormSection>
          <FormSection title="适用范围与计量" description="消耗 token = 输入 token × 输入权重 + 输出 token × 输出权重">
            <div className="grid grid-cols-2 gap-4">
              <Field label="适用范围" className="col-span-2">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={f.scope_type}
                  onValueChange={(v) => v && setF((p) => ({ ...p, scope_type: v as Scope, scope_values: [] }))}
                >
                  {(Object.keys(SCOPE_TYPE) as Scope[]).map((k) => (
                    <ToggleGroupItem key={k} value={k} className="px-4">
                      {SCOPE_TYPE[k]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              {f.scope_type !== "all" && (
                <Field label={f.scope_type === "models" ? "适用模型" : "适用供应商"} required error={errors.scope_values} className="col-span-2">
                  <MultiSelect
                    value={f.scope_values}
                    onChange={(v) => set("scope_values", v)}
                    options={
                      f.scope_type === "models"
                        ? (models.data ?? []).map((m) => ({ value: m.name, label: m.name, keywords: [m.display_name] }))
                        : (vendors.data ?? []).map((v) => ({ value: v.name, label: `${v.display_name}（${v.name}）` }))
                    }
                  />
                </Field>
              )}
              <Field label="输入权重" required error={errors.input_weight}>
                <AffixInput suffix="×" type="number" step="0.1" min={0} value={f.input_weight} onChange={(e) => set("input_weight", e.target.value)} />
              </Field>
              <Field label="输出权重" required error={errors.output_weight} hint="输出通常更贵，可设为 3~5 倍">
                <AffixInput suffix="×" type="number" step="0.1" min={0} value={f.output_weight} onChange={(e) => set("output_weight", e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection title="销售规则">
            <div className="grid grid-cols-3 gap-4">
              <Field label="有效期" required error={errors.valid_days}>
                <AffixInput suffix="天" type="number" min={1} value={f.valid_days} onChange={(e) => set("valid_days", e.target.value)} />
              </Field>
              <Field label="每人限购" hint="0 为不限">
                <AffixInput suffix="份" type="number" min={0} value={f.limit_per_user} onChange={(e) => set("limit_per_user", e.target.value)} />
              </Field>
              <Field label="排序" hint="越小越靠前">
                <Input type="number" value={f.sort} onChange={(e) => set("sort", e.target.value)} className="num" />
              </Field>
              <div className="col-span-3 flex items-center gap-3 rounded-md border px-3 py-2.5">
                <Switch checked={f.on_sale} onCheckedChange={(v) => set("on_sale", v)} id="on-sale" />
                <label htmlFor="on-sale" className="text-sm">
                  上架销售
                  <span className="ml-2 text-xs text-muted-foreground">下架后用户端不可购买，已购套餐不受影响</span>
                </label>
              </div>
            </div>
          </FormSection>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <SubmitButton loading={save.isPending} onClick={submit}>
            保存
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PackagesPage() {
  const qc = useQueryClient();
  const products = useProducts();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PackageProduct | null>(null);

  const toggle = useMutation({
    mutationFn: (p: PackageProduct) => api.put(`/api/admin/package-products/${p.id}`, { ...toBody(p), on_sale: !p.on_sale }),
    onSuccess: (_, p) => {
      toast.success(p.on_sale ? "已下架" : "已上架");
      qc.invalidateQueries({ queryKey: qk.products });
    },
    onError: toastError,
  });

  const columns: ColumnDef<PackageProduct>[] = [
    { header: "ID", size: 48, cell: ({ row }) => <span className="num text-muted-foreground">{row.original.id}</span> },
    {
      header: "套餐",
      cell: ({ row: { original: p } }) => (
        <div className="min-w-48">
          <div className="flex items-center gap-1.5 font-medium">
            {p.name}
            {p.badge && <StatusBadge tone="warning">{p.badge}</StatusBadge>}
          </div>
          {p.description && <div className="max-w-72 truncate text-xs text-muted-foreground">{p.description}</div>}
        </div>
      ),
    },
    {
      header: "售价",
      cell: ({ row: { original: p } }) => (
        <div className="num whitespace-nowrap">
          <span className="font-medium">{money(p.price)}</span>
          {p.original_price > p.price && <span className="ml-1.5 text-xs text-muted-foreground line-through">{money(p.original_price)}</span>}
        </div>
      ),
    },
    {
      header: "额度",
      cell: ({ row: { original: p } }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="num">{compact(p.tokens)}</span>
          </TooltipTrigger>
          <TooltipContent>{num(p.tokens)} tokens</TooltipContent>
        </Tooltip>
      ),
    },
    {
      header: "折合单价",
      cell: ({ row: { original: p } }) => (
        <span className="num whitespace-nowrap">
          {unitPrice(p.price, p.tokens)}
          <span className="text-xs text-muted-foreground"> / M</span>
        </span>
      ),
    },
    {
      header: "适用范围",
      cell: ({ row: { original: p } }) =>
        p.scope_type === "all" ? (
          <StatusBadge tone="info">全部模型</StatusBadge>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex max-w-56 flex-wrap gap-1">
                {p.scope_values.slice(0, 2).map((v) => (
                  <Badge key={v} variant="secondary" className="font-mono text-[11px] font-normal">
                    {v}
                  </Badge>
                ))}
                {p.scope_values.length > 2 && <Badge variant="outline">+{p.scope_values.length - 2}</Badge>}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              {SCOPE_TYPE[p.scope_type]}：{p.scope_values.join("、")}
            </TooltipContent>
          </Tooltip>
        ),
    },
    {
      header: "权重 入/出",
      cell: ({ row: { original: p } }) => (
        <span className="num">
          {Number(p.input_weight)} / {Number(p.output_weight)}
        </span>
      ),
    },
    { header: "有效期", cell: ({ row }) => <span className="num">{row.original.valid_days} 天</span> },
    {
      header: "限购",
      cell: ({ row }) => (row.original.limit_per_user ? <span className="num">{row.original.limit_per_user} 份/人</span> : <span className="text-muted-foreground">不限</span>),
    },
    { header: "已售", cell: ({ row }) => <span className="num">{num(row.original.sold_count)}</span> },
    {
      header: "上架",
      cell: ({ row: { original: p } }) => (
        <Switch checked={p.on_sale} disabled={toggle.isPending && toggle.variables?.id === p.id} onCheckedChange={() => toggle.mutate(p)} />
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-right">操作</div>,
      cell: ({ row: { original: p } }) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(p);
              setOpen(true);
            }}
          >
            <Pencil />
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing({ ...p, id: 0, name: `${p.name} - 副本`, on_sale: false });
              setOpen(true);
            }}
          >
            <Copy />
            复制
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="套餐商品"
        description="Token 套餐按「输入 × 权重 + 输出 × 权重」计量消耗；用户调用时优先抵扣适用的套餐，不足部分再扣钱包余额。"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus />
            新增套餐
          </Button>
        }
      />
      <DataTable columns={columns} data={products.data} loading={products.isLoading} rowKey={(p) => p.id} footer={products.data && <>共 {products.data.length} 个套餐（下架而非删除，以保留历史订单）</>} />
      <ProductDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}
