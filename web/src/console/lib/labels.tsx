import { StatusBadge, type Tone } from "@/components/misc";
import type { CallLog, OrderStatus, UserPackage } from "@/api/types";

export const BIZ_TYPES: Record<string, string> = {
  consume: "调用消费",
  topup: "充值",
  package_grant: "套餐发放",
  refund: "退款",
  adjust: "管理员调整",
  redeem: "兑换码",
  expire: "套餐过期",
  gift: "赠送",
  purchase: "余额购买",
};

export function bizLabel(t: string) {
  return BIZ_TYPES[t] ?? t;
}

const ORDER_STATUS: Record<OrderStatus, [string, Tone]> = {
  pending: ["待支付", "warning"],
  paid: ["已支付", "info"],
  fulfilled: ["已完成", "success"],
  closed: ["已关闭", "muted"],
  refunded: ["已退款", "danger"],
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const [label, tone] = ORDER_STATUS[status] ?? [status, "muted"];
  return (
    <StatusBadge tone={tone} dot>
      {label}
    </StatusBadge>
  );
}

export const ORDER_STATUS_OPTIONS = Object.entries(ORDER_STATUS).map(([v, [l]]) => ({ value: v, label: l }));

const PKG_STATUS: Record<UserPackage["status"], [string, Tone]> = {
  active: ["生效中", "success"],
  exhausted: ["已用完", "muted"],
  expired: ["已过期", "muted"],
  revoked: ["已撤销", "danger"],
};

export function PackageStatusBadge({ status }: { status: UserPackage["status"] }) {
  const [label, tone] = PKG_STATUS[status] ?? [status, "muted"];
  return (
    <StatusBadge tone={tone} dot>
      {label}
    </StatusBadge>
  );
}

const LOG_STATUS: Record<CallLog["status"], [string, Tone]> = {
  success: ["成功", "success"],
  failed: ["失败", "danger"],
  client_abort: ["客户端中断", "warning"],
};

export function LogStatusBadge({ status }: { status: CallLog["status"] }) {
  const [label, tone] = LOG_STATUS[status] ?? [status, "muted"];
  return (
    <StatusBadge tone={tone} dot>
      {label}
    </StatusBadge>
  );
}

export const PAY_METHODS: Record<string, { label: string; color: string; short: string }> = {
  alipay: { label: "支付宝", color: "#1677ff", short: "支" },
  wechat: { label: "微信支付", color: "#07c160", short: "微" },
  balance: { label: "余额支付", color: "var(--primary)", short: "余" },
};

export function PayMethodIcon({ method, size = 20 }: { method: string; size?: number }) {
  const m = PAY_METHODS[method] ?? { color: "var(--muted-foreground)", short: "?" };
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, background: m.color, fontSize: size * 0.55 }}
    >
      {m.short}
    </span>
  );
}

export function PayMethodLabel({ method }: { method: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PayMethodIcon method={method} size={16} />
      {PAY_METHODS[method]?.label ?? method}
    </span>
  );
}

export const ORDER_TYPES: Record<string, string> = { topup: "余额充值", package: "套餐购买" };
