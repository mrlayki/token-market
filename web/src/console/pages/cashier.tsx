import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, ScanLine, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { CopyButton, confirm } from "@/components/misc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorMessage, toastError } from "@/lib/api";
import { dayjs, dt, money } from "@/lib/format";
import type { Order } from "@/api/types";
import { useAuth } from "../auth";
import { invalidateMoney } from "../lib/data";
import { ORDER_TYPES, PAY_METHODS, PayMethodIcon } from "../lib/labels";

export default function CashierPage() {
  const token = useAuth((s) => s.token);
  const loc = useLocation();
  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <Cashier />;
}

function useCountdown(target?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return { left: 0, text: "--:--" };
  const left = Math.max(0, Math.floor((dayjs(target).valueOf() - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return { left, text: `${mm}:${ss}` };
}

function Cashier() {
  const { orderNo = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["console", "order", orderNo],
    queryFn: () => api.get<Order>(`/api/console/orders/${orderNo}`),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 2000 : false),
  });
  const o = q.data;
  const cd = useCountdown(o?.expires_at);
  const done = o?.status === "paid" || o?.status === "fulfilled";

  useEffect(() => {
    if (done) invalidateMoney(qc);
  }, [done, qc]);

  const pay = useMutation({
    mutationFn: () => api.post<Order>(`/api/console/orders/${orderNo}/mock-pay`),
    onSuccess: (r) => {
      qc.setQueryData(["console", "order", orderNo], r);
      toast.success("支付成功");
    },
    onError: toastError,
  });
  const cancel = useMutation({
    mutationFn: () => api.post<Order>(`/api/console/orders/${orderNo}/cancel`),
    onSuccess: (r) => {
      qc.setQueryData(["console", "order", orderNo], r);
      qc.invalidateQueries({ queryKey: ["/api/console/orders"] });
      toast.success("订单已取消");
    },
    onError: toastError,
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <Skeleton className="h-[560px] rounded-2xl" />
      </div>
    );
  }
  if (q.error || !o) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Shell>
        <ResultState icon={<XCircle className="size-12 text-destructive" />} title={notFound ? "订单不存在" : "加载订单失败"} desc={errorMessage(q.error)}>
          <Button asChild variant="outline">
            <Link to="/console/orders">查看我的订单</Link>
          </Button>
        </ResultState>
      </Shell>
    );
  }

  const method = PAY_METHODS[o.pay_method] ?? PAY_METHODS.alipay;
  const expired = o.status === "pending" && cd.left <= 0;
  const backTo = o.type === "package" ? "/console/packages?tab=mine" : "/console/wallet";

  return (
    <Shell>
      <Card className="overflow-hidden py-0">
        {/* 品牌头 */}
        <div className="flex items-center justify-between px-6 py-4 text-white" style={{ background: o.pay_method === "balance" ? "var(--primary)" : method.color }}>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-white/95 text-base font-bold" style={{ color: o.pay_method === "balance" ? "var(--primary)" : method.color }}>
              {method.short}
            </span>
            <div className="leading-tight">
              <div className="font-semibold">{method.label}</div>
              <div className="text-xs text-white/80">收银台</div>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-white/85">
            <ShieldCheck className="size-3.5" /> 安全支付
          </div>
        </div>

        <CardContent className="px-6 pt-6 pb-6">
          <div className="text-center">
            <div className="text-sm text-muted-foreground">{o.title}</div>
            <div className="num mt-1 text-4xl font-semibold tracking-tight">{money(o.pay_amount)}</div>
            {o.face_amount > 0 && o.face_amount !== o.pay_amount && (
              <div className="mt-1 text-xs text-muted-foreground">
                到账 <span className="num font-medium text-foreground">{money(o.face_amount)}</span>
                <span className="ml-2 text-success">已优惠 {money(o.face_amount - o.pay_amount)}</span>
              </div>
            )}
          </div>

          <div className="mt-6">
            {done ? (
              <ResultState icon={<CheckCircle2 className="size-14 text-success" />} title="支付成功" desc={o.type === "package" ? "套餐已发放到你的账户，可立即使用" : `${money(o.face_amount)} 已充值到账户余额`}>
                <Button asChild>
                  <Link to={backTo}>{o.type === "package" ? "查看我的套餐" : "返回钱包"}</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/console">返回控制台</Link>
                </Button>
              </ResultState>
            ) : o.status === "closed" || o.status === "refunded" || expired ? (
              <ResultState icon={<XCircle className="size-14 text-muted-foreground" />} title={expired ? "订单已超时" : o.status === "refunded" ? "订单已退款" : "订单已关闭"} desc={o.remark || "如需继续购买，请重新下单"}>
                <Button asChild>
                  <Link to={o.type === "package" ? "/console/packages" : "/console/wallet"}>重新下单</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/console/orders">我的订单</Link>
                </Button>
              </ResultState>
            ) : (
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="size-4" />
                  请在 <span className="num font-semibold text-destructive">{cd.text}</span> 内完成支付
                </div>
                <div className="relative mt-4 rounded-xl border-2 bg-white p-3" style={{ borderColor: method.color }}>
                  <FakeQr seed={o.order_no} />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <PayMethodIcon method={o.pay_method} size={36} />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-sm">
                  <ScanLine className="size-4" style={{ color: method.color }} />
                  请使用 <span className="font-medium">{o.pay_method === "wechat" ? "微信" : "支付宝"}</span> 扫一扫
                </div>
                <div className="mt-4 w-full rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
                  演示环境：点击下方按钮模拟扫码支付
                </div>
                <Button className="mt-3 h-11 w-full text-base text-white hover:opacity-90" style={{ background: method.color }} disabled={pay.isPending} onClick={() => pay.mutate()}>
                  {pay.isPending && <Loader2 className="animate-spin" />}
                  模拟支付 {money(o.pay_amount)}
                </Button>
                <div className="mt-3 flex w-full items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin" /> 正在等待支付结果…
                  </span>
                  <button
                    type="button"
                    className="hover:text-destructive"
                    disabled={cancel.isPending}
                    onClick={async () => {
                      if (await confirm({ title: "取消订单？", description: "取消后该订单将无法继续支付。", confirmText: "取消订单", danger: true })) cancel.mutate();
                    }}
                  >
                    取消订单
                  </button>
                </div>
              </div>
            )}
          </div>

          <Separator className="my-6" />
          <OrderInfo o={o} />
        </CardContent>
      </Card>
      <div className="mt-4 text-center">
        <Button variant="link" size="sm" className="text-muted-foreground" onClick={() => nav("/console/orders")}>
          查看全部订单
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-md px-4 py-10 sm:py-14">{children}</div>;
}

