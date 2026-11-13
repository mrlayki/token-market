import { DataTable } from "@/components/data-table";
import { Mono, StatusBadge, type Tone } from "@/components/misc";
import { PageHeader } from "@/components/page";
import { useTableQuery } from "@/hooks/use-table-query";
import { UserRef, TimeCell } from "../components/cells";
import { FilterSelect, ResetButton, SearchInput, hasFilters } from "../components/filters";
import { JsonPopover } from "../components/json";
import type { AuditLog } from "../lib/types";

const MODULES: { value: string; label: string; tone: Tone }[] = [
  { value: "channel", label: "渠道", tone: "info" },
  { value: "model", label: "模型", tone: "info" },
  { value: "vendor", label: "供应商", tone: "info" },
  { value: "price", label: "价格", tone: "warning" },
  { value: "group", label: "分组", tone: "default" },
  { value: "user", label: "用户", tone: "default" },
  { value: "package_product", label: "套餐商品", tone: "default" },
  { value: "order", label: "订单", tone: "warning" },
  { value: "redemption", label: "兑换码", tone: "warning" },
  { value: "recon", label: "对账", tone: "muted" },
  { value: "statement", label: "账单", tone: "muted" },
  { value: "settings", label: "系统设置", tone: "danger" },
  { value: "announcement", label: "公告", tone: "muted" },
];

const ACTIONS: Record<string, string> = {
  create: "创建", update: "修改", delete: "删除", copy: "复制", status: "状态变更", batch: "批量操作",
  set: "设置", batch_set: "批量设置", delete_pending: "删除待生效", batch_create: "批量创建", upsert: "保存",
  adjust_balance: "调整余额", grant_package: "发放套餐", revoke_package: "撤销套餐", rebuild_quota: "重建额度缓存",
  refulfill: "补发货", close: "关闭", generate: "生成", disable: "作废", run: "执行", resolve: "标记已处理", build: "生成",
  enable_all: "启用全部", "key.status": "Key 状态", "key.delete": "删除 Key", "key.enable_all": "启用全部 Key",
};

function describe(action: string) {
  const [mod, ...rest] = action.split(".");
  const m = MODULES.find((x) => x.value === mod);
  const tail = rest.join(".");
  const verb = ACTIONS[tail] ?? (tail.startsWith("batch.") ? `批量${ACTIONS[tail.slice(6)] ?? tail.slice(6)}` : tail);
  return { module: m?.label ?? mod, tone: m?.tone ?? ("muted" as Tone), verb };
}

export default function AuditPage() {
  const t = useTableQuery<AuditLog, { action: string; operator_id: string }>("/api/admin/audit-logs", { action: "", operator_id: "" });
  const moduleValue = MODULES.some((m) => m.value === t.filters.action.replace(/\.$/, "")) ? t.filters.action.replace(/\.$/, "") : "";

  return (
    <div>
      <PageHeader title="审计日志" description="管理员的所有写操作记录，用于追溯与合规审计" />
      <DataTable
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
            <FilterSelect
              placeholder="模块"
              value={moduleValue}
              onChange={(v) => t.setFilters({ action: v ? `${v}.` : "" })}
              options={MODULES.map((m) => ({ value: m.value, label: m.label }))}
            />
            <SearchInput value={t.filters.action} onChange={(v) => t.setFilters({ action: v })} placeholder="操作前缀，如 channel.batch" />
            <SearchInput
              className="w-36"
              value={t.filters.operator_id}
              onChange={(v) => t.setFilters({ operator_id: v.replace(/\D/g, "") })}
              placeholder="操作人 ID"
            />
            <ResetButton show={hasFilters(t.filters)} onClick={t.resetFilters} />
          </>
        }
        columns={[
          { id: "id", header: "ID", size: 64, cell: ({ row }) => <span className="num text-xs text-muted-foreground">{row.original.id}</span> },
          { id: "time", header: "时间", size: 140, cell: ({ row }) => <TimeCell v={row.original.created_at} /> },
          { id: "op", header: "操作人", cell: ({ row }) => <UserRef id={row.original.operator_id} name={row.original.operator_name} /> },
          {
            id: "action",
            header: "操作",
            cell: ({ row }) => {
              const d = describe(row.original.action);
              return (
                <div className="flex items-center gap-2">
                  <StatusBadge tone={d.tone}>{d.module}</StatusBadge>
                  <span className="text-sm">{d.verb}</span>
                  <Mono className="text-muted-foreground">{row.original.action}</Mono>
                </div>
              );
            },
          },
          {
            id: "target",
            header: "对象",
            cell: ({ row }) =>
              row.original.target_id ? (
                <Mono>
                  {row.original.target_type}
                  <span className="text-muted-foreground"> #</span>
                  <span className="inline-block max-w-[200px] truncate align-bottom">{row.original.target_id}</span>
                </Mono>
              ) : (
                <Mono className="text-muted-foreground">{row.original.target_type}</Mono>
              ),
          },
          { id: "ip", header: "IP", cell: ({ row }) => <Mono className="text-muted-foreground">{row.original.ip || "-"}</Mono> },
          { id: "detail", header: "详情", size: 80, cell: ({ row }) => <JsonPopover value={row.original.detail} /> },
        ]}
      />
    </div>
  );
}
