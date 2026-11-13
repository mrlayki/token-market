import { Clock } from "lucide-react";
import type { TimeRule } from "@/api/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/misc";
import { matchTimeRule, multRangeText, ruleText } from "@/lib/time-rules";

/** 模型分时计价提示：徽标 + 悬停查看各时段；当前命中的时段高亮 */
export function TimeRulesHint({ rules }: { rules: TimeRule[] | undefined }) {
  if (!rules?.length) return null;
  const now = matchTimeRule(rules);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span onClick={(e) => e.stopPropagation()}>
          <StatusBadge tone={now ? "warning" : "info"}>
            <Clock className="size-3" />
            分时计价{now ? ` · 当前${now.name} ${multRangeText([now])}` : ""}
          </StatusBadge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-xs leading-relaxed">
        <div className="mb-1">显示的是基础价，以下时段按倍率计费（按请求开始时间）：</div>
        {rules.map((r, i) => (
          <div key={i}>{ruleText(r, true)}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
