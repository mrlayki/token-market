import type { Tone } from "@/components/misc";

export type LabelMap = Record<string, { label: string; tone: Tone }>;

export const CHANNEL_STATUS: LabelMap = {
  "1": { label: "启用", tone: "success" },
  "2": { label: "手动禁用", tone: "muted" },
  "3": { label: "自动禁用", tone: "warning" },
};

export const USER_STATUS: LabelMap = {
  "1": { label: "正常", tone: "success" },
  "2": { label: "禁用", tone: "danger" },
};

export const ROLE: LabelMap = {
  user: { label: "用户", tone: "muted" },
  admin: { label: "管理员", tone: "info" },
  root: { label: "超级管理员", tone: "default" },
};

export const ORDER_STATUS: LabelMap = {
  pending: { label: "待支付", tone: "warning" },
  paid: { label: "已支付未发货", tone: "danger" },
  fulfilled: { label: "已完成", tone: "success" },
  closed: { label: "已关闭", tone: "muted" },
  refunded: { label: "已退款", tone: "info" },
};

export const ORDER_TYPE: Record<string, string> = { topup: "余额充值", package: "套餐购买" };

export const PAY_METHOD: Record<string, string> = { alipay: "支付宝", wechat: "微信支付", balance: "余额" };

export const BIZ_TYPE: LabelMap = {
  consume: { label: "调用消费", tone: "muted" },
  topup: { label: "充值", tone: "success" },
  package_grant: { label: "套餐发放", tone: "info" },
  refund: { label: "退款", tone: "warning" },
  adjust: { label: "管理员调整", tone: "default" },
  redeem: { label: "兑换码", tone: "success" },
  expire: { label: "套餐过期", tone: "muted" },
  gift: { label: "赠送", tone: "success" },
  purchase: { label: "余额购买", tone: "info" },
};

export const BUCKET_TYPE: Record<string, string> = { wallet: "钱包", package: "套餐" };

export const PKG_STATUS: LabelMap = {
  active: { label: "生效中", tone: "success" },
  exhausted: { label: "已用尽", tone: "muted" },
  expired: { label: "已过期", tone: "muted" },
  revoked: { label: "已撤销", tone: "danger" },
};

export const CODE_STATUS: LabelMap = {
  "1": { label: "未使用", tone: "success" },
  "2": { label: "已使用", tone: "muted" },
  "3": { label: "已作废", tone: "danger" },
};

export const LOG_STATUS: LabelMap = {
  success: { label: "成功", tone: "success" },
  failed: { label: "失败", tone: "danger" },
  client_abort: { label: "客户端中断", tone: "warning" },
};

export const MODEL_MODE: Record<string, string> = { chat: "对话", embedding: "向量", image: "图像", audio: "音频" };

export const SCOPE_TYPE: Record<string, string> = { all: "全部模型", models: "指定模型", vendors: "指定供应商" };

export const RECON_KIND: Record<string, { label: string; desc: string }> = {
  ledger_vs_balance: { label: "钱包余额 ↔ 账务流水", desc: "每个钱包/套餐的余额应等于其全部账务流水之和" },
  calllog_vs_ledger: { label: "调用流水 ↔ 账务流水", desc: "近 24 小时每笔调用的扣费应与账务流水一致" },
  redis_vs_db: { label: "Redis 热数据 ↔ 数据库", desc: "Redis 中的实时额度应与数据库余额一致（扣除预扣中金额）" },
  upstream_bill: { label: "平台 ↔ 上游账单", desc: "按日期 × 模型比对平台记录与导入的厂商账单（请求数、token、金额）" },
  upstream_balance: { label: "平台 ↔ 上游余额", desc: "两次余额快照之间的上游扣费与平台核算成本比对" },
};

export const ANN_LEVEL: LabelMap = {
  info: { label: "通知", tone: "info" },
  success: { label: "成功", tone: "success" },
  warning: { label: "警告", tone: "warning" },
  error: { label: "重要", tone: "danger" },
};

export function lbl(map: LabelMap, k: string | number | null | undefined) {
  return map[String(k)] ?? { label: String(k ?? "-"), tone: "muted" as Tone };
}
