import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { VendorIcon } from "@/components/misc";
import { api, toastError } from "@/lib/api";
import { compact } from "@/lib/format";
import { AffixInput, Field, SubmitButton, toNum } from "../../components/form";
import { MultiSelect, TagInput } from "../../components/tag-input";
import { MODEL_MODE } from "../../lib/labels";
import { qk, useVendors } from "../../lib/queries";
import type { ModelMeta, ModelMetaIn, ModelMode } from "../../lib/types";

export const ENDPOINT_OPTIONS = [
  { value: "openai", label: "OpenAI 兼容（/v1/chat/completions）" },
  { value: "anthropic", label: "Anthropic（/v1/messages）" },
  { value: "embeddings", label: "Embeddings（/v1/embeddings）" },
];

const NONE = "__none__";

export function toModelIn(m: ModelMeta): ModelMetaIn {
  return {
    name: m.name,
    vendor_id: m.vendor_id,
    display_name: m.display_name,
    description: m.description,
    icon: m.icon,
    tags: m.tags,
    mode: m.mode,
    endpoints: m.endpoints,
    context_length: m.context_length,
    max_output_tokens: m.max_output_tokens,
    listed: m.listed,
    sort: m.sort,
  };
}

const EMPTY: ModelMetaIn = {
  name: "",
  vendor_id: null,
  display_name: "",
  description: "",
  icon: "",
  tags: [],
  mode: "chat",
  endpoints: ["openai"],
  context_length: 0,
  max_output_tokens: 0,
  listed: true,
  sort: 0,
};

interface Draft extends Omit<ModelMetaIn, "context_length" | "max_output_tokens" | "sort"> {
  context_length: string;
  max_output_tokens: string;
  sort: string;
}

function toDraft(m: ModelMetaIn): Draft {
  return { ...m, context_length: String(m.context_length || ""), max_output_tokens: String(m.max_output_tokens || ""), sort: String(m.sort) };
}

export function invalidateModels(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.allModels });
  qc.invalidateQueries({ queryKey: qk.vendors });
  qc.invalidateQueries({ queryKey: ["/api/admin/models"] });
  qc.invalidateQueries({ queryKey: ["admin", "models-missing"] });
}

export function ModelEditor({ open, onOpenChange, model }: { open: boolean; onOpenChange: (o: boolean) => void; model: ModelMeta | null }) {
  const qc = useQueryClient();
  const vendors = useVendors();
  const [d, setD] = useState<Draft>(toDraft(EMPTY));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setD(toDraft(model ? toModelIn(model) : EMPTY));
      setErr(null);
    }
  }, [open, model]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: (body: ModelMetaIn) => (model ? api.put(`/api/admin/models/${model.id}`, body) : api.post("/api/admin/models", body)),
    onSuccess: () => {
      toast.success(model ? "模型已更新" : "模型已创建");
      invalidateModels(qc);
      onOpenChange(false);
    },
    onError: toastError,
  });

  const submit = () => {
    const name = d.name.trim();
    if (!name) return setErr("请填写模型名称");
    if (!d.endpoints.length) return setErr("至少选择一个端点");
    setErr(null);
    save.mutate({
      ...d,
      name,
      display_name: d.display_name.trim(),
      context_length: toNum(d.context_length),
      max_output_tokens: toNum(d.max_output_tokens),
      sort: toNum(d.sort),
    });
  };

  const endpointOptions = [...ENDPOINT_OPTIONS, ...d.endpoints.filter((e) => !ENDPOINT_OPTIONS.some((o) => o.value === e)).map((e) => ({ value: e, label: e }))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{model ? `编辑模型 · ${model.name}` : "新增模型"}</DialogTitle>
          <DialogDescription>模型元数据用于模型广场展示与路由；价格请在「模型计费」中设置。</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] grid-cols-2 gap-4 overflow-y-auto px-0.5 py-1">
          <Field label="模型名称" required hint={model ? "模型名称创建后不可修改" : "对外暴露的模型 ID，需与渠道中配置的模型名一致"} error={err && !d.name.trim() ? err : null}>
            <Input value={d.name} disabled={!!model} onChange={(e) => set("name", e.target.value)} placeholder="gpt-4o-mini" className="font-mono" />
          </Field>
          <Field label="显示名称">
            <Input value={d.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="默认与模型名相同" />
          </Field>
          <Field label="供应商">
            <Select value={d.vendor_id ? String(d.vendor_id) : NONE} onValueChange={(v) => set("vendor_id", v === NONE ? null : Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>未指定</SelectItem>
                {vendors.data?.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    <VendorIcon vendor={v.name} icon={v.icon} size={16} />
                    {v.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="类型">
            <Select value={d.mode} onValueChange={(v) => set("mode", v as ModelMode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODEL_MODE).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="支持端点" required className="col-span-2" error={err && !d.endpoints.length ? err : null}>
            <MultiSelect options={endpointOptions} value={d.endpoints} onChange={(v) => set("endpoints", v)} />
          </Field>
          <Field label="上下文长度" hint={toNum(d.context_length) ? `${compact(toNum(d.context_length))} tokens` : "0 表示未知"}>
            <AffixInput type="number" min={0} value={d.context_length} onChange={(e) => set("context_length", e.target.value)} suffix="tokens" />
          </Field>
          <Field label="最大输出" hint={toNum(d.max_output_tokens) ? `${compact(toNum(d.max_output_tokens))} tokens` : "0 表示未知"}>
            <AffixInput type="number" min={0} value={d.max_output_tokens} onChange={(e) => set("max_output_tokens", e.target.value)} suffix="tokens" />
          </Field>
          <Field label="标签" className="col-span-2" hint="展示在模型广场，如：对话、长上下文、高性价比">
            <TagInput value={d.tags} onChange={(v) => set("tags", v)} />
          </Field>
          <Field label="图标 URL" hint="留空则使用供应商图标">
            <Input value={d.icon} onChange={(e) => set("icon", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="排序" hint="数值越小越靠前">
            <Input type="number" value={d.sort} onChange={(e) => set("sort", e.target.value)} className="num" />
          </Field>
          <Field label="描述" className="col-span-2">
            <Textarea value={d.description} onChange={(e) => set("description", e.target.value)} rows={3} />
          </Field>
          <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">上架</div>
              <div className="text-xs text-muted-foreground">下架后模型不在模型广场展示</div>
            </div>
            <Switch checked={d.listed} onCheckedChange={(v) => set("listed", v)} />
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
