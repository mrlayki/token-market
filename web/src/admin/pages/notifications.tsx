import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCheck, CircleCheck, Inbox } from "lucide-react";
import type { NotificationItem } from "@/api/types";
import { DataTable } from "@/components/data-table";
import { StatusBadge, type Tone } from "@/components/misc";
import { PageHeader, Empty } from "@/components/page";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTableQuery } from "@/hooks/use-table-query";
import { api, toastError } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SubmitButton } from "../components/form";
import { TimeCell } from "../components/cells";

const KIND: Record<string, { label: string; tone: Tone; icon: typeof Bell }> = {
  channel_disabled: { label: "渠道禁用", tone: "danger", icon: AlertTriangle },
  channel_enabled: { label: "渠道恢复", tone: "success", icon: CircleCheck },
  usage_dlq: { label: "计量死信", tone: "danger", icon: AlertTriangle },
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const t = useTableQuery<NotificationItem, { unread: string }>("/api/admin/notifications", { unread: "" });
  const readAll = useMutation({
    mutationFn: () => api.post("/api/admin/notifications/read-all"),
    onSuccess: () => {
      toast.success("已全部标记为已读");
      qc.invalidateQueries({ queryKey: ["/api/admin/notifications"] });
      qc.invalidateQueries({ queryKey: ["admin-unread"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: toastError,
  });

  return (
    <div>
      <PageHeader
        title="系统通知"
        description="渠道自动禁用 / 恢复、计量异常等系统事件"
        actions={
          <SubmitButton variant="outline" size="sm" loading={readAll.isPending} onClick={() => readAll.mutate()}>
            <CheckCheck />
            全部已读
          </SubmitButton>
        }
      />
      <DataTable
        data={t.items}
        loading={t.isLoading || t.isFetching}
        total={t.total}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        rowKey={(r) => r.id}
        empty={<Empty title={t.filters.unread ? "没有未读通知" : "暂无通知"} />}
        toolbar={
          <Tabs value={t.filters.unread ? "unread" : "all"} onValueChange={(v) => t.setFilters({ unread: v === "unread" ? "true" : "" })}>
            <TabsList>
              <TabsTrigger value="all">
                <Inbox />
                全部
              </TabsTrigger>
              <TabsTrigger value="unread">
                <Bell />
                未读
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
        columns={[
          {
            id: "kind",
            header: "类型",
            size: 120,
            cell: ({ row }) => {
              const k = KIND[row.original.kind] ?? { label: row.original.kind, tone: "muted" as Tone, icon: Bell };
              return (
                <StatusBadge tone={k.tone}>
                  <k.icon className="size-3" />
                  {k.label}
                </StatusBadge>
              );
            },
          },
          {
            id: "title",
            header: "内容",
            cell: ({ row }) => (
              <div className="flex items-start gap-2">
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", row.original.read ? "bg-transparent" : "bg-primary")} />
                <div className="min-w-0">
                  <div className={cn("text-sm", !row.original.read && "font-medium")}>{row.original.title}</div>
                  {row.original.content && (
                    <div className="mt-0.5 max-w-[720px] text-xs break-all whitespace-pre-wrap text-muted-foreground">{row.original.content}</div>
                  )}
                </div>
              </div>
            ),
          },
          {
            id: "read",
            header: "状态",
            size: 80,
            cell: ({ row }) => (row.original.read ? <StatusBadge tone="muted">已读</StatusBadge> : <StatusBadge tone="default" dot>未读</StatusBadge>),
          },
          { id: "time", header: "时间", size: 140, cell: ({ row }) => <TimeCell v={row.original.created_at} /> },
        ]}
      />
    </div>
  );
}
