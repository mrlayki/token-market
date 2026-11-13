import type { ColumnDef } from "@tanstack/react-table";
import type { LedgerEntry } from "@/api/types";
import { DataTable } from "@/components/data-table";
import { Mono, StatusBadge, Truncate } from "@/components/misc";
import { PageHeader } from "@/components/page";
import { useTableQuery } from "@/hooks/use-table-query";
import { money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TimeCell, UserRef } from "../components/cells";
import { FilterSelect, hasFilters, ResetButton, SearchInput } from "../components/filters";
import { BIZ_TYPE, BUCKET_TYPE, lbl } from "../lib/labels";

const DEFAULTS = { user_id: "", biz_type: "", bucket_type: "", biz_id: "" };

function Amount({ e }: { e: LedgerEntry }) {
  const pos = e.amount > 0;
  const cls = cn("num font-medium whitespace-nowrap", pos ? "text-success" : e.amount < 0 ? "text-destructive" : "text-muted-foreground");
  if (e.bucket_type === "package") {
    return (
      <span className={cls}>
        {pos ? "+" : ""}
        {num(e.amount)} <span className="text-xs font-normal text-muted-foreground">tokens</span>
      </span>
    );
  }
  return (
    <span className={cls}>
      {pos ? "+" : ""}
      {money(e.amount)}
    </span>
  );
}

const columns: ColumnDef<LedgerEntry, unknown>[] = [
  { header: "ID", cell: ({ row }) => <span className="num text-xs text-muted-foreground">{row.original.id}</span> },
  { header: "时间", cell: ({ row }) => <TimeCell v={row.original.created_at} /> },
  { header: "用户", cell: ({ row }) => <UserRef id={row.original.user_id} /> },
  {
    header: "账户",
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5 text-xs">
        <StatusBadge tone={row.original.bucket_type === "wallet" ? "default" : "info"}>{BUCKET_TYPE[row.original.bucket_type] ?? row.original.bucket_type}</StatusBadge>
        {row.original.package_id && <span className="num text-muted-foreground">#{row.original.package_id}</span>}
      </div>
    ),
  },
  {
    header: "业务类型",
    cell: ({ row }) => {
      const b = lbl(BIZ_TYPE, row.original.biz_type);
      return <StatusBadge tone={b.tone}>{b.label}</StatusBadge>;
    },
  },
  { header: "变动", cell: ({ row }) => <Amount e={row.original} /> },
  {
    header: "变动后余额",
    cell: ({ row }) => {
      const e = row.original;
      if (e.balance_after == null) return <span className="text-xs text-muted-foreground">-</span>;
      return <span className="num text-xs">{e.bucket_type === "package" ? `${num(e.balance_after)} tokens` : money(e.balance_after)}</span>;
    },
  },
  { header: "业务单号", cell: ({ row }) => <Mono><Truncate text={row.original.biz_id} className="max-w-[220px]" /></Mono> },
  { header: "备注", cell: ({ row }) => <Truncate text={row.original.remark} className="max-w-[200px] text-xs" /> },
];

export default function LedgerPage() {
  const t = useTableQuery<LedgerEntry, typeof DEFAULTS>("/api/admin/ledger", DEFAULTS);
  const f = t.filters;
  return (
    <div>
      <PageHeader title="账务流水" description="钱包与套餐的每一笔资金 / Token 变动（只追加，不可修改），是对账与追溯的依据。" />
      <DataTable
        columns={columns}
        data={t.items}
        loading={t.isLoading || t.isFetching}
        total={t.total}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        rowKey={(r) => r.id}
        toolbar={
          <>
            <SearchInput className="w-28" icon={false} value={f.user_id} onChange={(v) => t.setFilters({ user_id: v.replace(/\D/g, "") })} placeholder="用户 ID" />
            <FilterSelect
              value={f.biz_type}
              onChange={(v) => t.setFilters({ biz_type: v })}
              placeholder="业务类型"
              className="w-36"
              options={Object.entries(BIZ_TYPE).map(([value, x]) => ({ value, label: x.label }))}
            />
            <FilterSelect
              value={f.bucket_type}
              onChange={(v) => t.setFilters({ bucket_type: v })}
              placeholder="账户"
              options={Object.entries(BUCKET_TYPE).map(([value, label]) => ({ value, label }))}
            />
            <SearchInput className="w-64" value={f.biz_id} onChange={(v) => t.setFilters({ biz_id: v })} placeholder="业务单号（request_id / 订单号）" />
            <ResetButton show={hasFilters(f)} onClick={t.resetFilters} />
          </>
        }
      />
    </div>
  );
}
