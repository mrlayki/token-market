import { TimeRulesHint } from "../components/time-rules";
import { LayoutGrid, List, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { CopyButton, VendorIcon } from "@/components/misc";
import { Empty } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { compact, money, pricePerM } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketModel } from "@/api/types";
import { useAuth } from "../auth";
import { EndpointBadges, ModelDetailDialog, PriceRows } from "../components/model-detail";
import { ratioText, scalePrice, useCurrency, useMarketplace } from "../lib/data";

type Sort = "default" | "price_asc" | "price_desc" | "context";

const ENDPOINT_FILTERS = [
  { value: "", label: "全部格式" },
  { value: "openai", label: "OpenAI 格式" },
  { value: "anthropic", label: "Anthropic 格式" },
  { value: "embeddings", label: "Embeddings" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export default function MarketplacePage() {
  const mk = useMarketplace();
  const user = useAuth((s) => s.user);
  const symbol = useCurrency();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const vendor = sp.get("vendor") ?? "";
  const tag = sp.get("tag") ?? "";
  const endpoint = sp.get("endpoint") ?? "";
  const sort = (sp.get("sort") as Sort) ?? "default";
  const view = sp.get("view") === "table" ? "table" : "grid";
  const group = sp.get("group") ?? user?.group ?? "default";
  const [detail, setDetail] = useState<MarketModel | null>(null);

  const set = (k: string, v: string) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  const models = mk.data?.models ?? [];
  const groups = mk.data?.groups ?? [];
  const g = groups.find((x) => x.name === group) ?? groups[0];
  const ratio = g ? Number(g.price_ratio) : 1;

  const matchEndpoint = (m: MarketModel) => {
    if (!endpoint) return true;
    if (endpoint === "embeddings") return m.endpoints.includes("embeddings") || m.mode === "embedding";
    return m.endpoints.includes(endpoint);
  };
  const matchQ = (m: MarketModel) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [m.name, m.display_name, m.description, m.vendor?.display_name ?? "", ...m.tags].some((x) => x.toLowerCase().includes(s));
  };

  const base = models.filter((m) => matchQ(m) && matchEndpoint(m) && (!g || m.enable_groups.includes(g.name)));
  const vendorCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of base.filter((m) => !tag || m.tags.includes(tag))) c.set(m.vendor?.name ?? "", (c.get(m.vendor?.name ?? "") ?? 0) + 1);
    return c;
  }, [base, tag]);
  const tags = useMemo(() => [...new Set(models.flatMap((m) => m.tags))], [models]);

  const list = useMemo(() => {
    const r = base.filter((m) => (!vendor || m.vendor?.name === vendor) && (!tag || m.tags.includes(tag)));
    const unit = (m: MarketModel) => (m.price.billing_type === "per_call" ? m.price.per_call_price : m.price.input_price + m.price.output_price);
    if (sort === "price_asc") r.sort((a, b) => unit(a) - unit(b));
    if (sort === "price_desc") r.sort((a, b) => unit(b) - unit(a));
    if (sort === "context") r.sort((a, b) => b.context_length - a.context_length);
    return r;
  }, [base, vendor, tag, sort]);

  const vendors = (mk.data?.vendors ?? []).filter((v) => vendorCounts.get(v.name));
  const filtered = !!(q || vendor || tag || endpoint);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">模型广场</h1>
        <p className="text-muted-foreground">浏览全部可用模型与实时价格，所有模型均可通过统一的 API Key 调用。</p>
      </div>

      {/* 筛选 */}
      <div className="mt-8 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                set("q", e.target.value);
              }}
              placeholder="搜索模型名称、厂商、标签…"
              className="h-10 pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={endpoint || "all"} onValueChange={(v) => set("endpoint", v === "all" ? "" : v)}>
              <SelectTrigger className="h-10 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENDPOINT_FILTERS.map((e) => (
                  <SelectItem key={e.value || "all"} value={e.value || "all"}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {groups.length > 1 && (
              <Select value={g?.name} onValueChange={(v) => set("group", v)}>
                <SelectTrigger className="h-10 w-[150px]">
                  <SelectValue placeholder="分组" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((x) => (
                    <SelectItem key={x.name} value={x.name}>
                      {x.display_name} <span className="text-muted-foreground">{ratioText(x.price_ratio)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={sort} onValueChange={(v) => set("sort", v === "default" ? "" : v)}>
              <SelectTrigger className="h-10 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认排序</SelectItem>
                <SelectItem value="price_asc">价格从低到高</SelectItem>
                <SelectItem value="price_desc">价格从高到低</SelectItem>
                <SelectItem value="context">上下文最长</SelectItem>
              </SelectContent>
            </Select>
            <ToggleGroup type="single" variant="outline" value={view} onValueChange={(v) => v && set("view", v === "grid" ? "" : v)} className="h-10">
              <ToggleGroupItem value="grid" aria-label="卡片视图" className="h-10 w-10">
                <LayoutGrid />
              </ToggleGroupItem>
              <ToggleGroupItem value="table" aria-label="表格视图" className="h-10 w-10">
                <List />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Chip active={!vendor} onClick={() => set("vendor", "")}>
            全部厂商 <span className="num text-xs opacity-70">{[...vendorCounts.values()].reduce((a, b) => a + b, 0)}</span>
          </Chip>
          {vendors.map((v) => (
            <Chip key={v.name} active={vendor === v.name} onClick={() => set("vendor", vendor === v.name ? "" : v.name)}>
              <VendorIcon vendor={v.name} icon={v.icon} size={16} className="rounded" />
              {v.display_name}
              <span className="num text-xs opacity-70">{vendorCounts.get(v.name)}</span>
            </Chip>
          ))}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">标签</span>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("tag", tag === t ? "" : t)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs transition-colors",
                  tag === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            共 <span className="num font-medium text-foreground">{list.length}</span> 个模型
            {g && ratio !== 1 && (
              <Badge variant="secondary" className="ml-2 font-normal">
                {g.display_name} · 分组倍率 {ratioText(ratio)}
              </Badge>
            )}
          </span>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                setSp(new URLSearchParams(view === "table" ? { view } : {}), { replace: true });
              }}
            >
              <X /> 清除筛选
            </Button>
          )}
        </div>
      </div>

      {/* 列表 */}
      <div className="mt-4">
        {mk.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border">
            <Empty title="没有找到匹配的模型" description="换个关键词或清除筛选条件试试" />
          </div>
        ) : view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((m) => (
              <ModelCard key={m.name} m={m} ratio={ratio} symbol={symbol} onClick={() => setDetail(m)} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs">模型</TableHead>
                  <TableHead className="text-xs">厂商</TableHead>
                  <TableHead className="text-right text-xs">上下文</TableHead>
                  <TableHead className="text-right text-xs">输入 / 1M</TableHead>
                  <TableHead className="text-right text-xs">输出 / 1M</TableHead>
                  <TableHead className="text-right text-xs">缓存读取 / 1M</TableHead>
                  <TableHead className="text-xs">协议</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((m) => {
                  const p = scalePrice(m.price, ratio);
                  const perCall = p.billing_type === "per_call";
                  return (
                    <TableRow key={m.name} className="cursor-pointer" onClick={() => setDetail(m)}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <VendorIcon vendor={m.vendor?.name} icon={m.icon || m.vendor?.icon} size={22} />
                          <div className="min-w-0">
                            <div className="font-medium">{m.display_name}</div>
                            {m.display_name !== m.name && <div className="font-mono text-xs text-muted-foreground">{m.name}</div>}
                          </div>
                          <CopyButton text={m.name} className="size-6 text-muted-foreground" />
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.vendor?.display_name ?? "-"}</TableCell>
                      <TableCell className="num text-right">{m.context_length ? compact(m.context_length) : "-"}</TableCell>
                      {perCall ? (
                        <TableCell colSpan={3} className="num text-right">
                          {money(p.per_call_price, { symbol })} / 次
                        </TableCell>
                      ) : (
                        <>
                          <TableCell className="num text-right">{pricePerM(p.input_price, symbol)}</TableCell>
                          <TableCell className="num text-right">{pricePerM(p.output_price, symbol)}</TableCell>
                          <TableCell className="num text-right text-muted-foreground">{p.cache_read_price > 0 ? pricePerM(p.cache_read_price, symbol) : "-"}</TableCell>
                        </>
                      )}
                      <TableCell>
                        <EndpointBadges endpoints={m.endpoints} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ModelDetailDialog model={detail} market={mk.data} open={!!detail} onOpenChange={(o) => !o && setDetail(null)} ratio={ratio} />
    </div>
  );
}

function ModelCard({ m, ratio, symbol, onClick }: { m: MarketModel; ratio: number; symbol: string; onClick: () => void }) {
  const p = scalePrice(m.price, ratio);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="group flex cursor-pointer flex-col rounded-xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
    >
      <div className="flex items-start gap-3">
        <VendorIcon vendor={m.vendor?.name} icon={m.icon || m.vendor?.icon} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold group-hover:text-primary">{m.display_name}</div>
          <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <span className="truncate font-mono">{m.name}</span>
            <CopyButton text={m.name} className="size-6 shrink-0" />
          </div>
        </div>
      </div>
      {m.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{m.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <TimeRulesHint rules={m.price.time_rules} />
        {m.tags.map((t) => (
          <Badge key={t} variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
            {t}
          </Badge>
        ))}
        {m.context_length > 0 && (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground">
            {compact(m.context_length)} 上下文
          </Badge>
        )}
        {m.max_output_tokens > 0 && (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground">
            最大输出 {compact(m.max_output_tokens)}
          </Badge>
        )}
      </div>
      <div className="mt-auto pt-4">
        <div className="rounded-lg bg-muted/40 p-3">
          <PriceRows price={p} symbol={symbol} dense />
        </div>
        <EndpointBadges endpoints={m.endpoints} className="mt-3" />
      </div>
    </div>
  );
}
