import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Gift, Pencil, RefreshCw, Wallet } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { UserPackage } from "@/api/types";
import { confirm, StatusBadge } from "@/components/misc";
import { Empty, KV } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, toastError } from "@/lib/api";
import { compact, dt, fromNow, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { lbl, PKG_STATUS, ROLE, SCOPE_TYPE, USER_STATUS } from "../../lib/labels";
import { useIsRoot } from "../../lib/queries";
import type { AdminUser, UserDetail } from "../../lib/types";
import { USERS_URL } from "./dialogs";

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("num mt-0.5 text-base font-semibold", className)}>{value}</div>
    </div>
  );
}

export function useRebuildQuota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (u: { id: number; username?: string }) => {
      const ok = await confirm({
        title: `重建 ${u.username ?? `#${u.id}`} 的额度缓存？`,
        description: "将丢弃该用户在 Redis 中的实时余额 / 套餐热数据，下次请求时从数据库重新加载。用户存在进行中的请求时会失败，请稍后重试。",
        confirmText: "重建",
      });
      if (!ok) return null;
      return api.post<{ message: string }>(`${USERS_URL}/${u.id}/rebuild-quota`);
    },
    onSuccess: (r) => {
      if (!r) return;
      toast.success(r.message || "已重建");
      qc.invalidateQueries({ queryKey: ["admin", "user-detail"] });
    },
    onError: toastError,
  });
}

