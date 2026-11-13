import { TimeRulesHint } from "./time-rules";
import { CopyButton, VendorIcon } from "@/components/misc";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { compact, money, pricePerM } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketModel, Marketplace, PriceView } from "@/api/types";
import { ratioText, scalePrice, useBaseUrl, useCurrency } from "../lib/data";
import { CodeTabs } from "./code-block";
import { modelTabs } from "./snippets";

export const ENDPOINT_LABELS: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", embeddings: "Embeddings" };

export function EndpointBadges({ endpoints, className }: { endpoints: string[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {endpoints.map((e) => (
        <Badge key={e} variant="outline" className="h-5 px-1.5 font-mono text-[10px] font-normal text-muted-foreground">
          {ENDPOINT_LABELS[e] ?? e}
        </Badge>
      ))}
    </div>
  );
}

/** 价格行：输入 / 输出 / 缓存读 / 按次 */
export function PriceRows({ price, symbol, dense }: { price: PriceView; symbol: string; dense?: boolean }) {
  if (price.billing_type === "per_call") {
    return (
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">按次</span>
        <span>
          <span className="num font-semibold">{money(price.per_call_price, { symbol })}</span>
          <span className="text-xs text-muted-foreground"> / 次</span>
        </span>
      </div>
    );
  }
  const rows: [string, number][] = [
    ["输入", price.input_price],
    ["输出", price.output_price],
  ];
  if (price.cache_read_price > 0) rows.push(["缓存读取", price.cache_read_price]);
  if (!dense && price.cache_write_price > 0) rows.push(["缓存写入", price.cache_write_price]);
  return (
    <div className="space-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">{k}</span>
          <span>
            <span className="num font-semibold">{pricePerM(v, symbol)}</span>
            <span className="text-xs text-muted-foreground"> / 1M tokens</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function ModelDetailDialog({ model, market, open, onOpenChange, ratio }: { model: MarketModel | null; market?: Marketplace; open: boolean; onOpenChange: (o: boolean) => void; ratio: number }) {
  const base = useBaseUrl();
  const symbol = useCurrency();
  if (!model) return null;
  const groups = (market?.groups ?? []).filter((g) => model.enable_groups.includes(g.name));
  const p = scalePrice(model.price, ratio);
  const perCall = model.price.billing_type === "per_call";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <VendorIcon vendor={model.vendor?.name} icon={model.icon || model.vendor?.icon} size={40} />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg">{model.display_name}</DialogTitle>
              <DialogDescription asChild>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 font-mono text-xs text-foreground">
                    {model.name}
                    <CopyButton text={model.name} className="size-6" />
                  </span>
                  {model.vendor && <span className="text-xs">{model.vendor.display_name}</span>}
                </div>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {model.description && <p className="text-sm leading-6 text-muted-foreground">{model.description}</p>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["上下文长度", model.context_length ? compact(model.context_length) : "-"],
            ["最大输出", model.max_output_tokens ? compact(model.max_output_tokens) : "-"],
            ["计费方式", perCall ? "按次计费" : "按 token 计费"],
            ["支持协议", (model.endpoints.map((e) => ENDPOINT_LABELS[e] ?? e).join(" / ")) || "-"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-muted/30 px-3 py-2.5">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="num mt-0.5 text-sm font-medium">{v}</div>
            </div>
          ))}
        </div>

        {model.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {model.tags.map((t) => (
              <Badge key={t} variant="secondary" className="font-normal">
                {t}
              </Badge>
            ))}
          </div>
        )}

        <div>
          <h4 className="mb-2 text-sm font-medium">各分组价格</h4>
          <div className="overflow-hidden rounded-lg border">
            {model.price.time_rules?.length ? (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <TimeRulesHint rules={model.price.time_rules} />
                    下表为基础价，命中时段时乘以对应倍率
                  </div>
                ) : null}
                <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs">分组</TableHead>
                  <TableHead className="text-xs">倍率</TableHead>
                  {perCall ? (
                    <TableHead className="text-right text-xs">每次</TableHead>
                  ) : (
                    <>
                      <TableHead className="text-right text-xs">输入 / 1M</TableHead>
                      <TableHead className="text-right text-xs">输出 / 1M</TableHead>
                      {model.price.cache_read_price > 0 && <TableHead className="text-right text-xs">缓存读取 / 1M</TableHead>}
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => {
                  const gp = scalePrice(model.price, Number(g.price_ratio));
                  return (
                    <TableRow key={g.name}>
                      <TableCell className="font-medium">{g.display_name}</TableCell>
                      <TableCell className="num text-muted-foreground">{ratioText(g.price_ratio)}</TableCell>
                      {perCall ? (
                        <TableCell className="num text-right">{money(gp.per_call_price, { symbol })}</TableCell>
                      ) : (
                        <>
                          <TableCell className="num text-right">{pricePerM(gp.input_price, symbol)}</TableCell>
                          <TableCell className="num text-right">{pricePerM(gp.output_price, symbol)}</TableCell>
                          {model.price.cache_read_price > 0 && <TableCell className="num text-right">{pricePerM(gp.cache_read_price, symbol)}</TableCell>}
                        </>
                      )}
                    </TableRow>
                  );
                })}
                {groups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      基础价：输入 {pricePerM(p.input_price, symbol)} · 输出 {pricePerM(p.output_price, symbol)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="min-w-0">
          <h4 className="mb-2 text-sm font-medium">调用示例</h4>
          <CodeTabs key={model.name} tabs={modelTabs(base, model.name, model.endpoints, model.mode)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