function ResultState({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center py-4 text-center">
      {icon}
      <div className="mt-3 text-lg font-semibold">{title}</div>
      {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

function OrderInfo({ o }: { o: Order }) {
  const rows: [string, React.ReactNode][] = [
    [
      "订单号",
      <span className="inline-flex items-center gap-1 font-mono text-xs">
        {o.order_no}
        <CopyButton text={o.order_no} className="size-6" />
      </span>,
    ],
    ["订单类型", ORDER_TYPES[o.type] ?? o.type],
    ["支付方式", PAY_METHODS[o.pay_method]?.label ?? o.pay_method],
    ["创建时间", dt(o.created_at)],
  ];
  if (o.paid_at) rows.push(["支付时间", dt(o.paid_at)]);
  if (o.trade_no) rows.push(["交易流水号", <span className="font-mono text-xs">{o.trade_no}</span>]);
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 仿二维码占位图（基于订单号生成的确定性图案，仅用于演示） */
function FakeQr({ seed, size = 25 }: { seed: string; size?: number }) {
  const cells = useMemo(() => {
    let h = 2166136261;
    for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const rnd = () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return ((h >>> 0) % 1000) / 1000;
    };
    const out: [number, number][] = [];
    const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
    const center = (x: number, y: number) => Math.abs(x - size / 2 + 0.5) < 4 && Math.abs(y - size / 2 + 0.5) < 4;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!inFinder(x, y) && !center(x, y) && rnd() > 0.52) out.push([x, y]);
    return out;
  }, [seed, size]);
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} fill="#111" />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="#111" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-48" shapeRendering="crispEdges" aria-label="支付二维码（演示）">
      <rect width={size} height={size} fill="#fff" />
      {cells.map(([x, y]) => (
        <rect key={`${x}_${y}`} x={x} y={y} width={1} height={1} fill="#111" />
      ))}
      {finder(0, 0)}
      {finder(size - 7, 0)}
      {finder(0, size - 7)}
    </svg>
  );
}
