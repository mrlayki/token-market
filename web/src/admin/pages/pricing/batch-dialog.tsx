import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Mono } from "@/components/misc";
import { api, toastError } from "@/lib/api";
import { AffixInput, Field, SubmitButton, toNum } from "../../components/form";
import type { ModelMeta } from "../../lib/types";
import { VersionNote } from "./price-dialog";
import { bodyFromDraft, draftFromPrice, type PriceDraft, useInvalidatePrices, validateDraft, validateEffective } from "./price-utils";

type Row = { model: string; d: PriceDraft };

const scale = (v: string, f: number) => (v.trim() === "" ? v : String(parseFloat((Number(v) * f).toFixed(6))));

export function BatchPriceDialog({ models, open, onOpenChange, onDone }: { models: ModelMeta[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const invalidate = useInvalidatePrices();
  const [rows, setRows] = useState<Row[]>([]);
  const [factor, setFactor] = useState("");
  const [effective, setEffective] = useState("");
  const [remark, setRemark] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRows(models.map((m) => ({ model: m.name, d: draftFromPrice(m.price) })));
      setFactor("");
      setEffective("");
      setRemark("");
      setErr(null);
    }
  }, [open, models]);

  const setCell = (i: number, k: keyof PriceDraft, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, d: { ...r.d, [k]: v } } : r)));

  const applyFactor = () => {
    const f = toNum(factor, NaN);
    if (!Number.isFinite(f) || f <= 0) return toast.error("请输入大于 0 的倍数");
    setRows((rs) =>
      rs.map((r) => ({
        ...r,
        d: {
          ...r.d,
          input: scale(r.d.input, f),
          output: scale(r.d.output, f),
          cache_read: scale(r.d.cache_read, f),
          cache_write: scale(r.d.cache_write, f),
          per_call: scale(r.d.per_call, f),
        },
      })),
    );
  };

  const save = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>("/api/admin/prices/batch", { items: rows.map((r) => bodyFromDraft(r.model, r.d, effective, remark)) }),
    onSuccess: (r) => {
      toast.success(r.message || "已保存");
      invalidate();
      onDone();
      onOpenChange(false);
    },
    onError: toastError,
  });

  const submit = () => {
    for (const r of rows) {
      const e = validateDraft(r.d);
      if (e) return setErr(`${r.model}：${e}`);
    }
    const e = validateEffective(effective);
    setErr(e);
    if (!e) save.mutate();
  };

  const cell = (i: number, k: keyof PriceDraft, v: string) => (
    <Input type="number" min={0} step="0.0001" value={v} onChange={(e) => setCell(i, k, e.target.value)} className="num h-8 w-24 text-right" />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>批量调价（{rows.length} 个模型）</DialogTitle>
          <DialogDescription>单位：元 / 百万 token；按次计费的模型仅需填写每次价格。所有模型将使用相同的生效时间与备注。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <VersionNote />
          <div className="flex flex-wrap items-end gap-2">
            <Field label="按比例调整" hint="以当前表格中的价格为基准，例如 0.8 表示统一降价 20%">
              <div className="flex gap-2">
                <AffixInput type="number" min={0} step="0.01" value={factor} onChange={(e) => setFactor(e.target.value)} suffix="倍" className="w-32" />
                <Button variant="outline" onClick={applyFactor}>
                  应用
                </Button>
              </div>
            </Field>
          </div>
          <div className="max-h-[42vh] overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-muted">
                <TableRow className="text-xs">
                  <TableHead>模型</TableHead>
                  <TableHead>计费</TableHead>
                  <TableHead className="text-right">输入</TableHead>
                  <TableHead className="text-right">输出</TableHead>
                  <TableHead className="text-right">缓存读</TableHead>
                  <TableHead className="text-right">缓存写</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.model}>
                    <TableCell>
                      <Mono>{r.model}</Mono>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.d.billing_type === "token" ? "按 Token" : "按次"}</TableCell>
                    {r.d.billing_type === "token" ? (
                      <>
                        <TableCell className="text-right">{cell(i, "input", r.d.input)}</TableCell>
                        <TableCell className="text-right">{cell(i, "output", r.d.output)}</TableCell>
                        <TableCell className="text-right">{cell(i, "cache_read", r.d.cache_read)}</TableCell>
                        <TableCell className="text-right">{cell(i, "cache_write", r.d.cache_write)}</TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={4}>
                        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                          每次 {cell(i, "per_call", r.d.per_call)} 元
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="生效时间" hint="留空表示立即生效">
              <Input type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} />
            </Field>
            <Field label="备注">
              <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="如：双十一限时降价" />
            </Field>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <SubmitButton loading={save.isPending} onClick={submit} disabled={!rows.length}>
            {effective ? "创建定时调价" : "保存并立即生效"}
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
