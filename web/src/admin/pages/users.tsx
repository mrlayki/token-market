import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, CheckCircle2, Eye, Gift, MoreHorizontal, Pencil, Plus, RefreshCw, ScrollText, Wallet } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { confirm, StatusBadge } from "@/components/misc";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTableQuery } from "@/hooks/use-table-query";
import { api, toastError } from "@/lib/api";
import { fromNow, money, num } from "@/lib/format";
import { useAuth } from "../auth";
import { TimeCell } from "../components/cells";
import { FilterSelect, hasFilters, ResetButton, SearchInput } from "../components/filters";
import { lbl, ROLE, USER_STATUS } from "../lib/labels";
import { useGroups, useIsRoot } from "../lib/queries";
import type { AdminUser } from "../lib/types";
import { useRebuildQuota, UserDetailSheet } from "./users/detail";
import { AdjustDialog, CreateUserDialog, EditUserDialog, GrantDialog, USERS_URL } from "./users/dialogs";

const LEVEL: Record<string, number> = { user: 1, admin: 10, root: 100 };

export default function UsersPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useAuth((s) => s.user);
  const isRoot = useIsRoot();
  const groups = useGroups();
  const t = useTableQuery<AdminUser>(USERS_URL, { keyword: "", group: "", role: "", status: "" });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [adjusting, setAdjusting] = useState<AdminUser | null>(null);
  const [granting, setGranting] = useState<AdminUser | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const rebuild = useRebuildQuota();

  const canManage = (u: AdminUser) => u.id === me?.id || LEVEL[u.role] < LEVEL[me?.role ?? "user"];

  const toggleStatus = useMutation({
    mutationFn: (u: AdminUser) => api.put(`${USERS_URL}/${u.id}`, { status: u.status === 1 ? 2 : 1 }),
    onSuccess: (_, u) => {
      toast.success(u.status === 1 ? "已禁用" : "已启用");
      qc.invalidateQueries({ queryKey: [USERS_URL] });
    },
    onError: toastError,
  });

  const groupName = (n: string) => groups.data?.find((g) => g.name === n)?.display_name ?? n;

  const columns: ColumnDef<AdminUser>[] = [
    { header: "ID", size: 56, cell: ({ row }) => <span className="num text-muted-foreground">{row.original.id}</span> },
    {
      header: "用户",
      cell: ({ row: { original: u } }) => (
        <div className="min-w-36">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{u.username}</span>
            {u.display_name && u.display_name !== u.username && <span className="text-xs text-muted-foreground">{u.display_name}</span>}
          </div>
          <div className="max-w-52 truncate text-xs text-muted-foreground">{u.email || u.remark || " "}</div>
        </div>
      ),
    },
    {
      header: "角色",
      cell: ({ row }) => {
        const r = lbl(ROLE, row.original.role);
        return <StatusBadge tone={r.tone}>{r.label}</StatusBadge>;
      },
    },
    { header: "分组", cell: ({ row }) => <StatusBadge tone="info">{groupName(row.original.group)}</StatusBadge> },
    {
      header: "状态",
      cell: ({ row }) => {
        const s = lbl(USER_STATUS, row.original.status);
        return (
          <StatusBadge tone={s.tone} dot>
            {s.label}
          </StatusBadge>
        );
      },
    },
    {
      header: "余额",
      cell: ({ row: { original: u } }) => <span className={u.balance < 0 ? "num font-medium text-destructive" : "num font-medium"}>{money(u.balance)}</span>,
    },
    { header: "累计充值", cell: ({ row }) => <span className="num text-muted-foreground">{money(row.original.total_recharged)}</span> },
    { header: "累计消费", cell: ({ row }) => <span className="num text-muted-foreground">{money(row.original.total_consumed)}</span> },
    { header: "请求数", cell: ({ row }) => <span className="num">{num(row.original.request_count)}</span> },
    {
      header: "最后登录",
      cell: ({ row: { original: u } }) =>
        u.last_login_at ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs whitespace-nowrap">{fromNow(u.last_login_at)}</span>
            </TooltipTrigger>
            <TooltipContent>IP：{u.last_login_ip ?? "-"}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-xs text-muted-foreground">从未登录</span>
        ),
    },
    { header: "注册时间", cell: ({ row }) => <TimeCell v={row.original.created_at} fmt="YYYY-MM-DD HH:mm" /> },
    {
      id: "actions",
      header: () => <div className="text-right">操作</div>,
      cell: ({ row: { original: u } }) => {
        const manage = canManage(u);
        return (
          <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" disabled={!manage} onClick={() => setEditing(u)}>
              <Pencil />
              编辑
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAdjusting(u)}>
              <Wallet />
              调额
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => setDetailId(u.id)}>
                  <Eye />
                  详情
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setGranting(u)}>
                  <Gift />
                  发放套餐
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => nav(`/logs?user_id=${u.id}`)}>
                  <ScrollText />
                  调用日志
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => nav(`/ledger?user_id=${u.id}`)}>
                  <Wallet />
                  账务流水
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {manage && u.id !== me?.id && (
                  <DropdownMenuItem
                    variant={u.status === 1 ? "destructive" : "default"}
                    onClick={async () => {
                      if (u.status === 1 && !(await confirm({ title: `禁用用户 ${u.username}？`, description: "禁用后该用户无法登录，所有 API 令牌立即失效。", danger: true, confirmText: "禁用" })))
                        return;
                      toggleStatus.mutate(u);
                    }}
                  >
                    {u.status === 1 ? <Ban /> : <CheckCircle2 />}
                    {u.status === 1 ? "禁用" : "启用"}
                  </DropdownMenuItem>
                )}
                {isRoot && (
                  <DropdownMenuItem onClick={() => rebuild.mutate(u)}>
                    <RefreshCw />
                    重建额度缓存
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="用户管理"
        description="管理用户账户、余额与套餐。余额调整和套餐发放均会记入账务流水。"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            新建用户
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={t.items}
        loading={t.isFetching}
        total={t.total}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        rowKey={(u) => u.id}
        onRowClick={(u) => setDetailId(u.id)}
        toolbar={
          <>
            <SearchInput value={t.filters.keyword} onChange={(v) => t.setFilters({ keyword: v })} placeholder="ID / 用户名 / 邮箱 / 昵称" className="w-60" />
            <FilterSelect
              value={t.filters.group}
              onChange={(v) => t.setFilters({ group: v })}
              placeholder="分组"
              options={(groups.data ?? []).map((g) => ({ value: g.name, label: g.display_name }))}
            />
            <FilterSelect value={t.filters.role} onChange={(v) => t.setFilters({ role: v })} placeholder="角色" options={Object.entries(ROLE).map(([value, r]) => ({ value, label: r.label }))} />
            <FilterSelect
              value={t.filters.status}
              onChange={(v) => t.setFilters({ status: v })}
              placeholder="状态"
              className="w-28"
              options={Object.entries(USER_STATUS).map(([value, s]) => ({ value, label: s.label }))}
            />
            <ResetButton show={hasFilters(t.filters)} onClick={t.resetFilters} />
          </>
        }
      />
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
      <AdjustDialog user={adjusting} onClose={() => setAdjusting(null)} />
      <GrantDialog user={granting} onClose={() => setGranting(null)} />
      <UserDetailSheet userId={detailId} onClose={() => setDetailId(null)} onEdit={setEditing} onAdjust={setAdjusting} onGrant={setGranting} />
    </div>
  );
}
