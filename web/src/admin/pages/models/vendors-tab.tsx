import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/data-table";
import { confirm, Mono, StatusBadge, Truncate, VendorIcon } from "@/components/misc";
import { api, toastError } from "@/lib/api";
import { Field, SubmitButton, toNum } from "../../components/form";
import { useVendors } from "../../lib/queries";
import type { Vendor } from "../../lib/types";
import { invalidateModels } from "./model-editor";

type VendorDraft = { name: string; display_name: string; icon: string; description: string; sort: string; enabled: boolean };

const EMPTY: VendorDraft = { name: "", display_name: "", icon: "", description: "", sort: "0", enabled: true };

function VendorEditor({ open, onOpenChange, vendor }: { open: boolean; onOpenChange: (o: boolean) => void; vendor: Vendor | null }) {
  const qc = useQueryClient();
  const [d, setD] = useState<VendorDraft>(EMPTY);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD(vendor ? { ...vendor, sort: String(vendor.sort) } : EMPTY);
      setErr({});
    }
  }, [open, vendor]);
  const set = <K extends keyof VendorDraft>(k: K, v: VendorDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...d, name: d.name.trim(), display_name: d.display_name.trim(), sort: toNum(d.sort) };
      return vendor ? api.put(`/api/admin/vendors/${vendor.id}`, body) : api.post("/api/admin/vendors", body);
    },
    onSuccess: () => {
      toast.success(vendor ? "供应商已更新" : "供应商已创建");
      invalidateModels(qc);
      onOpenChange(false);
    },
    onError: toastError,
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!d.name.trim()) e.name = "请填写标识";
    else if (!/^[A-Za-z0-9_.-]+$/.test(d.name.trim())) e.name = "仅支持字母、数字、下划线、点和中划线";
    if (!d.display_name.trim()) e.display_name = "请填写显示名称";
    setErr(e);
    if (!Object.keys(e).length) save.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{vendor ? "编辑供应商" : "新增供应商"}</DialogTitle>
          <DialogDescription>供应商用于模型分组展示，以及套餐「按供应商」限定适用范围。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="标识" required error={err.name} hint="如 openai、anthropic">
            <Input value={d.name} onChange={(e) => set("name", e.target.value)} className="font-mono" />
          </Field>
          <Field label="显示名称" required error={err.display_name}>
            <Input value={d.display_name} onChange={(e) => set("display_name", e.target.value)} />
          </Field>
          <Field label="图标" hint="图片 URL，或留空使用首字母">
            <div className="flex items-center gap-2">
              <VendorIcon vendor={d.name || "?"} icon={d.icon} size={32} />
              <Input value={d.icon} onChange={(e) => set("icon", e.target.value)} />
            </div>
          </Field>
          <Field label="排序">
            <Input type="number" value={d.sort} onChange={(e) => set("sort", e.target.value)} className="num" />
          </Field>
          <Field label="描述" className="col-span-2">
            <Textarea value={d.description} onChange={(e) => set("description", e.target.value)} rows={2} />
          </Field>
          <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2.5">
            <span className="text-sm">启用</span>
            <Switch checked={d.enabled} onCheckedChange={(v) => set("enabled", v)} />
          </div>
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

export function VendorsTab({ creating, onCreatingChange }: { creating: boolean; onCreatingChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const vendors = useVendors();
  const [editing, setEditing] = useState<Vendor | null>(null);
  const del = useMutation({
    mutationFn: (v: Vendor) => api.del(`/api/admin/vendors/${v.id}`),
    onSuccess: () => {
      toast.success("已删除");
      invalidateModels(qc);
    },
    onError: toastError,
  });
  const columns: ColumnDef<Vendor>[] = [
    { header: "ID", size: 56, cell: ({ row }) => <span className="num text-muted-foreground">{row.original.id}</span> },
    {
      header: "供应商",
      cell: ({ row: { original: v } }) => (
        <div className="flex items-center gap-2.5">
          <VendorIcon vendor={v.name} icon={v.icon} size={28} />
          <div>
            <div className="font-medium">{v.display_name}</div>
            <Mono className="text-muted-foreground">{v.name}</Mono>
          </div>
        </div>
      ),
    },
    { header: "描述", cell: ({ row }) => <Truncate text={row.original.description} className="text-muted-foreground" /> },
    { header: "模型数", cell: ({ row }) => <span className="num">{row.original.model_count}</span> },
    { header: "排序", cell: ({ row }) => <span className="num">{row.original.sort}</span> },
    {
      header: "状态",
      cell: ({ row }) => (row.original.enabled ? <StatusBadge tone="success" dot>启用</StatusBadge> : <StatusBadge tone="muted" dot>停用</StatusBadge>),
    },
    {
      id: "actions",
      header: () => <div className="text-right">操作</div>,
      cell: ({ row: { original: v } }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(v)}>
            <Pencil />
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={v.model_count > 0}
            title={v.model_count > 0 ? "该供应商下仍有模型，无法删除" : undefined}
            onClick={async () => {
              if (await confirm({ title: `删除供应商「${v.display_name}」？`, description: "删除后不可恢复。", danger: true, confirmText: "删除" })) del.mutate(v);
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
    <>
      <DataTable
        columns={columns}
        data={vendors.data}
        loading={vendors.isLoading}
        rowKey={(v) => v.id}
        footer={vendors.data ? `共 ${vendors.data.length} 个供应商` : undefined}
        empty={
          <div className="py-10 text-center text-sm text-muted-foreground">
            暂无供应商
            <Button variant="link" size="sm" onClick={() => onCreatingChange(true)}>
              <Plus />
              新增供应商
            </Button>
          </div>
        }
      />
      <VendorEditor open={creating || !!editing} onOpenChange={(o) => !o && (setEditing(null), onCreatingChange(false))} vendor={editing} />
    </>
  );
}
