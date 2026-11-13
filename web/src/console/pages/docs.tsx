import { ArrowRight, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CopyButton, Mono } from "@/components/misc";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useAuth } from "../auth";
import { CodeTabs } from "../components/code-block";
import { claudeCodeEnv, curlAnthropic, curlOpenAI, nodeOpenAI, pythonAnthropic, pythonOpenAI } from "../components/snippets";
import { useBaseUrl, useMarketplace } from "../lib/data";

const TOC = [
  { id: "quickstart", label: "快速开始" },
  { id: "base-url", label: "Base URL 与鉴权" },
  { id: "examples", label: "调用示例" },
  { id: "endpoints", label: "接口列表" },
  { id: "billing", label: "计费说明" },
  { id: "errors", label: "错误码" },
  { id: "faq", label: "常见问题" },
];

const ENDPOINTS = [
  ["POST", "/v1/chat/completions", "OpenAI Chat Completions 格式对话，支持 stream"],
  ["POST", "/v1/messages", "Anthropic Messages 格式对话，支持 stream，可直接用于 Claude Code"],
  ["POST", "/v1/embeddings", "文本向量化（Embeddings）"],
  ["GET", "/v1/models", "列出当前 Key 可用的模型"],
];

const ERRORS = [
  ["401", "invalid_api_key", "API Key 无效、已禁用、已过期或已删除", "检查 Authorization 头与 Key 状态"],
  ["402", "insufficient_quota", "账户余额不足且无可用套餐", "前往钱包充值或购买套餐包"],
  ["402", "token_quota_exceeded", "该 Key 的额度上限已用完", "在 API Key 设置中提高额度或改为不限额"],
  ["403", "model_not_allowed", "该 Key 设置了模型白名单，且不包含所请求模型", "编辑 Key 的模型白名单"],
  ["403", "ip_not_allowed", "请求来源 IP 不在该 Key 的 IP 白名单内", "编辑 Key 的 IP 白名单"],
  ["404", "model_not_found", "模型不存在或未上架", "到模型广场确认模型 ID 拼写"],
  ["429", "rate_limit_exceeded", "超出 Key 的 RPM 限制或平台限流", "降低请求频率，或稍后重试"],
  ["503", "no_available_channel", "当前分组下该模型暂无可用上游渠道", "稍后重试，或联系客服"],
];

const FAQ = [
  ["可以直接使用 OpenAI 官方 SDK 吗？", "可以。只需把 base_url 设为「Base URL/v1」，api_key 设为在控制台创建的 Key，其余代码无需修改。"],
  ["Claude Code 如何接入？", "设置环境变量 ANTHROPIC_BASE_URL（不带 /v1）与 ANTHROPIC_AUTH_TOKEN 为你的 Key 后启动 claude 即可，平台会以 Anthropic Messages 协议转发。"],
  ["余额和套餐包哪个先扣？", "调用时优先使用适用于该模型的套餐包（多个套餐按到期时间从早到晚依次使用），套餐不足的部分再从余额扣费。"],
  ["流式请求中途断开会怎么计费？", "按断开前上游已生成的 token 数计费；未生成的部分不收费。日志中状态显示为「客户端中断」。"],
  ["请求失败会扣费吗？", "不会。请求失败时预扣的额度会全额退回，调用日志中可查看失败原因。"],
  ["API Key 丢失了怎么办？", "出于安全考虑，完整 Key 只在创建时显示一次。如遗失，请删除旧 Key 并重新创建。"],
  ["充值的余额会过期吗？", "账户余额长期有效；套餐包有各自的有效期，过期后剩余额度自动失效。"],
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-xl font-semibold tracking-tight">
      <a href={`#${id}`} className="hover:underline">
        {children}
      </a>
    </h2>
  );
}

