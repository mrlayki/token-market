import type { ColumnDef } from "@tanstack/react-table";
import { History, Layers, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable } from "@/components/data-table";
import { Mono, StatusBadge, VendorIcon } from "@/components/misc";
import { PageHeader } from "@/components/page";
import { useTableQuery } from "@/hooks/use-table-query";
import { dt, fromNow, money, pricePerM } from "@/lib/format";
import { FilterSelect, hasFilters, ResetButton, SearchInput } from "../components/filters";
import { PendingPriceBadge } from "../components/pricing-summary";
import { useVendors } from "../lib/queries";
import type { ModelMeta } from "../lib/types";
import { BatchPriceDialog } from "./pricing/batch-dialog";
import { HistorySheet } from "./pricing/history-sheet";
import { PriceDialog, VersionNote } from "./pricing/price-dialog";
import { GroupRatioCard, PreviewCard } from "./pricing/side-cards";

function P({ v, fallback }: { v: number; fallback?: string }) {
  if (!v) return <span className="text-muted-foreground">{fallback ?? "-"}</span>;
  return <span className="num">{pricePerM(v)}</span>;
}

export default function PricingPage() {
  const vendors = useVendors();
  const t = useTableQuery<ModelMeta>("/api/admin/models", { keyword: "", vendor_id: "", priced: "" });
  const [editing, setEditing] = useState<ModelMeta | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<ModelMeta[]>([]);
  const [batchModels, setBatchModels] = useState<ModelMeta[] | null>(null);
  const vendorById = useMemo(() => new Map((vendors.data ?? []).map((v) => [v.id, v])), [vendors.data]);

  const columns: ColumnDef<ModelMeta>[] = [
    {
      header: "模型",
      cell: ({ row: { original: m } }) => {
        const v = m.vendor_id ? vendorById.get(m.vendor_id) : undefined;
        return (
          <div className="flex min-w-48 items-center gap-2">
            <VendorIcon vendor={v?.name ?? m.name} icon={m.icon || v?.icon} size={24} />
            <div className="min-w-0">
              <Mono className="text-[13px] font-medium">{m.name}</Mono>
              {!m.listed && <span className="ml-1.5 text-[11px] text-muted-foreground">已下架</span>}
            </div>
          </div>
        );
      },
    },
    {
      header: "计费",
      cell: ({ row: { original: m } }) =>
        !m.price ? (
          <StatusBadge tone="warning">未定价</StatusBadge>
        ) : m.price.billing_type === "per_call" ? (
          <StatusBadge tone="info">按次</StatusBadge>
        ) : (
          <StatusBadge tone="muted">按 Token</StatusBadge>
        ),
    },
    {
      header: () => <div className="text-right">输入</div>,
      id: "input",
      cell: ({ row: { original: m } }) => <div className="text-right">{m.price?.billing_type === "token" ? <P v={m.price.input_price} fallback="¥0" /> : "-"}</div>,
    },
    {
      header: () => <div className="text-right">输出</div>,
      id: "output",
      cell: ({ row: { original: m } }) => <div className="text-right">{m.price?.billing_type === "token" ? <P v={m.price.output_price} fallback="¥0" /> : "-"}</div>,
    },
    {
      header: () => <div className="text-right">缓存读取</div>,
      id: "cr",
      cell: ({ row: { original: m } }) => (
        <div className="text-right">{m.price?.billing_type === "token" ? <P v={m.price.cache_read_price} fallback="同输入" /> : "-"}</div>
      ),
    },
    {
      header: () => <div className="text-right">缓存写入</div>,
      id: "cw",
      cell: ({ row: { original: m } }) => (
        <div className="text-right">{m.price?.billing_type === "token" ? <P v={m.price.cache_write_price} fallback="同输入" /> : "-"}</div>
      ),
    },
    {
      header: () => <div className="text-right">按次</div>,
      id: "per_call",
      cell: ({ row: { original: m } }) => (
        <div className="num text-right">{m.price?.billing_type === "per_call" ? money(m.price.per_call_price, { precise: true }) : <span className="text-muted-foreground">-</span>}</div>
      ),
    },
    {
      header: "当前版本",
      cell: ({ row: { original: m } }) =>
        m.price ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs whitespace-nowrap text-muted-foreground">{fromNow(m.price.effective_at)}生效</span>
            </TooltipTrigger>
            <TooltipContent>
              {dt(m.price.effective_at)} 生效（#{m.price.id}）{m.price.remark ? `；${m.price.remark}` : ""}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      header: "待生效",
      cell: ({ row: { original: m } }) => (m.pending_price ? <PendingPriceBadge price={m.pending_price} /> : <span className="text-muted-foreground">-</span>),
    },
    {
      id: "actions",
      header: () => <div className="text-right">操作</div>,
      cell: ({ row: { original: m } }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
            <Pencil />
            调价
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setHistory(m.name)}>
            <History />
            历史
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="模型计费"
        description={
          <>
            价格单位为 元 / 百万 token；用户实际价格 = 模型价格 × 分组倍率。模型需先在
            <Link to="/models" className="mx-1 text-primary hover:underline">
              模型管理
            </Link>
            中建档。
          </>
        }
        actions={
          batchMode ? (
            <>
              <Button variant="ghost" onClick={() => (setBatchMode(false), setSelected([]))}>
                <X />
                退出批量
              </Button>
              <Button disabled={!selected.length} onClick={() => setBatchModels(selected)}>
                <Layers />
                批量调价{selected.length ? `（${selected.length}）` : ""}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setBatchMode(true)}>
              <Layers />
              批量调价
            </Button>
          )
        }
      />
      <div className="mb-4">
        <VersionNote />
      </div>
      <DataTable
        key={batchMode ? "batch" : "normal"}
        columns={columns}
        data={t.items}
        loading={t.isFetching}
        total={t.total}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        rowKey={(m) => m.id}
        selectable={batchMode}
        onSelectionChange={setSelected}
        footer={batchMode ? `已选择 ${selected.length} 个模型（勾选后点击右上角「批量调价」）· 共 ${t.total} 条` : undefined}
        toolbar={
          <>
            <SearchInput value={t.filters.keyword} onChange={(v) => t.setFilters({ keyword: v })} placeholder="搜索模型" />
            <FilterSelect
              value={t.filters.vendor_id}
              onChange={(v) => t.setFilters({ vendor_id: v })}
              placeholder="供应商"
              options={(vendors.data ?? []).map((v) => ({ value: String(v.id), label: v.display_name }))}
            />
            <FilterSelect
              value={t.filters.priced}
              onChange={(v) => t.setFilters({ priced: v })}
              placeholder="定价"
              allLabel="全部定价"
              options={[
                { value: "true", label: "已定价" },
                { value: "false", label: "未定价" },
              ]}
            />
            <ResetButton show={hasFilters(t.filters)} onClick={t.resetFilters} />
          </>
        }
      />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <PreviewCard />
        <GroupRatioCard />
      </div>
      <PriceDialog model={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <HistorySheet model={history} onOpenChange={(o) => !o && setHistory(null)} />
      <BatchPriceDialog models={batchModels ?? []} open={!!batchModels} onOpenChange={(o) => !o && setBatchModels(null)} onDone={() => setSelected([])} />
    </>
  );
}
