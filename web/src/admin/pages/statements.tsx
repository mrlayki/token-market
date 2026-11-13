import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { FilePlus2, ListTree } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { OK, Statement } from "@/api/types";
import { DataTable } from "@/components/data-table";
import { Empty, KV, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTableQuery } from "@/hooks/use-table-query";
import { api, toastError } from "@/lib/api";
import { compact, dayjs, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserRef } from "../components/cells";
import { hasFilters, ResetButton, SearchInput } from "../components/filters";
import { Field, SubmitButton } from "../components/form";
import { useIsRoot } from "../lib/queries";

const DEFAULTS = { period_type: "day", user_id: "" };

function periodLabel(s: Statement) {
  return s.period_type === "month" ? dayjs(s.period_start).format("YYYY 年 MM 月") : dayjs(s.period_start).format("YYYY-MM-DD");
}

function DetailDialog({ s, onClose }: { s: Statement | null; onClose: () => void }) {
  const rows = Object.entries(s?.detail?.by_model ?? {}).sort((a, b) => b[1].amount - a[1].amount);
  return (
    <Dialog open={!!s} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {s && (
          <>
            <DialogHeader>
              <DialogTitle>账单明细 · {periodLabel(s)}</DialogTitle>
              <DialogDescription>
                用户 <UserRef id={s.user_id} /> 的{s.period_type === "month" ? "月" : "日"}账单
              </DialogDescription>
            </DialogHeader>
            <KV
              className="grid-cols-[auto_1fr_auto_1fr]"
              items={[
                ["期初余额", <span className="num">{money(s.opening_balance)}</span>],
                ["期末余额", <span className="num">{money(s.closing_balance)}</span>],
                ["充值", <span className="num text-success">{money(s.recharged)}</span>],
                ["消费", <span className="num">{money(s.consumed)}</span>],
                ["退款", <span className="num">{money(s.refunded)}</span>],
                ["套餐 Token", <span className="num">{num(s.package_tokens)}</span>],
                ["请求数", <span className="num">{num(s.requests)}</span>],
                ["Tokens（入/出）", <span className="num">{`${num(s.prompt_tokens)} / ${num(s.completion_tokens)}`}</span>],
              ]}
            />
            <div className="max-h-[50vh] overflow-auto rounded-lg border">
              {rows.length ? (
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead>模型</TableHead>
                      <TableHead className="text-right">请求数</TableHead>
                      <TableHead className="text-right">输入</TableHead>
                      <TableHead className="text-right">输出</TableHead>
                      <TableHead className="text-right">售价</TableHead>
                      <TableHead className="text-right">钱包扣费</TableHead>
                      <TableHead className="text-right">套餐 Token</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(([m, v]) => (
                      <TableRow key={m}>
                        <TableCell className="font-medium">{m}</TableCell>
                        <TableCell className="num text-right">{num(v.requests)}</TableCell>
                        <TableCell className="num text-right">{compact(v.prompt_tokens)}</TableCell>
                        <TableCell className="num text-right">{compact(v.completion_tokens)}</TableCell>
                        <TableCell className="num text-right">{money(v.amount)}</TableCell>
                        <TableCell className="num text-right">{money(v.wallet_amount)}</TableCell>
                        <TableCell className="num text-right">{num(v.package_tokens)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Empty title="无按模型明细" />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BuildDialog({ open, onOpenChange, defaultType }: { open: boolean; onOpenChange: (o: boolean) => void; defaultType: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState(defaultType);
  const [date, setDate] = useState(dayjs().subtract(1, "day").format("YYYY-MM-DD"));
  const m = useMutation({
    mutationFn: () => api.post<OK>("/api/admin/statements/build", { period_type: type, period_start: date }),
    onSuccess: (r) => {
      toast.success(r.message || "已生成");
      qc.invalidateQueries({ queryKey: ["/api/admin/statements"] });
      onOpenChange(false);
    },
    onError: toastError,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>生成账单</DialogTitle>
          <DialogDescription>系统每日自动生成账单；此处可手动补生成指定周期。已存在的账单不会被覆盖。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="账单类型">
            <ToggleGroup type="single" variant="outline" value={type} onValueChange={(v) => v && setType(v)} className="w-fit">
              <ToggleGroupItem value="day" className="px-4">日账单</ToggleGroupItem>
              <ToggleGroupItem value="month" className="px-4">月账单</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field label={type === "month" ? "月份" : "日期"} hint={type === "month" ? "生成所选月份的月账单" : "生成所选日期的日账单"}>
            {type === "month" ? (
              <Input type="month" value={date.slice(0, 7)} onChange={(e) => setDate(`${e.target.value}-01`)} />
            ) : (
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <SubmitButton loading={m.isPending} disabled={!date} onClick={() => m.mutate()}>
            生成
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StatementsPage() {
  const isRoot = useIsRoot();
  const t = useTableQuery<Statement, typeof DEFAULTS>("/api/admin/statements", DEFAULTS);
  const f = t.filters;
  const [detail, setDetail] = useState<Statement | null>(null);
  const [building, setBuilding] = useState(false);

  const columns: ColumnDef<Statement, unknown>[] = [
    { header: "周期", cell: ({ row }) => <span className="num font-medium whitespace-nowrap">{periodLabel(row.original)}</span> },
    { header: "用户", cell: ({ row }) => <UserRef id={row.original.user_id} /> },
    { header: "期初余额", cell: ({ row }) => <span className="num">{money(row.original.opening_balance)}</span> },
    {
      header: "充值",
      cell: ({ row }) => <span className={cn("num", row.original.recharged > 0 ? "text-success" : "text-muted-foreground")}>{money(row.original.recharged)}</span>,
    },
    { header: "消费", cell: ({ row }) => <span className="num">{money(row.original.consumed)}</span> },
    {
      header: "退款",
      cell: ({ row }) => <span className={cn("num", !row.original.refunded && "text-muted-foreground")}>{money(row.original.refunded)}</span>,
    },
    { header: "期末余额", cell: ({ row }) => <span className="num font-medium">{money(row.original.closing_balance)}</span> },
    { header: "套餐 Token", cell: ({ row }) => <span className="num">{num(row.original.package_tokens)}</span> },
    { header: "请求数", cell: ({ row }) => <span className="num">{num(row.original.requests)}</span> },
    {
      header: "Tokens（入/出）",
      cell: ({ row }) => (
        <span className="num text-xs whitespace-nowrap">
          {compact(row.original.prompt_tokens)} / {compact(row.original.completion_tokens)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button variant="ghost" size="xs" onClick={() => setDetail(row.original)}>
          <ListTree />
          明细
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="账单"
        description="按日 / 按月汇总的用户账单，期末余额 = 期初 + 充值 + 退款 − 消费。"
        actions={
          isRoot && (
            <Button size="sm" onClick={() => setBuilding(true)}>
              <FilePlus2 />
              生成账单
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        data={t.items}
        loading={t.isLoading || t.isFetching}
        total={t.total}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        rowKey={(r) => r.id}
        onRowClick={setDetail}
        empty={<Empty title="暂无账单" description="账单由定时任务每日生成，也可由超级管理员手动生成。" />}
        toolbar={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={f.period_type}
              onValueChange={(v) => v && t.setFilters({ period_type: v === "day" ? "" : v })}
            >
              <ToggleGroupItem value="day" className="px-3">日账单</ToggleGroupItem>
              <ToggleGroupItem value="month" className="px-3">月账单</ToggleGroupItem>
            </ToggleGroup>
            <SearchInput className="w-28" icon={false} value={f.user_id} onChange={(v) => t.setFilters({ user_id: v.replace(/\D/g, "") })} placeholder="用户 ID" />
            <ResetButton show={hasFilters({ ...f, period_type: f.period_type === "day" ? "" : f.period_type })} onClick={t.resetFilters} />
          </>
        }
      />
      <DetailDialog s={detail} onClose={() => setDetail(null)} />
      {building && <BuildDialog open={building} onOpenChange={setBuilding} defaultType={f.period_type} />}
    </div>
  );
}
