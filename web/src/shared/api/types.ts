/** 与后端 Pydantic schema 对应的类型。金额字段单位均为「微元」（1 元 = 1_000_000），单价为「微元 / 百万 token」。 */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface OK {
  ok: boolean;
  message: string;
}

export type Role = "user" | "admin" | "root";

export interface UserBrief {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  role: Role;
  group: string;
  status: number;
  created_at: string;
}

export interface LoginResult {
  token: string;
  user: UserBrief;
}

export interface SiteConfig {
  "site.name": string;
  "site.logo": string;
  "site.footer": string;
  "site.about": string;
  "site.home_content": string;
  "site.api_base_url": string;
  "site.docs_url": string;
  "site.terms": string;
  "site.privacy": string;
  "auth.register_enabled": boolean;
  "auth.password_login_enabled": boolean;
  "billing.currency_symbol": string;
  "payment.methods": string[];
  "payment.topup_options": number[];
  "payment.min_topup": number;
  "payment.max_topup": number;
  "payment.discounts": Record<string, string>;
}

export interface ApiToken {
  id: number;
  user_id: number;
  name: string;
  key_mask: string;
  status: number; // 1 启用 2 禁用 3 过期 4 耗尽
  expired_at: string | null;
  unlimited: boolean;
  quota_limit: number;
  used_quota: number;
  model_limits: string[];
  allow_ips: string[];
  group: string;
  rpm_limit: number;
  accessed_at: string | null;
  created_at: string;
}

export interface ApiTokenCreated extends ApiToken {
  key: string;
}

export interface CallLog {
  id: number;
  created_at: string;
  request_id: string;
  user_id: number;
  token_name: string;
  model: string;
  group: string;
  endpoint: string;
  is_stream: boolean;
  status: "success" | "failed" | "client_abort";
  http_status: number;
  error: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  usage_estimated: boolean;
  amount: number;
  wallet_amount: number;
  package_tokens: number;
  first_token_ms: number;
  duration_ms: number;
  retry_count: number;
}

export interface AdminCallLog extends CallLog {
  channel_id: number | null;
  channel_key_id: number | null;
  upstream_model: string;
  cost: number;
  client_ip: string;
  price_snapshot: Record<string, unknown>;
  token_id: number | null;
  username: string;
}

export interface LedgerEntry {
  id: number;
  user_id: number;
  bucket_type: "wallet" | "package";
  bucket_key: string;
  package_id: number | null;
  amount: number;
  balance_after: number | null;
  biz_type: string;
  biz_id: string;
  remark: string;
  created_at: string;
}

export interface UserPackage {
  id: number;
  user_id: number;
  product_id: number | null;
  name: string;
  total_tokens: number;
  remaining_tokens: number;
  scope_type: "all" | "models" | "vendors";
  scope_values: string[];
  input_weight: string;
  output_weight: string;
  starts_at: string;
  expires_at: string;
  status: "active" | "exhausted" | "expired" | "revoked";
  source: string;
  created_at: string;
}

export interface PackageProduct {
  id: number;
  name: string;
  description: string;
  price: number;
  original_price: number;
  tokens: number;
  scope_type: "all" | "models" | "vendors";
  scope_values: string[];
  input_weight: string;
  output_weight: string;
  valid_days: number;
  limit_per_user: number;
  on_sale: boolean;
  badge: string;
  sort: number;
  sold_count: number;
}

export type OrderStatus = "pending" | "paid" | "fulfilled" | "closed" | "refunded";

export interface Order {
  id: number;
  order_no: string;
  user_id: number;
  type: "topup" | "package";
  title: string;
  face_amount: number;
  product_id: number | null;
  quantity: number;
  pay_amount: number;
  price_detail: Record<string, unknown>;
  pay_method: "alipay" | "wechat" | "balance";
  provider: string;
  status: OrderStatus;
  trade_no: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  expires_at: string;
  created_at: string;
  remark: string;
}

export interface Statement {
  id: number;
  user_id: number;
  period_type: "day" | "month";
  period_start: string;
  opening_balance: number;
  closing_balance: number;
  recharged: number;
  consumed: number;
  refunded: number;
  package_tokens: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  detail: { by_model?: Record<string, { requests: number; prompt_tokens: number; completion_tokens: number; amount: number; wallet_amount: number; package_tokens: number }> };
}

/** 分时计价规则：在指定星期与时间段内，价格 × multiplier；end <= start 表示跨零点 */
export interface TimeRule {
  name: string;
  start: string; // "HH:MM"
  end: string;
  /** ISO 星期 1=周一 … 7=周日，空表示每天 */
  days: number[];
  /** 十进制字符串，如 "2"、"0.5" */
  multiplier: string;
  tz: string;
}

export interface PriceView {
  billing_type: "token" | "per_call";
  input_price: number;
  output_price: number;
  cache_read_price: number;
  cache_write_price: number;
  per_call_price: number;
  time_rules?: TimeRule[];
}

export interface MarketModel {
  name: string;
  display_name: string;
  description: string;
  icon: string;
  tags: string[];
  mode: string;
  endpoints: string[];
  context_length: number;
  max_output_tokens: number;
  vendor: { name: string; display_name: string; icon: string } | null;
  price: PriceView;
  enable_groups: string[];
}

export interface Marketplace {
  models: MarketModel[];
  vendors: { name: string; display_name: string; icon: string }[];
  groups: { name: string; display_name: string; price_ratio: string; description: string }[];
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  level: "info" | "success" | "warning" | "error";
  pinned: boolean;
  published?: boolean;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  kind: string;
  title: string;
  content: string;
  read: boolean;
  created_at: string;
}
