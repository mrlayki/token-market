import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Copy, Download, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { confirm, copyText, CopyButton, Mono, StatusBadge } from "@/components/misc";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTableQuery } from "@/hooks/use-table-query";
import { api, download, toastError } from "@/lib/api";
import { dayjs, money } from "@/lib/format";
import { TimeCell, UserRef } from "../components/cells";
import { FilterSelect, hasFilters, ResetButton, SearchInput } from "../components/filters";
import { AffixInput, Field, SubmitButton, toNum } from "../components/form";
import { CODE_STATUS, lbl } from "../lib/labels";
import { useProducts } from "../lib/queries";
import type { RedemptionCode } from "../lib/types";

const URL = "/api/admin/redemption-codes";

interface GenResult {
  batch_no: string;
  codes: string[];
}

function GenerateDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (r: GenResult) => void }) {
  const qc = useQueryClient();
  const products = useProducts();
  const [name, setName] = useState("");
  const [type, setType] = useState<"quota" | "package">("quota");
  const [amount, setAmount] = useState("10");
  const [productId, setProductId] = useState("");
  const [count, setCount] = useState("10");
  const [expires, setExpires] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const gen = useMutation({
    mutationFn: () =>
      api.post<GenResult>(URL, {
        name: name.trim(),
        type,
        quota_amount: type === "quota" ? Math.round(toNum(amount) * 1_000_000) : 0,
        package_product_id: type === "package" ? Number(productId) : null,
        count: Math.round(toNum(count, 1)),
        expires_at: expires ? dayjs(expires).toISOString() : null,
      }),
    onSuccess: (r) => {
      toast.success(`已生成 ${r.codes.length} 个兑换码`);
      qc.invalidateQueries({ queryKey: [URL] });
      onOpenChange(false);
      onDone(r);
      setName("");
    },
    onError: toastError,
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "请填写名称";
    if (type === "quota" && !(toNum(amount) > 0)) e.amount = "请填写兑换额度";
    if (type === "package" && !productId) e.product = "请选择套餐";
    const c = toNum(count);
    if (c < 1 || c > 1000 || !Number.isInteger(c)) e.count = "1 ~ 1000 的整数";
    if (expires && dayjs(expires).isBefore(dayjs())) e.expires = "过期时间需晚于当前时间";
    setErrors(e);
    if (!Object.keys(e).length) gen.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>生成兑换码</DialogTitle>
          <DialogDescription>同一批次的兑换码共享面额与有效期，可导出为 CSV 分发。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="名称" required error={errors.name} hint="便于识别用途，如「双十一活动」">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="类型">
            <ToggleGroup type="single" variant="outline" value={type} onValueChange={(v) => v && setType(v as "quota" | "package")}>
              <ToggleGroupItem value="quota" className="px-4">
                余额额度
              </ToggleGroupItem>
              <ToggleGroupItem value="package" className="px-4">
                套餐
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          {type === "quota" ? (
            <Field label="兑换额度" required error={errors.amount}>
              <AffixInput prefix="¥" suffix="元" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          ) : (
            <Field label="套餐" required error={errors.product}>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择套餐商品" />
                </SelectTrigger>
                <SelectContent>
                  {(products.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}（{money(p.price)}）{!p.on_sale && " · 已下架"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="数量" required error={errors.count}>
              <AffixInput suffix="个" type="number" min={1} max={1000} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <Field label="过期时间" error={errors.expires} hint="留空永不过期">
              <Input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <SubmitButton loading={gen.isPending} onClick={submit}>
            生成
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultDialog({ result, onClose }: { result: GenResult | null; onClose: () => void }) {
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>生成成功</DialogTitle>
          <DialogDescription>
            批次号 <Mono>{result?.batch_no}</Mono>，共 {result?.codes.length} 个。关闭后仍可在列表中按批次号查询与导出。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto rounded-md border bg-muted/40 p-3">
          {result?.codes.map((c) => (
            <div key={c} className="flex items-center justify-between py-0.5">
              <Mono className="text-sm">{c}</Mono>
              <CopyButton text={c} className="size-6" />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => result && download(`${URL}/export`, { batch_no: result.batch_no }, `${result.batch_no}.csv`)}>
            <Download />
            导出 CSV
          </Button>
          <Button onClick={() => result && copyText(result.codes.join("\n"), `已复制 ${result.codes.length} 个兑换码`)}>
            <Copy />
            复制全部
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RedemptionsPage() {
  const qc = useQueryClient();
  const t = useTableQuery<RedemptionCode>(URL, { keyword: "", status: "", batch_no: "" });
  const products = useProducts();
  const [genOpen, setGenOpen] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);

  const disable = useMutation({
    mutationFn: (id: number) => api.post(`${URL}/${id}/disable`),
    onSuccess: () => {
      toast.success("兑换码已作废");
      qc.invalidateQueries({ queryKey: [URL] });
    },
    onError: toastError,
  });

  const productName = (id: number | null) => products.data?.find((p) => p.id === id)?.name ?? `套餐 #${id}`;

  const columns: ColumnDef<RedemptionCode>[] = [
    {
      header: "兑换码",
      cell: ({ row: { original: c } }) => (
        <div className="flex items-center gap-1">
          <Mono>{c.code}</Mono>
          <CopyButton text={c.code} className="size-6" />
        </div>
      ),
    },
    { header: "名称", cell: ({ row }) => <span className="block max-w-40 truncate">{row.original.name}</span> },
    {
      header: "批次",
      cell: ({ row }) => (
        <button type="button" className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => t.setFilters({ batch_no: row.original.batch_no })}>
          {row.original.batch_no}
        </button>
      ),
    },
    {
      header: "面额",
      cell: ({ row: { original: c } }) =>
        c.type === "quota" ? (
          <span className="num font-medium">{money(c.quota_amount)}</span>
        ) : (
          <StatusBadge tone="info">{productName(c.package_product_id)}</StatusBadge>
        ),
    },
    {
      header: "状态",
      cell: ({ row: { original: c } }) => {
        const expired = c.status === 1 && c.expires_at && dayjs(c.expires_at).isBefore(dayjs());
        const s = lbl(CODE_STATUS, c.status);
        return expired ? <StatusBadge tone="muted">已过期</StatusBadge> : <StatusBadge tone={s.tone} dot>{s.label}</StatusBadge>;
      },
    },
    { header: "过期时间", cell: ({ row }) => (row.original.expires_at ? <TimeCell v={row.original.expires_at} fmt="YYYY-MM-DD HH:mm" /> : <span className="text-xs text-muted-foreground">永久</span>) },
    { header: "使用者", cell: ({ row }) => <UserRef id={row.original.used_by} /> },
    { header: "使用时间", cell: ({ row }) => <TimeCell v={row.original.used_at} /> },
    { header: "创建时间", cell: ({ row }) => <TimeCell v={row.original.created_at} /> },
    {
      id: "actions",
      header: () => <div className="text-right">操作</div>,
      cell: ({ row: { original: c } }) => (
        <div className="flex justify-end">
          {c.status === 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={disable.isPending && disable.variables === c.id}
              onClick={async () => {
                if (await confirm({ title: "作废兑换码？", description: `${c.code} 作废后将无法兑换。`, danger: true, confirmText: "作废" })) disable.mutate(c.id);
              }}
            >
              <Ban />
              作废
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="兑换码"
        description="生成余额或套餐兑换码，用于活动发放、线下销售等场景。"
        actions={
          <>
            {t.filters.batch_no && (
              <Button variant="outline" onClick={() => download(`${URL}/export`, { batch_no: t.filters.batch_no }, `${t.filters.batch_no}.csv`)}>
                <Download />
                导出该批次
              </Button>
            )}
            <Button onClick={() => setGenOpen(true)}>
              <Plus />
              生成兑换码
            </Button>
          </>
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
        rowKey={(c) => c.id}
        toolbar={
          <>
            <SearchInput value={t.filters.keyword} onChange={(v) => t.setFilters({ keyword: v })} placeholder="兑换码 / 名称" />
            <SearchInput value={t.filters.batch_no} onChange={(v) => t.setFilters({ batch_no: v })} placeholder="批次号" className="w-44" icon={false} />
            <FilterSelect
              value={t.filters.status}
              onChange={(v) => t.setFilters({ status: v })}
              placeholder="状态"
              options={Object.entries(CODE_STATUS).map(([value, s]) => ({ value, label: s.label }))}
            />
            <ResetButton show={hasFilters(t.filters)} onClick={t.resetFilters} />
          </>
        }
      />
      <GenerateDialog open={genOpen} onOpenChange={setGenOpen} onDone={setResult} />
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}
