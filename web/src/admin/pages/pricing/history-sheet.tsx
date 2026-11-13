import { TimeRulesText } from "../../components/time-rules-editor";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirm, StatusBadge } from "@/components/misc";
import { Empty } from "@/components/page";
import { api, toastError } from "@/lib/api";
import { dayjs, dt, fromNow, money, pricePerM } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PriceVersion } from "../../lib/types";
import { useInvalidatePrices } from "./price-utils";

export function HistorySheet({ model, onOpenChange }: { model: string | null; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidatePrices();
  const q = useQuery({
    queryKey: ["admin", "price-history", model],
    queryFn: () => api.get<PriceVersion[]>(`/api/admin/prices/${encodeURIComponent(model!)}/history`),
    enabled: !!model,
  });
  const del = useMutation({
    mutationFn: (p: PriceVersion) => api.del(`/api/admin/prices/${p.id}`),
    onSuccess: () => {
      toast.success("已删除待生效版本");
      invalidate(model!);
    },
    onError: toastError,
  });
  const now = dayjs();
  const rows = q.data ?? [];
  const currentId = rows.find((p) => !dayjs(p.effective_at).isAfter(now))?.id;

  return (
    <Sheet open={!!model} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle>
            价格历史 · <span className="font-mono">{model}</span>
          </SheetTitle>
          <SheetDescription>按生效时间倒序，最多显示 100 个版本。已生效版本不可修改或删除；待生效版本可删除以取消定时调价。</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-auto p-4">
          {q.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : !rows.length ? (
            <Empty title="暂无价格版本" description="该模型尚未定价" />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="text-xs">
                    <TableHead>生效时间</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">输入</TableHead>
                    <TableHead className="text-right">输出</TableHead>
                    <TableHead className="text-right">缓存读 / 写</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => {
                    const pending = dayjs(p.effective_at).isAfter(now);
                    const current = p.id === currentId;
                    return (
                      <TableRow key={p.id} className={cn(!pending && !current && "text-muted-foreground")}>
                        <TableCell className="num text-xs whitespace-nowrap">
                          {dt(p.effective_at, "YYYY-MM-DD HH:mm")}
                          <div className="text-[11px] text-muted-foreground">{fromNow(p.effective_at)}</div>
                        </TableCell>
                        <TableCell>
                          {pending ? (
                            <StatusBadge tone="info">待生效</StatusBadge>
                          ) : current ? (
                            <StatusBadge tone="success" dot>
                              当前生效
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="muted">已失效</StatusBadge>
                          )}
                        </TableCell>
                        {p.billing_type === "per_call" ? (
                          <TableCell colSpan={3} className="num text-right text-xs">
                            按次 {money(p.per_call_price, { precise: true })} / 次
                          </TableCell>
                        ) : (
                          <>
                            <TableCell className="num text-right text-xs">{pricePerM(p.input_price)}</TableCell>
                            <TableCell className="num text-right text-xs">{pricePerM(p.output_price)}</TableCell>
                            <TableCell className="num text-right text-xs">
                              {p.cache_read_price ? pricePerM(p.cache_read_price) : "-"} / {p.cache_write_price ? pricePerM(p.cache_write_price) : "-"}
                            </TableCell>
                          </>
                        )}
                        <TableCell className="max-w-40 truncate text-xs" title={p.remark}>
                          {p.remark || "-"}
                          {p.time_rules?.length ? <TimeRulesText rules={p.time_rules} className="mt-1 whitespace-normal" /> : null}
                        </TableCell>
                        <TableCell>
                          {pending && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              disabled={del.isPending}
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: "删除待生效价格版本？",
                                    description: `将取消 ${dt(p.effective_at, "YYYY-MM-DD HH:mm")} 的定时调价。`,
                                    danger: true,
                                    confirmText: "删除",
                                  })
                                )
                                  del.mutate(p);
                              }}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">单位：元 / 百万 token</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
