import { ArrowRight, BarChart3, Boxes, Coins, Network, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { Link } from "react-router";
import { VendorIcon } from "@/components/misc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "../auth";
import { CodeTabs } from "../components/code-block";
import { Markdown } from "../components/markdown";
import { curlAnthropic, curlOpenAI, pythonOpenAI } from "../components/snippets";
import { useBaseUrl, useMarketplace } from "../lib/data";
import { useSite } from "../site";

const FEATURES = [
  { icon: Boxes, title: "多厂商统一接入", desc: "OpenAI、Anthropic、DeepSeek 等主流模型，一个 API Key 全部搞定，无需逐家注册与充值。" },
  { icon: Workflow, title: "OpenAI & Anthropic 双协议兼容", desc: "原生支持 /v1/chat/completions 与 /v1/messages，现有 SDK、Claude Code 只需改 Base URL。" },
  { icon: Coins, title: "按量 + 套餐包灵活计费", desc: "余额按实际 token 用量扣费；高频场景可购买套餐包，单价更低，优先抵扣。" },
  { icon: BarChart3, title: "实时用量与账单", desc: "每一次调用都有日志，消费明细、日账单、月账单清晰可查，费用心中有数。" },
  { icon: Network, title: "高可用多渠道路由", desc: "多上游渠道智能调度与自动重试，单点故障自动切换，保障业务稳定。" },
  { icon: ShieldCheck, title: "企业级安全", desc: "Key 独立额度、模型白名单、IP 白名单、RPM 限流，细粒度控制每一个调用方。" },
];

export default function HomePage() {
  const site = useSite();
  const mk = useMarketplace();
  const token = useAuth((s) => s.token);
  const base = useBaseUrl();
  const name = site.data?.["site.name"] ?? "Token Market";
  const custom = site.data?.["site.home_content"]?.trim();
  const models = mk.data?.models ?? [];
  const vendorsUsed = new Set(models.map((m) => m.vendor?.name).filter(Boolean));
  const sample = models[0]?.name ?? "gpt-4o-mini";
  const showcaseVendors = (mk.data?.vendors ?? []).filter((v) => v.name !== "mock");

  return (
    <div className="relative overflow-hidden">
      {/* 背景装饰 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] opacity-[0.35] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
      />

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 pt-16 pb-12 sm:pt-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Link
            to="/models"
            className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
          >
            <Sparkles className="size-3.5 text-primary" />
            已接入 {mk.isLoading ? "…" : models.length} 个模型，持续更新中
            <ArrowRight className="size-3" />
          </Link>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            一个 API Key
            <br />
            <span className="bg-gradient-to-r from-primary to-chart-4 bg-clip-text text-transparent">接入全球主流大模型</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg">
            {name} 提供兼容 OpenAI 与 Anthropic 协议的统一接口，按量计费、套餐优惠、实时账单，几分钟即可把应用切换到更稳定、更划算的模型服务。
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 px-6">
              <Link to={token ? "/console" : "/register"}>
                {token ? "进入控制台" : "免费注册"}
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-6">
              <Link to="/models">浏览模型</Link>
            </Button>
          </div>
        </div>

        {/* 统计 */}
        <div className="mx-auto mt-14 grid max-w-3xl grid-cols-3 divide-x rounded-xl border bg-card/60 backdrop-blur">
          {[
            { label: "可用模型", value: models.length },
            { label: "模型厂商", value: vendorsUsed.size },
            { label: "协议兼容", value: "2 种" },
          ].map((s) => (
            <div key={s.label} className="px-4 py-5 text-center">
              <div className="num text-2xl font-semibold tracking-tight sm:text-3xl">{mk.isLoading ? <Skeleton className="mx-auto h-8 w-12" /> : s.value}</div>
              <div className="mt-1 text-xs text-muted-foreground sm:text-sm">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 厂商 */}
      {showcaseVendors.length > 0 && (
        <section className="mx-auto max-w-5xl px-4 pb-8">
          <p className="text-center text-xs tracking-widest text-muted-foreground uppercase">主流厂商模型 一站接入</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            {showcaseVendors.map((v) => (
              <div key={v.name} className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <VendorIcon vendor={v.name} icon={v.icon} size={24} />
                {v.display_name}
              </div>
            ))}
          </div>
        </section>
      )}

      {custom ? (
        <section className="mx-auto max-w-4xl px-4 py-12">
          <Markdown className="text-base">{custom}</Markdown>
        </section>
      ) : null}

      {/* 特性 */}
      <section className="mx-auto max-w-7xl px-4 py-16 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">为生产环境而生的模型网关</h2>
          <p className="mt-3 text-muted-foreground">稳定、透明、可控 —— 把精力留给你的产品。</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-xl border bg-card p-6 transition-colors hover:border-primary/40">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <f.icon className="size-5" />
              </div>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 代码 */}
      <section className="mx-auto max-w-7xl px-4 py-16 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">三行配置，即刻接入</h2>
            <p className="mt-3 text-muted-foreground">无需改动业务代码。把 Base URL 指向我们，换上你的 API Key，就能调用全部模型。</p>
            <ol className="mt-8 space-y-5">
              {[
                ["注册账户", "注册即可获得控制台，充值或购买套餐包"],
                ["创建 API Key", "在控制台为每个应用创建独立 Key，可设置额度与白名单"],
                ["发起调用", "使用任意 OpenAI / Anthropic SDK，替换 Base URL 即可"],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="num flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-semibold">{i + 1}</span>
                  <div>
                    <div className="font-medium">{t}</div>
                    <div className="text-sm text-muted-foreground">{d}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex gap-3">
              <Button asChild variant="outline">
                <Link to="/docs">查看接入文档</Link>
              </Button>
            </div>
          </div>
          <CodeTabs
            className="shadow-xl shadow-primary/5"
            tabs={[
              { key: "curl", label: "cURL", code: curlOpenAI(base, sample) },
              { key: "py", label: "Python", code: pythonOpenAI(base, sample) },
              { key: "anthropic", label: "Anthropic 格式", code: curlAnthropic(base, sample) },
            ]}
          />
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 pt-8 pb-20 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl border bg-primary px-6 py-12 text-center text-primary-foreground sm:px-12">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(50%_80%_at_80%_0%,rgb(255_255_255/0.18),transparent)]" />
          <h2 className="relative text-2xl font-semibold tracking-tight sm:text-3xl">现在开始，用更低成本调用顶级模型</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-primary-foreground/80">注册即用，按量付费无最低消费；套餐包更享专属优惠。</p>
          <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" variant="secondary" className="h-11 px-6">
              <Link to={token ? "/console" : "/register"}>{token ? "进入控制台" : "免费注册"}</Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-11 px-6 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground">
              <Link to="/models">
                查看模型价格 <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
