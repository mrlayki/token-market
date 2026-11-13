import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, PackageCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Order } from "@/api/types";
import { DataTable } from "@/components/data-table";
import { confirm, CopyButton, Mono, StatusBadge } from "@/components/misc";
import { KV, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTableQuery } from "@/hooks/use-table-query";
import { api, toastError } from "@/lib/api";
import { dt, money } from "@/lib/format";
import { TimeCell, UserRef } from "../components/cells";
import { FilterSelect, hasFilters, ResetButton, SearchInput } from "../components/filters";
import { JsonBlock } from "../components/json";
import { lbl, ORDER_STATUS, ORDER_TYPE, PAY_METHOD } from "../lib/labels";

const URL = "/api/admin/orders";

function OrderDetail({ order, onClose }: { order: Order | null; onClose: () => void }) {
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>订单详情</DialogTitle>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <KV
              items={[
                [
                  "订单号",
                  <span className="flex items-center gap-1">
                    <Mono>{order.order_no}</Mono>
                    <CopyButton text={order.order_no} />
                  </span>,
                ],
                ["标题", order.title],
                ["用户", <UserRef id={order.user_id} />],
                ["类型", ORDER_TYPE[order.type] ?? order.type],
                ["状态", <StatusBadge tone={lbl(ORDER_STATUS, order.status).tone}>{lbl(ORDER_STATUS, order.status).label}</StatusBadge>],
                ["支付方式", `${PAY_METHOD[order.pay_method] ?? order.pay_method}${order.provider ? `（${order.provider}）` : ""}`],
                ["实付金额", <span className="num font-medium">{money(order.pay_amount)}</span>],
                ["面额 / 到账", <span className="num">{money(order.face_amount)}</span>],
                ...(order.type === "package" ? ([["数量", `${order.quantity} 份（商品 #${order.product_id ?? "-"}）`]] as [string, string][]) : []),
                ["第三方流水号", order.trade_no ? <Mono>{order.trade_no}</Mono> : "-"],
                ["创建时间", dt(order.created_at)],
                ["支付时间", dt(order.paid_at)],
                ["发货时间", dt(order.fulfilled_at)],
                ["过期时间", dt(order.expires_at)],
                ["备注", order.remark || "-"],
              ]}
            />
            <div>
              <div className="mb-1.5 text-xs text-muted-foreground">价格明细</div>
              <JsonBlock value={order.price_detail} maxHeight={220} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OrdersPage() {
  const qc = useQueryClient();
  const t = useTableQuery<Order>(URL, { keyword: "", status: "", type: "", user_id: "" });
  const [detail, setDetail] = useState<Order | null>(null);

  const act = useMutation({
    mutationFn: ({ order, action }: { order: Order; action: "refulfill" | "close" }) => api.post(`${URL}/${order.order_no}/${action}`),
    onSuccess: (_, v) => {
      toast.success(v.action === "refulfill" ? "补发货成功" : "订单已关闭");
      qc.invalidateQueries({ queryKey: [URL] });
    },
    onError: toastError,
  });

  const columns: ColumnDef<Order>[] = [
    {
      header: "订单号",
      cell: ({ row: { original: o } }) => (
        <div className="flex items-center gap-1">
          <Mono>{o.order_no}</Mono>
          <CopyButton text={o.order_no} className="size-6" />
        </div>
      ),
    },
    { header: "用户", cell: ({ row }) => <UserRef id={row.original.user_id} /> },
    {
      header: "商品",
      cell: ({ row: { original: o } }) => (
        <div className="min-w-32">
          <div className="max-w-56 truncate">{o.title}</div>
          <div className="text-xs text-muted-foreground">
            {ORDER_TYPE[o.type] ?? o.type}
            {o.type === "package" && o.quantity > 1 && ` × ${o.quantity}`}
          </div>
        </div>
      ),
    },
    { header: "支付方式", cell: ({ row }) => <span className="whitespace-nowrap">{PAY_METHOD[row.original.pay_method] ?? row.original.pay_method}</span> },
    { header: "实付", cell: ({ row }) => <span className="num font-medium">{money(row.original.pay_amount)}</span> },
    {
      header: "面额",
      cell: ({ row: { original: o } }) => (
        <span className={o.face_amount !== o.pay_amount ? "num text-success" : "num text-muted-foreground"}>{money(o.face_amount)}</span>
      ),
    },
    {
      header: "状态",
      cell: ({ row }) => {
        const s = lbl(ORDER_STATUS, row.original.status);
        return (
          <StatusBadge tone={s.tone} dot>
            {s.label}
          </StatusBadge>
        );
      },
    },
    {
      header: "流水号",
      cell: ({ row }) => (row.original.trade_no ? <Mono className="text-muted-foreground">{row.original.trade_no}</Mono> : <span className="text-muted-foreground">-</span>),
    },
    { header: "创建时间", cell: ({ row }) => <TimeCell v={row.original.created_at} /> },
    { header: "支付时间", cell: ({ row }) => <TimeCell v={row.original.paid_at} /> },
    {
      id: "actions",
      header: () => <div className="text-right">操作</div>,
      cell: ({ row: { original: o } }) => {
        const busy = act.isPending && act.variables?.order.id === o.id;
        return (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {o.status === "paid" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  if (await confirm({ title: "确认补发货？", description: `订单 ${o.order_no} 已收款但未发货，将重新执行发货（充值到账 / 发放套餐）。` }))
                    act.mutate({ order: o, action: "refulfill" });
                }}
              >
                <PackageCheck />
                补发货
              </Button>
            )}
            {o.status === "pending" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={async () => {
                  if (await confirm({ title: "关闭订单？", description: `订单 ${o.order_no} 将被关闭，用户无法再继续支付。`, danger: true, confirmText: "关闭订单" }))
                    act.mutate({ order: o, action: "close" });
                }}
              >
                <XCircle />
                关闭
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setDetail(o)}>
              <Eye />
              详情
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title="订单管理" description="充值与套餐订单。「已支付未发货」通常由发货异常导致，可手动补发货。" />
      <DataTable
        columns={columns}
        data={t.items}
        loading={t.isFetching}
        total={t.total}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        rowKey={(o) => o.id}
        onRowClick={setDetail}
        toolbar={
          <>
            <SearchInput value={t.filters.keyword} onChange={(v) => t.setFilters({ keyword: v })} placeholder="订单号 / 流水号 / 标题" className="w-60" />
            <SearchInput value={t.filters.user_id} onChange={(v) => t.setFilters({ user_id: v.replace(/\D/g, "") })} placeholder="用户 ID" className="w-28" icon={false} />
            <FilterSelect
              value={t.filters.status}
              onChange={(v) => t.setFilters({ status: v })}
              placeholder="状态"
              options={Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.label }))}
            />
            <FilterSelect value={t.filters.type} onChange={(v) => t.setFilters({ type: v })} placeholder="类型" options={Object.entries(ORDER_TYPE).map(([value, label]) => ({ value, label }))} />
            <ResetButton show={hasFilters(t.filters)} onClick={t.resetFilters} />
          </>
        }
      />
      <OrderDetail order={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
