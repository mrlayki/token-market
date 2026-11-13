import type { TimeRule } from "@/api/types";
/** 管理端专用类型（与 server/app/api/admin/*.py 对应）。金额单位均为微元。 */

export interface ChannelType {
  value: string;
  label: string;
  provider: string;
  base_url: string;
}

export interface Channel {
  id: number;
  name: string;
  type: string;
  base_url: string;
  status: 1 | 2 | 3;
  status_reason: string;
  status_changed_at: string | null;
  models: string[];
  model_mapping: Record<string, string>;
  groups: string[];
  priority: number;
  weight: number;
  multi_key_mode: "random" | "polling";
  auto_ban: boolean;
  test_model: string;
  cost_ratio: number | string;
  cost_time_rules?: TimeRule[];
  param_override: Record<string, unknown>;
  header_override: Record<string, string>;
  tag: string;
  remark: string;
  response_time_ms: number;
  tested_at: string | null;
  balance: number | string | null;
  balance_currency: string;
  balance_updated_at: string | null;
  used_amount: number;
  request_count: number;
  created_at: string;
  key_total: number;
  key_enabled: number;
}

export interface ChannelKey {
  id: number;
  key_mask: string;
  status: 1 | 2 | 3;
  status_reason: string;
  status_changed_at: string | null;
  request_count: number;
  created_at: string;
}

export interface ChannelTestResult {
  ok: boolean;
  message: string;
  status?: number;
  elapsed_ms?: number;
  model?: string;
  key_id?: number;
  channel_id?: number;
}

export interface Vendor {
  id: number;
  name: string;
  display_name: string;
  icon: string;
  description: string;
  sort: number;
  enabled: boolean;
  model_count: number;
}

export interface PriceVersion {
  id: number;
  billing_type: "token" | "per_call";
  input_price: number;
  output_price: number;
  cache_read_price: number;
  cache_write_price: number;
  per_call_price: number;
  effective_at: string;
  time_rules?: TimeRule[];
  remark: string;
}

export type ModelMode = "chat" | "embedding" | "image" | "audio";

export interface ModelMetaIn {
  name: string;
  vendor_id: number | null;
  display_name: string;
  description: string;
  icon: string;
  tags: string[];
  mode: ModelMode;
  endpoints: string[];
  context_length: number;
  max_output_tokens: number;
  listed: boolean;
  sort: number;
}

export interface ModelMeta extends ModelMetaIn {
  id: number;
  created_at: string;
  price: PriceVersion | null;
  pending_price: PriceVersion | null;
  channel_count: number;
  channels: ModelChannel[];
}

/** 提供某个模型的渠道（模型管理页展示路由关系） */
export interface ModelChannel {
  id: number;
  name: string;
  type: string;
  status: number;
  priority: number;
  weight: number;
  groups: string[];
  upstream_model: string;
}

export interface Group {
  name: string;
  display_name: string;
  description: string;
  price_ratio: string;
  topup_ratio: string;
  usable_groups: string[];
  sort: number;
  user_count: number;
}

export interface AdminUser {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  role: "user" | "admin" | "root";
  group: string;
  status: number;
  remark: string;
  request_count: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  balance: number;
  total_recharged: number;
  total_consumed: number;
}

export interface UserDetail {
  user: AdminUser;
  live: { bal: number; frz: number; loaded: boolean; pkgs: Record<string, number> } | null;
}

export interface RedemptionCode {
  id: number;
  code: string;
  name: string;
  batch_no: string;
  type: "quota" | "package";
  quota_amount: number;
  package_product_id: number | null;
  status: 1 | 2 | 3;
  expires_at: string | null;
  used_by: number | null;
  used_at: string | null;
  created_at: string;
}

export interface ReconReport {
  id: number;
  kind: "ledger_vs_balance" | "calllog_vs_ledger" | "redis_vs_db";
  status: "ok" | "mismatch";
  period_start: string | null;
  period_end: string | null;
  checked: number;
  mismatched: number;
  summary: Record<string, unknown>;
  diffs: Record<string, unknown>[];
  resolved: boolean;
  created_at: string;
}

export interface AuditLog {
  id: number;
  operator_id: number | null;
  operator_name: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: Record<string, unknown>;
  ip: string;
  created_at: string;
}

export interface SettingItem {
  key: string;
  value: unknown;
  default: unknown;
  group: string;
  description: string;
}

export interface UsageAgg {
  requests: number;
  failed: number;
  prompt_tokens: number;
  completion_tokens: number;
  amount: number;
  wallet_amount: number;
  cost: number;
  package_tokens: number;
  gross_profit: number;
}

export interface Dashboard {
  range_days: number;
  total: UsageAgg;
  today: UsageAgg;
  trend: (UsageAgg & { t: string })[];
  top_models: (UsageAgg & { model: string })[];
  top_users: (UsageAgg & { user_id: number; username: string })[];
  top_channels: (UsageAgg & { channel_id: number; name: string })[];
  orders: { paid_amount: number; paid_count: number; paid_amount_today: number };
  users: { total: number; new_today: number };
  wallet_balance_total: number;
  channels: { total: number; enabled: number };
  realtime: { rpm: number; tpm: number };
  unread_notifications: number;
}

export interface SystemHealth {
  postgres: { ok: boolean; error?: string };
  redis: { ok: boolean; used_memory_human?: string; error?: string };
  usage_stream?: { length: number; groups: { name: string; pending: number; lag: number | null }[]; dlq: number };
  reservations_inflight?: number;
  outbox_pending: number;
  config: { quota_mode: string; redis_fail_mode: string };
}