export default function DocsPage() {
  const base = useBaseUrl();
  const mk = useMarketplace();
  const token = useAuth((s) => s.token);
  const model = mk.data?.models.find((m) => m.endpoints.includes("openai"))?.name ?? "gpt-4o-mini";
  const claude = mk.data?.models.find((m) => m.endpoints.includes("anthropic"))?.name ?? "claude-sonnet-4-5";
  const [active, setActive] = useState(TOC[0].id);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    TOC.forEach((t) => {
      const el = document.getElementById(t.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="mx-auto flex max-w-7xl gap-10 px-4 py-10 lg:px-8">
      <aside className="hidden w-52 shrink-0 lg:block">
        <nav className="sticky top-24 space-y-0.5">
          <div className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">本页目录</div>
          {TOC.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className={cn(
                "block border-l-2 py-1.5 pl-3 text-sm transition-colors",
                active === t.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 flex-1 space-y-14 pb-20">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">接入文档</h1>
          <p className="mt-2 text-muted-foreground">兼容 OpenAI 与 Anthropic 协议，几分钟即可完成接入。</p>
        </header>

        <section className="space-y-5">
          <H2 id="quickstart">快速开始</H2>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { n: 1, t: "注册账户", d: "注册并登录控制台，充值余额或购买套餐包。", to: token ? "/console/wallet" : "/register", cta: token ? "去充值" : "免费注册" },
              { n: 2, t: "创建 API Key", d: "在「API Key」页面创建 Key，可设置额度、模型与 IP 白名单。", to: "/console/tokens", cta: "创建 Key" },
              { n: 3, t: "发起调用", d: "将 SDK 的 Base URL 指向本平台，填入 Key 即可调用。", to: "/models", cta: "选择模型" },
            ].map((s) => (
              <div key={s.n} className="flex flex-col rounded-xl border bg-card p-5">
                <span className="num flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{s.n}</span>
                <div className="mt-3 font-medium">{s.t}</div>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">{s.d}</p>
                <Button asChild variant="link" className="mt-2 h-auto justify-start p-0">
                  <Link to={s.to}>
                    {s.cta} <ArrowRight />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <H2 id="base-url">Base URL 与鉴权</H2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["OpenAI 兼容 Base URL", `${base}/v1`],
              ["Anthropic 兼容 Base URL", base],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">{k}</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="truncate font-mono text-sm">{v}</code>
                  <CopyButton text={v} />
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm leading-7 text-muted-foreground">
            OpenAI 格式请求使用请求头 <Mono className="rounded bg-muted px-1.5 py-0.5">Authorization: Bearer sk-xxx</Mono>；Anthropic 格式同时支持{" "}
            <Mono className="rounded bg-muted px-1.5 py-0.5">x-api-key: sk-xxx</Mono>。
          </p>
        </section>

        <section className="space-y-4">
          <H2 id="examples">调用示例</H2>
          <p className="text-sm text-muted-foreground">将示例中的 sk-xxxxxxxx 替换为你在控制台创建的 API Key。</p>
          <CodeTabs
            tabs={[
              { key: "curl", label: "cURL", code: curlOpenAI(base, model) },
              { key: "py", label: "Python (OpenAI SDK)", code: pythonOpenAI(base, model) },
              { key: "node", label: "Node.js", code: nodeOpenAI(base, model) },
              { key: "anthropic-curl", label: "Anthropic 格式", code: curlAnthropic(base, claude) },
              { key: "anthropic", label: "Anthropic SDK", code: pythonAnthropic(base, claude) },
              { key: "claude-code", label: "Claude Code", code: claudeCodeEnv(base) },
            ]}
          />
        </section>

        <section className="space-y-4">
          <H2 id="endpoints">接口列表</H2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-20 text-xs">方法</TableHead>
                  <TableHead className="text-xs">路径</TableHead>
                  <TableHead className="text-xs">说明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ENDPOINTS.map(([m, p, d]) => (
                  <TableRow key={p}>
                    <TableCell>
                      <span className={cn("rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold", m === "GET" ? "bg-success/10 text-success" : "bg-primary/10 text-primary")}>{m}</span>
                    </TableCell>
                    <TableCell>
                      <Mono>{p}</Mono>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-4">
          <H2 id="billing">计费说明</H2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["预扣 + 结算", "请求开始时按预估用量冻结额度，完成后按上游返回的实际 token 用量结算，多退少补。"],
              ["套餐优先", "适用于该模型的套餐包优先抵扣（按到期时间从早到晚），不足部分从余额扣除。套餐消耗 = 输入 × 输入权重 + 输出 × 输出权重。"],
              ["流式中断按已生成计费", "流式请求被客户端中断时，仅按中断前已生成的 token 计费。"],
              ["失败不计费", "上游报错、超时或无可用渠道时，预扣额度全额返还，不产生任何费用。"],
            ].map(([t, d]) => (
              <div key={t} className="rounded-lg border bg-card p-4">
                <div className="font-medium">{t}</div>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              单次费用 = (输入 tokens × 输入单价 + 输出 tokens × 输出单价) ÷ 1,000,000 × 分组倍率。命中缓存的输入按缓存读取单价计费。各模型单价见{" "}
              <Link to="/models" className="font-medium text-primary hover:underline">
                模型广场
              </Link>
              。
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <H2 id="errors">错误码</H2>
          <p className="text-sm text-muted-foreground">
            错误响应遵循 OpenAI 格式：<Mono className="rounded bg-muted px-1.5 py-0.5">{'{"error": {"message": "...", "type": "...", "code": "..."}}'}</Mono>
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-20 text-xs">HTTP</TableHead>
                  <TableHead className="text-xs">code</TableHead>
                  <TableHead className="text-xs">含义</TableHead>
                  <TableHead className="text-xs">处理建议</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ERRORS.map(([s, c, d, h]) => (
                  <TableRow key={c}>
                    <TableCell className="num font-medium">{s}</TableCell>
                    <TableCell>
                      <Mono>{c}</Mono>
                    </TableCell>
                    <TableCell>{d}</TableCell>
                    <TableCell className="text-muted-foreground">{h}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-4">
          <H2 id="faq">常见问题</H2>
          <div className="divide-y rounded-lg border bg-card">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {q}
                  <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </article>
    </div>
  );
}
