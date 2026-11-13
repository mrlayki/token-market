import { Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/misc";
import { dt, fromNow, money, pricePerM } from "@/lib/format";
import type { PriceVersion } from "../lib/types";
import { TimeRulesBadge } from "./time-rules-editor";

/** 价格摘要：输入 / 输出（元 / 百万 token）或按次 */
export function PriceSummary({ price, compact }: { price: PriceVersion | null | undefined; compact?: boolean }) {
  if (!price) return <StatusBadge tone="warning">未定价</StatusBadge>;
  if (price.time_rules?.length)
    return (
      <div className="flex items-start gap-2">
        <PriceSummaryInner price={price} compact={compact} />
        <TimeRulesBadge rules={price.time_rules} />
      </div>
    );
  return <PriceSummaryInner price={price} compact={compact} />;
}

function PriceSummaryInner({ price, compact }: { price: PriceVersion; compact?: boolean }) {
  if (price.billing_type === "per_call")
    return (
      <span className="num text-xs">
        {money(price.per_call_price, { precise: true })}
        <span className="text-muted-foreground"> / 次</span>
      </span>
    );
  return (
    <div className="num text-xs leading-5">
      <div>
        <span className="text-muted-foreground">输入 </span>
        {pricePerM(price.input_price)}
        {compact ? <span className="text-muted-foreground"> · 输出 </span> : null}
        {compact && pricePerM(price.output_price)}
      </div>
      {!compact && (
        <div>
          <span className="text-muted-foreground">输出 </span>
          {pricePerM(price.output_price)}
        </div>
      )}
    </div>
  );
}

/** 待生效价格徽标 */
export function PendingPriceBadge({ price }: { price: PriceVersion | null | undefined }) {
  if (!price) return null;
  const desc =
    price.billing_type === "per_call"
      ? `按次 ${money(price.per_call_price, { precise: true })}`
      : `输入 ${pricePerM(price.input_price)} / 输出 ${pricePerM(price.output_price)}（每百万 token）`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <StatusBadge tone="info">
            <Clock className="size-3" />
            定时生效 {dt(price.effective_at, "MM-DD HH:mm")}
          </StatusBadge>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {fromNow(price.effective_at)}生效：{desc}
        {price.remark ? `；${price.remark}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}
