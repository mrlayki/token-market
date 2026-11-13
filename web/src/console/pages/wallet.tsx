import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Gift, Loader2, Lock, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { Empty, PageHeader, Section, StatCard } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, toastError } from "@/lib/api";
import { compact, dt, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LedgerEntry, Order, Page } from "@/api/types";
import { invalidateMoney, type RedeemResult, type TopupQuote, useWallet } from "../lib/data";
import { bizLabel, PAY_METHODS, PayMethodIcon } from "../lib/labels";
import { useSite } from "../site";

function useDebounced<T>(v: T, ms = 400) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function WalletPage() {
  const w = useWallet();
  const site = useSite();
  const qc = useQueryClient();
  const nav = useNavigate();
  const cfg = site.data;
  const options = cfg?.["payment.topup_options"] ?? [];
  const methods = (cfg?.["payment.methods"] ?? []).filter((m) => m === "alipay" || m === "wechat");
  const min = cfg?.["payment.min_topup"] ?? 1;
  const max = cfg?.["payment.max_topup"] ?? 50000;
  const discounts = cfg?.["payment.discounts"] ?? {};

  const [amount, setAmount] = useState<string>("");
  const [custom, setCustom] = useState(false);
  const [method, setMethod] = useState<string>("");
  useEffect(() => {
    if (!amount && options.length) setAmount(String(options[Math.min(1, options.length - 1)]));
  }, [options, amount]);
  useEffect(() => {
    if (!method && methods.length) setMethod(methods[0]);
  }, [methods, method]);

  const n = Number(amount);
  const valid = amount !== "" && Number.isFinite(n) && n >= min && n <= max && /^\d+(\.\d{1,2})?$/.test(amount);
  const dAmount = useDebounced(valid ? amount : "", 350);
  const quote = useQuery({
    queryKey: ["console", "quote", dAmount],
    queryFn: () => api.post<TopupQuote>("/api/console/topup/quote", { amount: dAmount }),
    enabled: !!dAmount,
    staleTime: 60_000,
  });
  const q = quote.data && quote.data.detail.amount_yuan && Number(quote.data.detail.amount_yuan) === n ? quote.data : undefined;

  const order = useMutation({
    mutationFn: () => api.post<{ order: Order }>("/api/console/orders", { type: "topup", pay_method: method, amount }),
    onSuccess: (r) => nav(`/pay/${r.order.order_no}`),
    onError: toastError,
  });

  const [code, setCode] = useState("");
  const redeem = useMutation({
    mutationFn: () => api.post<RedeemResult>("/api/console/redeem", { code: code.trim() }),
    onSuccess: (r) => {
      setCode("");
      invalidateMoney(qc);
      if (r.type === "quota") toast.success(`兑换成功，${money(r.amount)} 已到账`);
      else toast.success(`兑换成功，已获得套餐「${r.package}」（${compact(r.tokens)} tokens）`);
    },
    onError: toastError,
  });

  const ledger = useQuery({
    queryKey: ["/api/console/ledger", "wallet-recent"],
    queryFn: () => api.get<Page<LedgerEntry>>("/api/console/ledger", { bucket_type: "wallet", page_size: 10 }),
  });

  const discount = q ? Number(q.detail.discount) : 1;
  const gRatio = q ? Number(q.detail.group_topup_ratio) : 1;
  const tiers = Object.entries(discounts)
    .map(([k, v]) => [Number(k), Number(v)] as const)
    .sort((a, b) => a[0] - b[0]);

  const columns: ColumnDef<LedgerEntry>[] = [
    { header: "时间", cell: ({ row: { original: r } }) => <span className="text-xs whitespace-nowrap text-muted-foreground">{dt(r.created_at)}</span> },
    { header: "类型", cell: ({ row: { original: r } }) => <Badge variant="secondary" className="font-normal">{bizLabel(r.biz_type)}</Badge> },
    {
      header: "金额",
      cell: ({ row: { original: r } }) => (
        <span className={cn("num font-medium", r.amount >= 0 ? "text-success" : "text-foreground")}>
          {r.amount >= 0 ? "+" : ""}
          {money(r.amount)}
        </span>
      ),
    },
    { header: "备注", cell: ({ row: { original: r } }) => <span className="text-xs text-muted-foreground">{r.remark || "-"}</span> },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="钱包充值" description="余额用于按量调用，长期有效；也可使用兑换码充值" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="可用余额" icon={<Wallet />} loading={w.isLoading} value={money(w.data?.balance)} className="border-primary/30 bg-primary/[0.03]" />
        <StatCard label="冻结中" icon={<Lock />} loading={w.isLoading} value={money(w.data?.frozen)} hint="进行中请求的预扣金额，结算后释放" />
        <StatCard label="累计充值" icon={<TrendingUp />} loading={w.isLoading} value={money(w.data?.total_recharged)} />
        <StatCard label="累计消费" icon={<TrendingDown />} loading={w.isLoading} value={money(w.data?.total_consumed)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Section title="在线充值" description={`单笔 ¥${min} - ¥${max.toLocaleString()}`}>
          {site.isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="space-y-6">
              <div>
                <div className="mb-2 text-sm font-medium">充值金额</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {options.map((o) => {
                    const off = tiers.filter(([k]) => o >= k).pop();
                    const active = !custom && Number(amount) === o;
                    return (
                      <button
                        key={o}
                        type="button"
                        onClick={() => {
                          setCustom(false);
                          setAmount(String(o));
                        }}
                        className={cn(
                          "relative rounded-lg border px-3 py-3 text-left transition-colors",
                          active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-foreground/20",
                        )}
                      >
                        <div className="num text-lg font-semibold">¥{o.toLocaleString()}</div>
                        {off && off[1] < 1 && <div className="text-xs text-success">{parseFloat((off[1] * 10).toFixed(2))} 折</div>}
                        {active && <Check className="absolute top-2 right-2 size-4 text-primary" />}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setCustom(true);
                      setAmount("");
                    }}
                    className={cn("rounded-lg border px-3 py-3 text-left text-sm transition-colors", custom ? "border-primary bg-primary/5 ring-1 ring-primary" : "text-muted-foreground hover:border-foreground/20")}
                  >
                    自定义
                    <div className="text-xs">金额</div>
                  </button>
                </div>
                {custom && (
                  <div className="relative mt-3 max-w-xs">
                    <span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">¥</span>
                    <Input autoFocus type="number" min={min} max={max} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`${min} - ${max}`} className="h-10 pl-7 text-base" />
                  </div>
                )}
                {amount !== "" && !valid && <p className="mt-2 text-xs text-destructive">请输入 ¥{min} - ¥{max} 之间的金额（最多两位小数）</p>}
                {tiers.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    充值优惠：{tiers.map(([k, v]) => `满 ¥${k} 享 ${parseFloat((v * 10).toFixed(2))} 折`).join("，")}
                  </p>
                )}
              </div>

              <div>
                <div className="mb-2 text-sm font-medium">支付方式</div>
                {methods.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {methods.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMethod(m)}
                        className={cn("flex items-center gap-3 rounded-lg border p-3 text-left transition-colors", method === m ? "ring-1" : "hover:border-foreground/20")}
                        style={method === m ? { borderColor: PAY_METHODS[m].color, boxShadow: `0 0 0 1px ${PAY_METHODS[m].color}` } : undefined}
                      >
                        <PayMethodIcon method={m} size={28} />
                        <span className="font-medium">{PAY_METHODS[m].label}</span>
                        <span className={cn("ml-auto flex size-4 items-center justify-center rounded-full border", method === m && "border-transparent")} style={method === m ? { background: PAY_METHODS[m].color } : undefined}>
                          {method === m && <Check className="size-3 text-white" />}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">暂未开通在线支付，请使用兑换码充值或联系管理员。</p>
                )}
              </div>

              <div className="flex flex-col gap-4 rounded-xl bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="text-muted-foreground">应付金额</span>
                    {quote.isFetching && !q ? (
                      <Skeleton className="h-7 w-24" />
                    ) : (
                      <span className="num text-2xl font-semibold">{q ? money(q.pay_amount) : valid ? `¥${n.toFixed(2)}` : "-"}</span>
                    )}
                  </div>
                  {q && (
                    <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>
                        到账 <span className="num text-foreground">{money(q.face_amount)}</span>
                      </span>
                      {discount !== 1 && <span className="text-success">充值折扣 {parseFloat((discount * 10).toFixed(2))} 折</span>}
                      {gRatio !== 1 && <span className="text-success">分组充值倍率 x{parseFloat(gRatio.toFixed(4))}</span>}
                      {q.face_amount > q.pay_amount && <span className="text-success">立省 {money(q.face_amount - q.pay_amount)}</span>}
                    </div>
                  )}
                </div>
                <Button size="lg" className="h-11 px-8" disabled={!valid || !method || order.isPending} onClick={() => order.mutate()}>
                  {order.isPending && <Loader2 className="animate-spin" />}
                  立即充值
                </Button>
              </div>
            </div>
          )}
        </Section>

        <div className="space-y-6">
          <Section title="兑换码" description="使用兑换码充值余额或领取套餐">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim().length >= 4) redeem.mutate();
              }}
            >
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="TM-XXXX-XXXX-XXXX-XXXX" className="font-mono" />
              <Button type="submit" className="w-full" variant="secondary" disabled={code.trim().length < 4 || redeem.isPending}>
                {redeem.isPending ? <Loader2 className="animate-spin" /> : <Gift />}
                立即兑换
              </Button>
            </form>
          </Section>
          <Section title="说明">
            <ul className="space-y-2 text-xs leading-5 text-muted-foreground">
              <li>· 余额长期有效，可用于所有模型的按量调用。</li>
              <li>· 若有适用的套餐包，调用时优先抵扣套餐，不足部分再扣余额。</li>
              <li>· 订单 30 分钟内未支付将自动关闭，可在「我的订单」中继续支付。</li>
              <li>
                · 查看完整收支请前往{" "}
                <Link to="/console/billing" className="text-primary hover:underline">
                  账单明细
                </Link>
                。
              </li>
            </ul>
          </Section>
        </div>
      </div>

      <Section
        title="最近余额变动"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/console/billing?bucket_type=wallet">查看全部</Link>
          </Button>
        }
      >
        <DataTable
          columns={columns}
          data={ledger.data?.items}
          loading={ledger.isLoading}
          empty={<Empty title="暂无余额变动" />}
          rowKey={(r) => r.id}
        />
      </Section>
    </div>
  );
}
