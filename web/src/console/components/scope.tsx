import { Layers } from "lucide-react";
import { VendorIcon } from "@/components/misc";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { compact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMarketplace, weight } from "../lib/data";

/** 套餐适用范围 */
export function PackageScope({ type, values, className, max = 6 }: { type: "all" | "models" | "vendors"; values: string[]; className?: string; max?: number }) {
  const mk = useMarketplace();
  if (type === "all" || values.length === 0) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
        <Layers className="size-4 text-primary" /> 全部模型通用
      </span>
    );
  }
  const vendorOf = (name: string): { name: string; display_name?: string } | undefined => {
    if (type === "vendors") return mk.data?.vendors.find((v) => v.name === name);
    return mk.data?.models.find((m) => m.name === name)?.vendor ?? guessVendor(name);
  };
  const shown = values.slice(0, max);
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {shown.map((v) => {
        const vendor = vendorOf(v);
        return (
          <Badge key={v} variant="secondary" className="gap-1.5 py-0.5 pl-1 font-normal">
            <VendorIcon vendor={vendor?.name ?? v} size={16} className="rounded" />
            <span className="font-mono text-[11px]">{type === "vendors" ? vendor?.display_name ?? v : v}</span>
          </Badge>
        );
      })}
      {values.length > max && <Badge variant="outline" className="font-normal">+{values.length - max}</Badge>}
    </div>
  );
}

function guessVendor(model: string): { name: string; display_name?: string } {
  const m = model.toLowerCase();
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return { name: "openai" };
  if (m.startsWith("claude")) return { name: "anthropic" };
  if (m.startsWith("deepseek")) return { name: "deepseek" };
  if (m.startsWith("gemini")) return { name: "google" };
  if (m.startsWith("qwen")) return { name: "qwen" };
  return { name: model };
}

/** 计量规则说明 */
export function weightNote(input: string | number, output: string | number): string | null {
  const i = weight(input);
  const o = weight(output);
  if (i === 1 && o === 1) return null;
  const parts = [];
  if (i !== 1) parts.push(`输入 token 按 ${i} 倍计量`);
  if (o !== 1) parts.push(`输出 token 按 ${o} 倍计量`);
  return parts.join("，");
}

/** 套餐剩余量进度条 */
export function TokenProgress({ remaining, total, className }: { remaining: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span>
          剩余 <span className="num font-semibold text-foreground">{compact(remaining)}</span>
          <span className="text-muted-foreground"> / {compact(total)} tokens</span>
        </span>
        <span className="num text-muted-foreground">{pct.toFixed(1)}%</span>
      </div>
      <Progress value={pct} className={cn("h-1.5", pct < 10 && "[&>div]:bg-destructive")} />
    </div>
  );
}
