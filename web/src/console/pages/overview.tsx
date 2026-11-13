import { ArrowRight, BookOpen, Coins, FlaskConical, KeyRound, Megaphone, Package, Wallet, Zap } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { StatusBadge, type Tone } from "@/components/misc";
import { Empty, Section, StatCard } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { compact, dt, fromNow, money, num } from "@/lib/format";
import { useAuth } from "../auth";
import { Markdown } from "../components/markdown";
import { PackageScope, TokenProgress } from "../components/scope";
import { UsageTrendChart } from "../components/usage-chart";
import { useAnnouncements, useOverview, useUsageStats } from "../lib/data";

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 12) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

const LEVEL_TONE: Record<string, Tone> = { info: "info", success: "success", warning: "warning", error: "danger" };
const LEVEL_LABEL: Record<string, string> = { info: "通知", success: "活动", warning: "注意", error: "重要" };

export default function OverviewPage() {
  const user = useAuth((s) => s.user);
  const ov = useOverview();
  const [days, setDays] = useState(7);
  const stats = useUsageStats(days);
  const ann = useAnnouncements();
  const d = ov.data;
  const pkgRemain = d?.packages.reduce((a, p) => a + p.remaining_tokens, 0) ?? 0;
  const [openAnn, setOpenAnn] = useState<number | null>(null);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {greeting()}，{user?.display_name || user?.username}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            当前分组 <span className="font-medium text-foreground">{d?.group ?? user?.group}</span> · 已创建 {d?.token_count ?? "-"} 个 API Key · 累计请求 {num(d?.request_count)} 次
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/console/playground">
              <FlaskConical /> 操练场
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/console/tokens?create=1">
              <KeyRound /> 创建 API Key
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="可用余额"
          icon={<Wallet />}
          loading={ov.isLoading}
          value={money(d?.wallet.balance)}
          hint={
            <div className="flex items-center justify-between">
              <span>{d?.wallet.frozen ? `冻结中 ${money(d.wallet.frozen)}` : "无冻结金额"}</span>
              <Link to="/console/wallet" className="font-medium text-primary hover:underline">
                充值
              </Link>
            </div>
          }
        />
        <StatCard
          label="套餐剩余 Token"
          icon={<Package />}
          loading={ov.isLoading}
          value={compact(pkgRemain)}
          hint={
            <div className="flex items-center justify-between">
              <span>{d?.packages.length ? `${d.packages.length} 个生效中的套餐` : "暂无生效套餐"}</span>
              <Link to="/console/packages" className="font-medium text-primary hover:underline">
                购买
              </Link>
            </div>
          }
        />
        <StatCard
          label="今日请求"
          icon={<Zap />}
          loading={ov.isLoading}
          value={num(d?.today.requests)}
          hint={`输入 ${compact(d?.today.prompt_tokens)} · 输出 ${compact(d?.today.completion_tokens)} tokens`}
        />
        <StatCard
          label="今日消费"
          icon={<Coins />}
          loading={ov.isLoading}
          value={money(d?.today.wallet_amount)}
          hint={
            <span>
              套餐抵扣 {compact(d?.today.package_tokens)} tokens · 累计充值 {money(d?.wallet.total_recharged)} / 消费 {money(d?.wallet.total_consumed)}
            </span>
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Section
          className="xl:col-span-2"
          title="用量趋势"
          description="按天统计的调用量与消费（消费金额含套餐抵扣折算）"
          actions={
            <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <TabsList className="h-8">
                <TabsTrigger value="7" className="text-xs">
                  近 7 天
                </TabsTrigger>
                <TabsTrigger value="30" className="text-xs">
                  近 30 天
                </TabsTrigger>
              </TabsList>
            </Tabs>
          }
        >
          <UsageTrendChart data={stats.data} days={days} loading={stats.isLoading} />
        </Section>

        <Section title="模型用量" description={`近 ${days} 天按消费排序`}>
          {stats.isLoading ? (
            <Skeleton className="h-48" />
          ) : stats.data?.by_model.length ? (
            <div className="space-y-3">
              {stats.data.by_model.slice(0, 6).map((m) => {
                const max = stats.data!.by_model[0].amount || 1;
                return (
                  <div key={m.model} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-mono text-xs">{m.model}</span>
                      <span className="num shrink-0 font-medium">{money(m.amount)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(2, (m.amount / max) * 100)}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {num(m.requests)} 次请求 · {compact(m.tokens)} tokens
                    </div>
                  </div>
                );
              })}
              {stats.data.by_model.length > 6 && (
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link to="/console/billing?tab=usage">查看全部</Link>
                </Button>
              )}
            </div>
          ) : (
            <Empty title="暂无调用" description="创建 API Key 或在操练场发起一次对话吧" />
          )}
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Section
          className="xl:col-span-2"
          title="我的套餐"
          description="套餐优先于余额抵扣，多个套餐按到期时间先后使用"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link to="/console/packages?tab=mine">
                全部 <ArrowRight />
              </Link>
            </Button>
          }
        >
          {ov.isLoading ? (
            <Skeleton className="h-24" />
          ) : d?.packages.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {d.packages.map((p) => (
                <div key={p.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{p.name}</div>
                    <span className="shrink-0 text-xs text-muted-foreground" title={dt(p.expires_at)}>
                      {fromNow(p.expires_at)}到期
                    </span>
                  </div>
                  <TokenProgress remaining={p.remaining_tokens} total={p.total_tokens} />
                  <PackageScope type={p.scope_type} values={p.scope_values} max={3} />
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="暂无生效中的套餐"
              description="套餐包单价更低，适合稳定的高频调用"
              action={
                <Button asChild size="sm">
                  <Link to="/console/packages">浏览套餐</Link>
                </Button>
              }
            />
          )}
        </Section>

        <div className="space-y-6">
          <Section title="快速开始">
            <div className="space-y-2">
              {[
                { to: "/console/tokens?create=1", icon: KeyRound, t: "创建 API Key", d: "为你的应用生成调用凭证" },
                { to: "/console/playground", icon: FlaskConical, t: "在线体验", d: "在操练场直接与模型对话" },
                { to: "/docs", icon: BookOpen, t: "阅读接入文档", d: "OpenAI / Anthropic SDK、Claude Code" },
              ].map((x) => (
                <Link key={x.to} to={x.to} className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <x.icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{x.t}</div>
                    <div className="truncate text-xs text-muted-foreground">{x.d}</div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </Section>

          <Section title="最新公告">
            {ann.isLoading ? (
              <Skeleton className="h-20" />
            ) : ann.data?.length ? (
              <div className="-mx-2 divide-y">
                {ann.data.slice(0, 5).map((a) => (
                  <div key={a.id} className="px-2 py-2.5">
                    <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpenAnn(openAnn === a.id ? null : a.id)}>
                      <StatusBadge tone={LEVEL_TONE[a.level] ?? "info"} className="shrink-0">
                        {a.pinned ? "置顶" : LEVEL_LABEL[a.level] ?? "通知"}
                      </StatusBadge>
                      <span className="min-w-0 flex-1 text-sm font-medium">{a.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{fromNow(a.created_at)}</span>
                    </button>
                    {openAnn === a.id && <Markdown className="mt-2 text-muted-foreground">{a.content}</Markdown>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Megaphone className="size-4" /> 暂无公告
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
