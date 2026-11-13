import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { confirm, Mono, StatusBadge } from "@/components/misc";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, toastError } from "@/lib/api";
import { num } from "@/lib/format";
import { Field, SubmitButton, toNum } from "../components/form";
import { MultiSelect } from "../components/tag-input";
import { qk, useGroups } from "../lib/queries";
import type { Group } from "../lib/types";

/** 0.9 → 9 折；1 → 原价 */
export function discountLabel(ratio: string | number): string {
  const r = Number(ratio);
  if (!Number.isFinite(r)) return String(ratio);
  if (r === 1) return "原价";
  if (r === 0) return "免费";
  if (r > 1) return `加价 ×${parseFloat(r.toFixed(4))}`;
  return `${parseFloat((r * 10).toFixed(2))} 折`;
}

interface FormState {
  name: string;
  display_name: string;
  description: string;
  price_ratio: string;
  topup_ratio: string;
  usable_groups: string[];
  sort: string;
}

const emptyForm: FormState = { name: "", display_name: "", description: "", price_ratio: "1", topup_ratio: "1", usable_groups: [], sort: "0" };

function GroupDialog({ open, onOpenChange, editing, groups }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Group | null; groups: Group[] }) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = open ? (editing?.name ?? "__new__") : null;
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setErrors({});
      setF(
        editing
          ? {
              name: editing.name,
              display_name: editing.display_name,
              description: editing.description,
              price_ratio: String(Number(editing.price_ratio)),
              topup_ratio: String(Number(editing.topup_ratio)),
              usable_groups: editing.usable_groups,
              sort: String(editing.sort),
            }
          : emptyForm,
      );
    }
  }
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      api.post<Group>("/api/admin/groups", {
        name: f.name.trim(),
        display_name: f.display_name.trim(),
        description: f.description,
        price_ratio: f.price_ratio,
        topup_ratio: f.topup_ratio,
        usable_groups: f.usable_groups,
        sort: toNum(f.sort),
      }),
    onSuccess: () => {
      toast.success(editing ? "分组已更新" : "分组已创建");
      qc.invalidateQueries({ queryKey: qk.groups });
      onOpenChange(false);
    },
    onError: toastError,
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!/^[A-Za-z0-9_-]+$/.test(f.name.trim())) e.name = "仅支持字母、数字、下划线与短横线";
    if (!f.display_name.trim()) e.display_name = "请填写显示名称";
    const pr = Number(f.price_ratio);
    if (f.price_ratio.trim() === "" || !Number.isFinite(pr) || pr < 0) e.price_ratio = "需为 ≥ 0 的数字";
    const tr = Number(f.topup_ratio);
    if (f.topup_ratio.trim() === "" || !Number.isFinite(tr) || tr <= 0) e.topup_ratio = "需为 > 0 的数字";
    setErrors(e);
    if (Object.keys(e).length === 0) save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑分组 · ${editing.name}` : "新增分组"}</DialogTitle>
          <DialogDescription>分组决定用户的调用价格倍率与可使用的渠道分组。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="分组标识" required error={errors.name} hint={editing ? "标识不可修改" : "如 vip、enterprise"}>
            <Input value={f.name} disabled={!!editing} onChange={(e) => set("name", e.target.value)} className="font-mono" />
          </Field>
          <Field label="显示名称" required error={errors.display_name}>
            <Input value={f.display_name} onChange={(e) => set("display_name", e.target.value)} />
          </Field>
          <Field label="价格倍率" required error={errors.price_ratio} hint={<>实际售价 = 模型价 × 倍率，当前：{discountLabel(f.price_ratio)}</>}>
            <Input type="number" step="0.01" min={0} value={f.price_ratio} onChange={(e) => set("price_ratio", e.target.value)} className="num" />
          </Field>
          <Field label="充值倍率" required error={errors.topup_ratio} hint="充值到账 = 支付金额 × 倍率">
            <Input type="number" step="0.01" min={0} value={f.topup_ratio} onChange={(e) => set("topup_ratio", e.target.value)} className="num" />
          </Field>
          <Field label="可用分组" className="col-span-2" hint="该分组用户可使用的渠道分组（自身分组会自动包含）">
            <MultiSelect
              options={groups.map((g) => ({ value: g.name, label: `${g.display_name}（${g.name}）` }))}
              value={f.usable_groups}
              onChange={(v) => set("usable_groups", v)}
            />
          </Field>
          <Field label="排序" hint="数字越小越靠前">
            <Input type="number" value={f.sort} onChange={(e) => set("sort", e.target.value)} className="num" />
          </Field>
          <Field label="描述" className="col-span-2">
            <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
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

export default function GroupsPage() {
  const qc = useQueryClient();
  const groups = useGroups();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);

  const del = useMutation({
    mutationFn: (name: string) => api.del(`/api/admin/groups/${encodeURIComponent(name)}`),
    onSuccess: () => {
      toast.success("分组已删除");
      qc.invalidateQueries({ queryKey: qk.groups });
    },
    onError: toastError,
  });

  const nameOf = (n: string) => groups.data?.find((g) => g.name === n)?.display_name ?? n;

  const columns: ColumnDef<Group>[] = [
    {
      header: "分组",
      cell: ({ row: { original: g } }) => (
        <div>
          <div className="font-medium">{g.display_name}</div>
          <Mono className="text-muted-foreground">{g.name}</Mono>
        </div>
      ),
    },
    {
      header: "价格倍率",
      cell: ({ row: { original: g } }) => (
        <div className="flex items-center gap-2">
          <span className="num">×{Number(g.price_ratio)}</span>
          <StatusBadge tone={Number(g.price_ratio) < 1 ? "success" : Number(g.price_ratio) > 1 ? "warning" : "muted"}>{discountLabel(g.price_ratio)}</StatusBadge>
        </div>
      ),
    },
    { header: "充值倍率", cell: ({ row }) => <span className="num">×{Number(row.original.topup_ratio)}</span> },
    {
      header: "可用分组",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.usable_groups.map((n) => (
            <StatusBadge key={n} tone="info">
              {nameOf(n)}
            </StatusBadge>
          ))}
        </div>
      ),
    },
    { header: "用户数", cell: ({ row }) => <span className="num">{num(row.original.user_count)}</span> },
    { header: "排序", cell: ({ row }) => <span className="num text-muted-foreground">{row.original.sort}</span> },
    {
      header: "描述",
      cell: ({ row }) => <span className="block max-w-64 truncate text-muted-foreground">{row.original.description || "-"}</span>,
    },
    {
      id: "actions",
      header: () => <div className="text-right">操作</div>,
      cell: ({ row: { original: g } }) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(g);
              setOpen(true);
            }}
          >
            <Pencil />
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={g.name === "default"}
            onClick={async () => {
              if (g.user_count > 0) {
                toast.error(`仍有 ${g.user_count} 个用户属于该分组，请先迁移`);
                return;
              }
              if (await confirm({ title: `删除分组「${g.display_name}」？`, description: "删除后不可恢复。", danger: true, confirmText: "删除" }))
                del.mutate(g.name);
            }}
          >
            <Trash2 />
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="用户分组"
        description="分组用于差异化定价：价格倍率 0.9 表示该分组用户按 9 折计费；充值倍率影响充值到账金额。"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus />
            新增分组
          </Button>
        }
      />
      <DataTable columns={columns} data={groups.data} loading={groups.isLoading} rowKey={(g) => g.name} />
      <GroupDialog open={open} onOpenChange={setOpen} editing={editing} groups={groups.data ?? []} />
    </div>
  );
}