export function UserDetailSheet({
  userId,
  onClose,
  onEdit,
  onAdjust,
  onGrant,
}: {
  userId: number | null;
  onClose: () => void;
  onEdit: (u: AdminUser) => void;
  onAdjust: (u: AdminUser) => void;
  onGrant: (u: AdminUser) => void;
}) {
  const qc = useQueryClient();
  const isRoot = useIsRoot();
  const detail = useQuery({
    queryKey: ["admin", "user-detail", userId],
    queryFn: () => api.get<UserDetail>(`${USERS_URL}/${userId}`),
    enabled: userId != null,
  });
  const pkgs = useQuery({
    queryKey: ["admin", "user-packages", userId],
    queryFn: () => api.get<UserPackage[]>(`${USERS_URL}/${userId}/packages`),
    enabled: userId != null,
  });
  const revoke = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/user-packages/${id}/revoke`),
    onSuccess: () => {
      toast.success("套餐已撤销");
      qc.invalidateQueries({ queryKey: ["admin", "user-packages"] });
      qc.invalidateQueries({ queryKey: ["admin", "user-detail"] });
    },
    onError: toastError,
  });
  const rebuild = useRebuildQuota();

  const u = detail.data?.user;
  const live = detail.data?.live;
  const drift = u && live?.loaded ? live.bal + live.frz - u.balance : 0;

  return (
    <Sheet open={userId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            {u ? (
              <>
                {u.display_name || u.username}
                <span className="num text-sm font-normal text-muted-foreground">@{u.username} · #{u.id}</span>
              </>
            ) : (
              "用户详情"
            )}
          </SheetTitle>
          {u && (
            <SheetDescription asChild>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={lbl(ROLE, u.role).tone}>{lbl(ROLE, u.role).label}</StatusBadge>
                <StatusBadge tone={lbl(USER_STATUS, u.status).tone} dot>
                  {lbl(USER_STATUS, u.status).label}
                </StatusBadge>
                <StatusBadge tone="info">{u.group}</StatusBadge>
              </div>
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          {detail.isLoading || !u ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onEdit(u)}>
                  <Pencil />
                  编辑
                </Button>
                <Button size="sm" variant="outline" onClick={() => onAdjust(u)}>
                  <Wallet />
                  调整余额
                </Button>
                <Button size="sm" variant="outline" onClick={() => onGrant(u)}>
                  <Gift />
                  发放套餐
                </Button>
                {isRoot && (
                  <Button size="sm" variant="outline" disabled={rebuild.isPending} onClick={() => rebuild.mutate(u)}>
                    <RefreshCw className={cn(rebuild.isPending && "animate-spin")} />
                    重建额度缓存
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Stat label="钱包余额（数据库）" value={money(u.balance)} />
                <Stat label="累计充值" value={money(u.total_recharged)} />
                <Stat label="累计消费" value={money(u.total_consumed)} />
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">实时额度（Redis）</h3>
                {live == null ? (
                  <p className="text-sm text-muted-foreground">Redis 不可用，无法读取实时数据</p>
                ) : !live.loaded ? (
                  <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">尚未加载到 Redis（用户发起首次调用时自动从数据库加载）</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="可用余额" value={money(live.bal)} />
                    <Stat label="预扣冻结中" value={money(live.frz)} className={live.frz ? "text-warning" : undefined} />
                    <Stat
                      label="与数据库差额"
                      value={drift === 0 ? "一致" : money(drift)}
                      className={drift === 0 ? "text-success" : "text-destructive"}
                    />
                  </div>
                )}
                {live?.loaded && drift !== 0 && (
                  <p className="text-xs text-muted-foreground">差额可能来自尚未落库的计量流水；持续不一致时可在对账中心核查或重建额度缓存。</p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">基本信息</h3>
                <KV
                  items={[
                    ["邮箱", u.email || "-"],
                    ["请求次数", <span className="num">{num(u.request_count)}</span>],
                    ["最后登录", u.last_login_at ? `${dt(u.last_login_at)}（${fromNow(u.last_login_at)}）· ${u.last_login_ip ?? ""}` : "从未登录"],
                    ["注册时间", dt(u.created_at)],
                    ["备注", u.remark || "-"],
                  ]}
                />
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">套餐</h3>
                  <span className="text-xs text-muted-foreground">{pkgs.data?.length ?? 0} 个</span>
                </div>
                {pkgs.isLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : !pkgs.data?.length ? (
                  <div className="rounded-md border">
                    <Empty title="暂无套餐" />
                  </div>
                ) : (
                  <div className="divide-y rounded-md border">
                    {pkgs.data.map((p) => {
                      const s = lbl(PKG_STATUS, p.status);
                      const liveRemain = live?.loaded ? live.pkgs[String(p.id)] : undefined;
                      const remain = liveRemain ?? p.remaining_tokens;
                      return (
                        <div key={p.id} className="space-y-1.5 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{p.name}</span>
                              <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                              <span className="text-xs text-muted-foreground">#{p.id} · {p.source}</span>
                            </div>
                            {p.status === "active" && (
                              <Button
                                size="xs"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                disabled={revoke.isPending}
                                onClick={async () => {
                                  if (await confirm({ title: `撤销套餐「${p.name}」？`, description: "剩余额度将被清零并记入账务流水，不可恢复。", danger: true, confirmText: "撤销" }))
                                    revoke.mutate(p.id);
                                }}
                              >
                                撤销
                              </Button>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <Progress value={p.total_tokens ? (remain / p.total_tokens) * 100 : 0} className="h-1.5 flex-1" />
                            <span className="num shrink-0 text-xs">
                              {compact(remain)} / {compact(p.total_tokens)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {p.scope_type === "all" ? SCOPE_TYPE.all : `${SCOPE_TYPE[p.scope_type]}：${p.scope_values.join("、")}`} · 权重 {Number(p.input_weight)}/
                            {Number(p.output_weight)} · {dt(p.starts_at, "YYYY-MM-DD")} ~ {dt(p.expires_at, "YYYY-MM-DD")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">相关记录</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["调用日志", `/logs?user_id=${u.id}`],
                    ["账务流水", `/ledger?user_id=${u.id}`],
                    ["订单", `/orders?user_id=${u.id}`],
                    ["账单", `/statements?user_id=${u.id}`],
                  ].map(([label, to]) => (
                    <Button key={to} size="sm" variant="secondary" asChild>
                      <Link to={to}>
                        {label}
                        <ExternalLink />
                      </Link>
                    </Button>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
