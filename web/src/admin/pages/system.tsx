import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Database, Loader2, RefreshCw, Server, Settings2, Workflow, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader, KV } from "@/components/page";
import { StatusBadge } from "@/components/misc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dayjs, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SystemHealth } from "../lib/types";

const QUOTA_MODE: Record<string, string> = { lua: "Redis Lua 原子扣减", naive: "非原子先查后扣（压测对比）" };
const FAIL_MODE: Record<string, string> = { pg_fallback: "降级到数据库", fail_closed: "拒绝请求" };

function HealthCard({
  title,
  icon,
  ok,
  loading,
  children,
}: {
  title: string;
  icon: ReactNode;
  ok?: boolean;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
        {loading ? (
          <Skeleton className="h-5 w-12" />
        ) : ok === undefined ? null : ok ? (
          <StatusBadge tone="success" dot>
            正常
          </StatusBadge>
        ) : (
          <StatusBadge tone="danger" dot>
            异常
          </StatusBadge>
        )}
      </CardHeader>
      <CardContent className="px-4">{loading ? <Skeleton className="h-16 w-full" /> : children}</CardContent>
    </Card>
  );
}

function Metric({ label, value, warn, hint }: { label: string; value: ReactNode; warn?: boolean; hint?: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("num mt-0.5 text-lg font-semibold", warn && "text-destructive")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function SystemPage() {
  const q = useQuery({
    queryKey: ["admin", "system-health"],
    queryFn: () => api.get<SystemHealth>("/api/admin/system/health"),
    refetchInterval: 10_000,
  });
  const h = q.data;
  const loading = q.isLoading;
  const stream = h?.usage_stream;
  const pending = stream?.groups.reduce((a, g) => a + g.pending, 0) ?? 0;
  const lag = stream?.groups.reduce((a, g) => a + (g.lag ?? 0), 0) ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="系统状态"
        description={
          <>
            核心依赖与计量链路健康度，每 10 秒自动刷新
            {q.dataUpdatedAt > 0 && <span className="ml-2 num">· 更新于 {dayjs(q.dataUpdatedAt).format("HH:mm:ss")}</span>}
          </>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新
          </Button>
        }
      />
      {q.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          无法获取系统状态：{(q.error as Error).message}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <HealthCard title="PostgreSQL" icon={<Database />} ok={h?.postgres.ok} loading={loading}>
          {h?.postgres.ok ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" />
              连接正常，主库可读写
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <span className="break-all">{h?.postgres.error}</span>
            </p>
          )}
        </HealthCard>
        <HealthCard title="Redis" icon={<Server />} ok={h?.redis.ok} loading={loading}>
          {h?.redis.ok ? (
            <div className="grid grid-cols-2 gap-2">
              <Metric label="内存占用" value={h.redis.used_memory_human ?? "-"} />
              <Metric label="进行中预扣" value={num(h.reservations_inflight)} hint="未结算的额度预留" />
            </div>
          ) : (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <span className="break-all">{h?.redis.error}</span>
            </p>
          )}
        </HealthCard>
        <HealthCard title="运行配置" icon={<Settings2 />} loading={loading}>
          <KV
            items={[
              ["额度模式", <span key="q">{QUOTA_MODE[h?.config.quota_mode ?? ""] ?? h?.config.quota_mode} <code className="text-xs text-muted-foreground">{h?.config.quota_mode}</code></span>],
              ["Redis 故障策略", <span key="f">{FAIL_MODE[h?.config.redis_fail_mode ?? ""] ?? h?.config.redis_fail_mode} <code className="text-xs text-muted-foreground">{h?.config.redis_fail_mode}</code></span>],
            ]}
          />
        </HealthCard>
        <HealthCard
          title="计量流（Usage Stream）"
          icon={<Workflow />}
          ok={stream ? stream.dlq === 0 && pending < 1000 : undefined}
          loading={loading}
        >
          {stream ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="队列长度" value={num(stream.length)} />
                <Metric label="待确认" value={num(pending)} warn={pending > 1000} />
                <Metric label="消费滞后" value={num(lag)} warn={lag > 1000} />
                <Metric label="死信 DLQ" value={num(stream.dlq)} warn={stream.dlq > 0} />
              </div>
              {stream.groups.length > 0 && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {stream.groups.map((g) => (
                    <div key={g.name} className="flex justify-between">
                      <span className="font-mono">消费组 {g.name}</span>
                      <span className="num">
                        pending {g.pending} · lag {g.lag ?? "-"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Redis 不可用，无法读取计量流</p>
          )}
        </HealthCard>
        <HealthCard title="额度同步 Outbox" icon={<RefreshCw />} ok={h ? h.outbox_pending < 100 : undefined} loading={loading}>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="待同步到 Redis" value={num(h?.outbox_pending)} warn={(h?.outbox_pending ?? 0) >= 100} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">数据库余额变更后需同步到 Redis 热数据；持续积压说明同步任务异常。</p>
        </HealthCard>
      </div>
    </div>
  );
}
