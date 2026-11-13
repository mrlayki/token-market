import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { CopyButton, Mono, confirm } from "@/components/misc";
import { Empty, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, toastError } from "@/lib/api";
import { dayjs, dt, money } from "@/lib/format";
import type { Order } from "@/api/types";
import { useTableQuery } from "@/hooks/use-table-query";
import { ORDER_STATUS_OPTIONS, ORDER_TYPES, OrderStatusBadge, PayMethodLabel } from "../lib/labels";

const URL = "/api/console/orders";

export default function OrdersPage() {
  const t = useTableQuery<Order, { status: string; type: string }>(URL, { status: "", type: "" });
  const qc = useQueryClient();

  async function cancel(o: Order) {
    if (!(await confirm({ title: "取消该订单？", description: `订单号 ${o.order_no}`, confirmText: "取消订单", danger: true }))) return;
    try {
      await api.post(`${URL}/${o.order_no}/cancel`);
      toast.success("订单已取消");
      qc.invalidateQueries({ queryKey: [URL] });
    } catch (e) {
      toastError(e);
    }
  }

  const columns: ColumnDef<Order>[] = [
    {
      header: "订单",
      cell: ({ row: { original: o } }) => (
        <div className="min-w-0">
          <div className="font-medium">{o.title}</div>
          <div className="flex items-center gap-0.5 text-muted-foreground">
            <Mono>{o.order_no}</Mono>
            <CopyButton text={o.order_no} className="size-6" />
          </div>
        </div>
      ),
    },
    { header: "类型", cell: ({ row: { original: o } }) => <span className="text-sm">{ORDER_TYPES[o.type] ?? o.type}{o.quantity > 1 ? ` × ${o.quantity}` : ""}</span> },
    { header: "支付方式", cell: ({ row: { original: o } }) => <PayMethodLabel method={o.pay_method} /> },
    {
      header: "金额",
      cell: ({ row: { original: o } }) => (
        <div className="num">
          <div className="font-medium">{money(o.pay_amount)}</div>
          {o.type === "topup" && o.face_amount !== o.pay_amount && <div className="text-xs text-muted-foreground">到账 {money(o.face_amount)}</div>}
        </div>
      ),
    },
    { header: "状态", cell: ({ row: { original: o } }) => <OrderStatusBadge status={o.status} /> },
    {
      header: "时间",
      cell: ({ row: { original: o } }) => (
        <div className="text-xs whitespace-nowrap">
          <div>{dt(o.created_at)}</div>
          {o.paid_at && <div className="text-muted-foreground">支付于 {dt(o.paid_at, "MM-DD HH:mm")}</div>}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">操作</span>,
      cell: ({ row: { original: o } }) =>
        o.status === "pending" && dayjs(o.expires_at).isAfter(dayjs()) ? (
          <div className="flex justify-end gap-1">
            <Button asChild size="sm">
              <Link to={`/pay/${o.order_no}`}>去支付</Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => cancel(o)}>
              取消
            </Button>
          </div>
        ) : o.status === "pending" ? (
          <span className="block text-right text-xs text-muted-foreground">已超时</span>
        ) : null,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="我的订单" description="充值与套餐购买订单；待支付订单 30 分钟内有效" />
      <DataTable
        columns={columns}
        data={t.items}
        loading={t.isFetching}
        total={t.total}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        rowKey={(r) => r.id}
        toolbar={
          <>
            <Select value={t.filters.type || "all"} onValueChange={(v) => t.setFilters({ type: v === "all" ? "" : v })}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {Object.entries(ORDER_TYPES).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={t.filters.status || "all"} onValueChange={(v) => t.setFilters({ status: v === "all" ? "" : v })}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {ORDER_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        empty={
          <Empty
            title="暂无订单"
            action={
              <Button asChild size="sm">
                <Link to="/console/wallet">去充值</Link>
              </Button>
            }
          />
        }
      />
    </div>
  );
}
