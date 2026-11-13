import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, Check, Loader2, Minus, Plus, ShoppingCart, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { Empty, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, toastError } from "@/lib/api";
import { compact, dt, fromNow, money, pricePerM } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, PackageProduct, UserPackage } from "@/api/types";
import { useTableQuery } from "@/hooks/use-table-query";
import { PackageScope, TokenProgress, weightNote } from "../components/scope";
import { invalidateMoney, useProducts, useWallet } from "../lib/data";
import { PAY_METHODS, PackageStatusBadge, PayMethodIcon } from "../lib/labels";
import { useSite } from "../site";

export default function PackagesPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "mine" ? "mine" : "store";
  const setTab = (t: string) => setSp(t === "mine" ? { tab: "mine" } : {}, { replace: true });
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="套餐包" description="预付 token 套餐，单价更低；调用适用模型时优先抵扣套餐，按到期时间先后使用" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="store">套餐商店</TabsTrigger>
          <TabsTrigger value="mine">我的套餐</TabsTrigger>
        </TabsList>
        <TabsContent value="store" className="mt-5">
          <Store onBought={() => setTab("mine")} />
        </TabsContent>
        <TabsContent value="mine" className="mt-5">
          <Mine />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------- 商店
function Store({ onBought }: { onBought: () => void }) {
  const products = useProducts();
  const [buying, setBuying] = useState<PackageProduct | null>(null);
  if (products.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-96 rounded-xl" />
        ))}
      </div>
    );
  }
  if (!products.data?.length) return <Empty title="暂无在售套餐" description="敬请期待" />;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {products.data.map((p) => (
          <ProductCard key={p.id} p={p} onBuy={() => setBuying(p)} />
        ))}
      </div>
      <BuyDialog product={buying} onClose={() => setBuying(null)} onBought={onBought} />
    </>
  );
}

