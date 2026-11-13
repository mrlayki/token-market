/** 控制台通用数据 hooks 与计算工具 */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Announcement, MarketModel, Marketplace, PackageProduct, PriceView } from "@/api/types";
import { useAuth } from "../auth";
import { useSite } from "../site";

// ---------------------------------------------------------------- 本地扩展类型
export interface WalletInfo {
  balance: number;
  frozen: number;
  realtime: boolean;
  total_recharged: number;
  total_consumed: number;
}

export interface OverviewPackage {
  id: number;
  name: string;
  total_tokens: number;
  remaining_tokens: number;
  expires_at: string;
  scope_type: "all" | "models" | "vendors";
  scope_values: string[];
}

export interface Overview {
  wallet: WalletInfo;
  packages: OverviewPackage[];
  today: { requests: number; prompt_tokens: number; completion_tokens: number; wallet_amount: number; package_tokens: number };
  token_count: number;
  group: string;
  request_count: number;
}

export interface UsageStats {
  trend: { day: string; requests: number; prompt_tokens: number; completion_tokens: number; wallet_amount: number; package_tokens: number; amount: number }[];
  by_model: { model: string; requests: number; tokens: number; amount: number }[];
}

export interface TopupQuote {
  face_amount: number;
  pay_amount: number;
  detail: { amount_yuan: string; group: string; group_topup_ratio: string; discount: string };
}

export type RedeemResult = { type: "quota"; amount: number } | { type: "package"; package: string; tokens: number };

// ---------------------------------------------------------------- 查询 key（便于统一失效）
export const QK = {
  overview: ["console", "overview"] as const,
  wallet: ["console", "wallet"] as const,
  usage: (days: number) => ["console", "usage", days] as const,
  market: ["public", "models"] as const,
  products: ["public", "packages"] as const,
  announcements: ["public", "announcements"] as const,
};

/** 资金变动后刷新相关数据 */
export function invalidateMoney(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["console"] });
  qc.invalidateQueries({ queryKey: ["/api/console/packages"] });
  qc.invalidateQueries({ queryKey: ["/api/console/orders"] });
  qc.invalidateQueries({ queryKey: ["/api/console/ledger"] });
}

export function useMarketplace() {
  return useQuery({ queryKey: QK.market, queryFn: () => api.get<Marketplace>("/api/public/models"), staleTime: 60_000 });
}

export function useProducts() {
  return useQuery({
    queryKey: QK.products,
    queryFn: () => api.get<(PackageProduct & { bought: number })[]>("/api/console/package-products"),
    staleTime: 30_000,
  });
}

export interface MyGroup {
  name: string;
  display_name: string;
  price_ratio: string;
  description: string;
  is_default: boolean;
}

export function useMyGroups() {
  return useQuery({ queryKey: ["my-groups"], queryFn: () => api.get<MyGroup[]>("/api/console/groups"), staleTime: 300_000 });
}

export function useAnnouncements() {
  return useQuery({ queryKey: QK.announcements, queryFn: () => api.get<Announcement[]>("/api/public/announcements"), staleTime: 60_000 });
}

export function useWallet() {
  return useQuery({ queryKey: QK.wallet, queryFn: () => api.get<WalletInfo>("/api/console/wallet") });
}

export function useOverview() {
  return useQuery({ queryKey: QK.overview, queryFn: () => api.get<Overview>("/api/console/overview") });
}

export function useUsageStats(days: number) {
  return useQuery({ queryKey: QK.usage(days), queryFn: () => api.get<UsageStats>("/api/console/usage/stats", { days }) });
}

/** API 基础地址：站点配置优先，否则使用当前域名 */
export function useBaseUrl() {
  const site = useSite();
  const configured = site.data?.["site.api_base_url"]?.trim();
  return (configured || window.location.origin).replace(/\/+$/, "");
}

export function useCurrency() {
  const site = useSite();
  return site.data?.["billing.currency_symbol"] || "¥";
}

/** 当前用户所在分组倍率 */
export function useMyGroupRatio(): { group: string; ratio: number; label: string } {
  const user = useAuth((s) => s.user);
  const mk = useMarketplace();
  const g = mk.data?.groups.find((x) => x.name === (user?.group ?? "default"));
  return { group: g?.name ?? user?.group ?? "default", ratio: g ? Number(g.price_ratio) : 1, label: g?.display_name ?? user?.group ?? "default" };
}

// ---------------------------------------------------------------- 价格计算
export function scalePrice(p: PriceView, ratio: number): PriceView {
  return {
    ...p,
    input_price: Math.round(p.input_price * ratio),
    output_price: Math.round(p.output_price * ratio),
    cache_read_price: Math.round(p.cache_read_price * ratio),
    cache_write_price: Math.round(p.cache_write_price * ratio),
    per_call_price: Math.round(p.per_call_price * ratio),
  };
}

/** 预估费用（微元） */
export function estimateCost(m: MarketModel | undefined, ratio: number, usage: { prompt: number; completion: number; cached?: number }): number | null {
  if (!m) return null;
  const p = m.price;
  if (p.billing_type === "per_call") return Math.round(p.per_call_price * ratio);
  const cached = usage.cached ?? 0;
  const cacheRate = p.cache_read_price > 0 ? p.cache_read_price : p.input_price;
  const raw = ((usage.prompt - cached) * p.input_price + cached * cacheRate + usage.completion * p.output_price) / 1_000_000;
  return Math.round(raw * ratio);
}

export function ratioText(r: number | string): string {
  const n = Number(r);
  return `x${parseFloat(n.toFixed(4))}`;
}

/** 权重字符串 "4.0000" → 4 */
export function weight(v: string | number): number {
  return parseFloat(Number(v).toFixed(4));
}
