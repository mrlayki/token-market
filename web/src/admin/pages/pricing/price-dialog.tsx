import { useMutation } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, toastError } from "@/lib/api";
import { dayjs, money, yuanToMicro } from "@/lib/format";
import { AffixInput, Field, SubmitButton } from "../../components/form";
import { PriceSummary } from "../../components/pricing-summary";
import { TimeRulesEditor } from "../../components/time-rules-editor";
import type { ModelMeta, PriceVersion } from "../../lib/types";
import { bodyFromDraft, draftFromPrice, type PriceDraft, useInvalidatePrices, validateDraft, validateEffective } from "./price-utils";

export function PriceFields({ d, onChange }: { d: PriceDraft; onChange: (d: PriceDraft) => void }) {
  const set = (k: keyof PriceDraft, v: string) => onChange({ ...d, [k]: v });
  const sample = d.billing_type === "token" ? (yuanToMicro(d.input || 0) + yuanToMicro(d.output || 0)) / 1000 : 0;
  return (
    <div className="space-y-4">
      <Field label="计费方式">
        <ToggleGroup
          type="single"
          variant="outline"
          value={d.billing_type}
          onValueChange={(v) => v && onChange({ ...d, billing_type: v as PriceDraft["billing_type"] })}
          className="w-fit"
        >
          <ToggleGroupItem value="token" className="px-4">
            按 Token
          </ToggleGroupItem>
          <ToggleGroupItem value="per_call" className="px-4">
            按次
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>
      {d.billing_type === "token" ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label="输入价格" required>
              <AffixInput type="number" min={0} step="0.0001" prefix="¥" suffix="/ 1M" value={d.input} onChange={(e) => set("input", e.target.value)} />
            </Field>
            <Field label="输出价格" required>
              <AffixInput type="number" min={0} step="0.0001" prefix="¥" suffix="/ 1M" value={d.output} onChange={(e) => set("output", e.target.value)} />
            </Field>
            <Field label="缓存读取价格" hint="命中缓存的输入 token；0 表示按输入价计费">
              <AffixInput type="number" min={0} step="0.0001" prefix="¥" suffix="/ 1M" value={d.cache_read} onChange={(e) => set("cache_read", e.target.value)} />
            </Field>
            <Field label="缓存写入价格" hint="写入缓存的 token；0 表示按输入价计费">
              <AffixInput type="number" min={0} step="0.0001" prefix="¥" suffix="/ 1M" value={d.cache_write} onChange={(e) => set("cache_write", e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            示例：1K 输入 + 1K 输出 ≈ <span className="num text-foreground">{money(Math.round(sample), { precise: true })}</span>（未计分组倍率）
          </p>
        </>
      ) : (
        <Field label="每次调用价格" required className="max-w-60">
          <AffixInput type="number" min={0} step="0.0001" prefix="¥" suffix="/ 次" value={d.per_call} onChange={(e) => set("per_call", e.target.value)} />
        </Field>
      )}
    </div>
  );
}

export function VersionNote() {
  return (
    <div className="flex gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>
        价格采用<b className="font-medium text-foreground">版本化</b>管理：每次保存都会新增一个价格版本，已生效版本不可修改（用于历史账单追溯）。
        可设置未来生效时间实现定时调价，未生效的版本可在「历史」中删除。
      </span>
    </div>
  );
}

export function PriceDialog({ model, onOpenChange }: { model: ModelMeta | null; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidatePrices();
  const [d, setD] = useState<PriceDraft>(draftFromPrice(null));
  const [effective, setEffective] = useState("");
  const [remark, setRemark] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (model) {
      setD(draftFromPrice(model.pending_price ?? model.price));
      setEffective("");
      setRemark("");
      setErr(null);
    }
  }, [model]);
  const save = useMutation({
    mutationFn: () => api.post<PriceVersion>("/api/admin/prices", bodyFromDraft(model!.name, d, effective, remark)),
    onSuccess: () => {
      toast.success(effective ? `已创建定时调价，将于 ${dayjs(effective).format("MM-DD HH:mm")} 生效` : "新价格已立即生效");
      invalidate(model!.name);
      onOpenChange(false);
    },
    onError: toastError,
  });
  const submit = () => {
    const e = validateDraft(d) ?? validateEffective(effective);
    setErr(e);
    if (!e) save.mutate();
  };
  return (
    <Dialog open={!!model} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            调整价格 · <span className="font-mono">{model?.name}</span>
          </DialogTitle>
          <DialogDescription>单位：元 / 百万 token（按次计费为 元 / 次），用户实际价格 = 模型价格 × 分组倍率。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <VersionNote />
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">当前生效：</span>
            <PriceSummary price={model?.price} compact />
          </div>
          <PriceFields d={d} onChange={setD} />
          <Field label="分时计价（可选）" hint="如 DeepSeek 高峰时段价格 ×2：上方填低谷价作为基础价，再添加高峰时段">
            <TimeRulesEditor value={d.time_rules} onChange={(time_rules) => setD({ ...d, time_rules })} emptyText="未设置：全天按基础价计费" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="生效时间" hint="留空表示立即生效">
              <Input type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} />
            </Field>
            <Field label="备注">
              <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="如：上游降价同步" />
            </Field>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <SubmitButton loading={save.isPending} onClick={submit}>
            {effective ? "创建定时调价" : "保存并立即生效"}
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