function ProductCard({ p, onBuy }: { p: PackageProduct; onBuy: () => void }) {
  const unit = p.tokens > 0 ? Math.round((p.price * 1_000_000) / p.tokens) : 0;
  const note = weightNote(p.input_weight, p.output_weight);
  const off = p.original_price > p.price ? Math.round((1 - p.price / p.original_price) * 100) : 0;
  return (
    <div className={cn("relative flex flex-col overflow-hidden rounded-xl border bg-card p-6 transition-shadow hover:shadow-lg hover:shadow-primary/5", p.badge && "border-primary/40")}>
      {p.badge && (
        <div className="absolute top-5 -right-10 w-36 rotate-45 bg-primary py-1 text-center text-xs font-medium text-primary-foreground shadow-sm">{p.badge}</div>
      )}
      <div className="pr-10">
        <h3 className="text-lg font-semibold">{p.name}</h3>
        {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
      </div>
      <div className="mt-5 flex items-baseline gap-2">
        <span className="num text-3xl font-semibold tracking-tight">{money(p.price)}</span>
        {p.original_price > p.price && <span className="num text-sm text-muted-foreground line-through">{money(p.original_price)}</span>}
        {off > 0 && (
          <Badge variant="secondary" className="bg-destructive/10 font-normal text-destructive">
            省 {off}%
          </Badge>
        )}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        <span className="num text-base font-semibold text-foreground">{compact(p.tokens)}</span> tokens · 折合 <span className="num text-foreground">{pricePerM(unit)}</span> / 1M tokens
      </div>

      <div className="mt-5 space-y-3 border-t pt-5 text-sm">
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">适用模型</div>
          <PackageScope type={p.scope_type} values={p.scope_values} />
        </div>
        <ul className="space-y-1.5">
          <li className="flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" /> 有效期 {p.valid_days} 天（购买后立即生效）
          </li>
          <li className="flex items-center gap-2">
            <Check className="size-4 text-success" />
            {note ?? "输入、输出 token 按 1:1 计量"}
          </li>
          {p.limit_per_user > 0 && (
            <li className="flex items-center gap-2">
              <Sparkles className="size-4 text-warning" /> 每人限购 {p.limit_per_user} 份
              {"bought" in p && (p as PackageProduct & { bought: number }).bought > 0 && (
                <span className="text-muted-foreground">（已购 {(p as PackageProduct & { bought: number }).bought} 份）</span>
              )}
            </li>
          )}
        </ul>
      </div>
      <div className="mt-auto pt-6">
        {(() => {
          const soldOut = p.limit_per_user > 0 && ((p as PackageProduct & { bought?: number }).bought ?? 0) >= p.limit_per_user;
          return (
            <Button className="w-full" size="lg" variant={p.badge ? "default" : "outline"} onClick={onBuy} disabled={soldOut}>
              <ShoppingCart /> {soldOut ? "已达限购数量" : "立即购买"}
            </Button>
          );
        })()}
        {p.sold_count > 0 && <div className="mt-2 text-center text-xs text-muted-foreground">已售 {p.sold_count} 份</div>}
      </div>
    </div>
  );
}

function BuyDialog({ product, onClose, onBought }: { product: PackageProduct | null; onClose: () => void; onBought: () => void }) {
  const site = useSite();
  const w = useWallet();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [qty, setQty] = useState(1);
  const methods = [...(site.data?.["payment.methods"] ?? []).filter((m) => m === "alipay" || m === "wechat"), "balance"];
  const [method, setMethod] = useState("balance");
  useEffect(() => {
    if (product) {
      setQty(1);
      setMethod("balance");
    }
  }, [product]);

  const maxQty = product?.limit_per_user
    ? Math.max(product.limit_per_user - ((product as PackageProduct & { bought?: number }).bought ?? 0), 1)
    : 100;
  const total = (product?.price ?? 0) * qty;
  const balance = w.data?.balance ?? 0;
  const insufficient = method === "balance" && balance < total;

  const buy = useMutation({
    mutationFn: () => api.post<{ order: Order }>("/api/console/orders", { type: "package", pay_method: method, product_id: product!.id, quantity: qty }),
    onSuccess: (r) => {
      if (method === "balance") {
        invalidateMoney(qc);
        toast.success(`购买成功，「${product!.name}」已发放到账户`);
        onClose();
        onBought();
      } else {
        nav(`/pay/${r.order.order_no}`);
      }
    },
    onError: toastError,
  });

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>购买套餐</DialogTitle>
          <DialogDescription>{product?.name}</DialogDescription>
        </DialogHeader>
        {product && (
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm">
              <div>
                <div className="font-medium">{compact(product.tokens)} tokens</div>
                <div className="text-xs text-muted-foreground">有效期 {product.valid_days} 天</div>
              </div>
              <div className="num font-semibold">{money(product.price)}</div>
            </div>
            {maxQty > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">购买数量</span>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="icon" className="size-8" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>
                    <Minus />
                  </Button>
                  <Input
                    type="number"
                    value={qty}
                    min={1}
                    max={maxQty}
                    onChange={(e) => setQty(Math.max(1, Math.min(maxQty, Math.floor(Number(e.target.value) || 1))))}
                    className="h-8 w-16 text-center"
                  />
                  <Button type="button" variant="outline" size="icon" className="size-8" disabled={qty >= maxQty} onClick={() => setQty(qty + 1)}>
                    <Plus />
                  </Button>
                </div>
              </div>
            )}
            {product.limit_per_user > 0 && <p className="-mt-3 text-xs text-muted-foreground">每人限购 {product.limit_per_user} 份（含已购买）</p>}
            <div className="space-y-2">
              <div className="text-sm font-medium">支付方式</div>
              {methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn("flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors", method === m ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-foreground/20")}
                >
                  <PayMethodIcon method={m} size={24} />
                  <span className="font-medium">{PAY_METHODS[m].label}</span>
                  {m === "balance" && (
                    <span className={cn("ml-auto text-xs", balance < total ? "text-destructive" : "text-muted-foreground")}>
                      {w.isLoading ? "…" : `可用 ${money(balance)}`}
                      {balance < total && "（不足）"}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-baseline justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">应付</span>
              <span className="num text-2xl font-semibold">{money(total)}</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          {insufficient ? (
            <Button onClick={() => nav("/console/wallet")}>余额不足，去充值</Button>
          ) : (
            <Button disabled={buy.isPending} onClick={() => buy.mutate()}>
              {buy.isPending && <Loader2 className="animate-spin" />}
              {method === "balance" ? "确认支付" : "去支付"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 我的套餐
function Mine() {
  const t = useTableQuery<UserPackage, { status: string }>("/api/console/packages", { status: "" });
  const columns: ColumnDef<UserPackage>[] = [
    {
      header: "套餐",
      cell: ({ row: { original: p } }) => (
        <div>
          <div className="font-medium">{p.name}</div>
          <div className="text-xs text-muted-foreground">{weightNote(p.input_weight, p.output_weight) ?? "输入输出 1:1 计量"}</div>
        </div>
      ),
    },
    { header: "剩余额度", cell: ({ row: { original: p } }) => <TokenProgress remaining={p.remaining_tokens} total={p.total_tokens} className="w-52" /> },
    { header: "状态", cell: ({ row: { original: p } }) => <PackageStatusBadge status={p.status} /> },
    { header: "适用范围", cell: ({ row: { original: p } }) => <PackageScope type={p.scope_type} values={p.scope_values} max={2} className="max-w-64" /> },
    {
      header: "有效期",
      cell: ({ row: { original: p } }) => (
        <div className="text-xs whitespace-nowrap">
          <div>
            {dt(p.starts_at, "YYYY-MM-DD")} ~ {dt(p.expires_at, "YYYY-MM-DD")}
          </div>
          {p.status === "active" && <div className="text-muted-foreground">{fromNow(p.expires_at)}到期</div>}
        </div>
      ),
    },
    { header: "来源", cell: ({ row: { original: p } }) => <span className="text-xs text-muted-foreground">{{ order: "购买", redeem: "兑换码", admin: "管理员发放", gift: "赠送" }[p.source] ?? p.source}</span> },
  ];
  return (
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
        <Select value={t.filters.status || "all"} onValueChange={(v) => t.setFilters({ status: v === "all" ? "" : v })}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">生效中</SelectItem>
            <SelectItem value="exhausted">已用完</SelectItem>
            <SelectItem value="expired">已过期</SelectItem>
            <SelectItem value="revoked">已撤销</SelectItem>
          </SelectContent>
        </Select>
      }
      empty={<Empty title="还没有套餐" description="购买套餐包，享受更低的 token 单价" />}
    />
  );
}
