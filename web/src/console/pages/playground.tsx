import { matchTimeRule } from "@/lib/time-rules";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bot, Check, Copy, Eraser, Info, Loader2, RefreshCw, Settings2, Square, TriangleAlert, User } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Mono, VendorIcon, copyText } from "@/components/misc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authHeaders } from "@/lib/api";
import { money, ms, num, pricePerM } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketModel } from "@/api/types";
import { Markdown } from "../components/markdown";
import { estimateCost, ratioText, scalePrice, useMarketplace, useMyGroupRatio } from "../lib/data";

interface Meta {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  first_ms?: number;
  total_ms?: number;
  request_id?: string;
  cost?: number | null;
  period?: string;
  model?: string;
  stopped?: boolean;
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  meta?: Meta;
  error?: { status: number; message: string; code?: string };
  pending?: boolean;
}

const SETTINGS_KEY = "tm_playground_settings";

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<{ model: string; system: string; temperature: number; maxTokens: string; stream: boolean }>;
  } catch {
    return {};
  }
}

const uid = () => Math.random().toString(36).slice(2);

export default function PlaygroundPage() {
  const mk = useMarketplace();
  const qc = useQueryClient();
  const { ratio, label: groupLabel } = useMyGroupRatio();
  const saved = useMemo(loadSettings, []);
  const [model, setModel] = useState(saved.model ?? "");
  const [system, setSystem] = useState(saved.system ?? "");
  const [temperature, setTemperature] = useState(saved.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(saved.maxTokens ?? "");
  const [stream, setStream] = useState(saved.stream ?? true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const chatModels = useMemo(() => (mk.data?.models ?? []).filter((m) => m.endpoints.includes("openai") && m.mode !== "embedding"), [mk.data]);
  const current = chatModels.find((m) => m.name === model);

  useEffect(() => {
    if (!model && chatModels.length) setModel(chatModels[0].name);
    else if (model && chatModels.length && !chatModels.some((m) => m.name === model)) setModel(chatModels[0].name);
  }, [chatModels, model]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ model, system, temperature, maxTokens, stream }));
    } catch {
      /* ignore */
    }
  }, [model, system, temperature, maxTokens, stream]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const update = (id: string, fn: (m: Msg) => Msg) => setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  async function run(history: Msg[]) {
    if (!current) return;
    const asst: Msg = { id: uid(), role: "assistant", content: "", pending: true };
    setMessages([...history, asst]);
    setBusy(true);
    stickRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const body: Record<string, unknown> = {
      model: current.name,
      messages: [...(system.trim() ? [{ role: "system", content: system.trim() }] : []), ...history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }))],
      temperature,
      stream,
    };
    if (Number(maxTokens) > 0) body.max_tokens = Number(maxTokens);
    if (stream) body.stream_options = { include_usage: true };

    const t0 = performance.now();
    const startedAt = new Date();
    const meta: Meta = { model: current.name };
    let content = "";
    let reasoning = "";
    try {
      const res = await fetch("/api/console/playground/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      meta.request_id = res.headers.get("x-request-id") || undefined;
      if (!res.ok) {
        const text = await res.text();
        let message = `请求失败（${res.status}）`;
        let code: string | undefined;
        try {
          const j = JSON.parse(text);
          message = j?.error?.message ?? j?.message ?? message;
          code = j?.error?.code ?? j?.code;
        } catch {
          if (text) message = text.slice(0, 300);
        }
        update(asst.id, (m) => ({ ...m, pending: false, error: { status: res.status, message, code }, meta }));
        return;
      }
      const applyUsage = (u: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined) => {
        if (!u) return;
        meta.prompt_tokens = u.prompt_tokens;
        meta.completion_tokens = u.completion_tokens;
        meta.cached_tokens = u.prompt_tokens_details?.cached_tokens ?? 0;
      };
      if (!stream || !res.body || !res.headers.get("content-type")?.includes("event-stream")) {
        const j = await res.json();
        content = j?.choices?.[0]?.message?.content ?? "";
        reasoning = j?.choices?.[0]?.message?.reasoning_content ?? "";
        applyUsage(j?.usage);
        meta.first_ms = meta.total_ms = Math.round(performance.now() - t0);
      } else {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let last = 0;
        const flush = (force = false) => {
          const now = performance.now();
          if (!force && now - last < 40) return;
          last = now;
          update(asst.id, (m) => ({ ...m, content, reasoning, meta: { ...meta } }));
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let j: any;
            try {
              j = JSON.parse(data);
            } catch {
              continue;
            }
            if (j.error) throw Object.assign(new Error(j.error.message ?? "上游错误"), { status: 502, code: j.error.code });
            const delta = j.choices?.[0]?.delta;
            if (delta?.content || delta?.reasoning_content) {
              if (meta.first_ms == null) meta.first_ms = Math.round(performance.now() - t0);
              content += delta.content ?? "";
              reasoning += delta.reasoning_content ?? "";
            }
            if (j.usage) applyUsage(j.usage);
          }
          flush();
        }
        meta.total_ms = Math.round(performance.now() - t0);
      }
      const period = matchTimeRule(current?.price.time_rules, startedAt);
      meta.period = period ? `${period.name} ×${parseFloat(String(period.multiplier))}` : undefined;
      meta.cost =
        meta.prompt_tokens != null
          ? Math.ceil(
              (estimateCost(current, ratio, { prompt: meta.prompt_tokens ?? 0, completion: meta.completion_tokens ?? 0, cached: meta.cached_tokens }) ?? 0) *
                (period ? Number(period.multiplier) : 1),
            )
          : null;
      update(asst.id, (m) => ({ ...m, content, reasoning, pending: false, meta: { ...meta } }));
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      meta.total_ms = Math.round(performance.now() - t0);
      if (aborted) {
        update(asst.id, (m) => ({ ...m, content, reasoning, pending: false, meta: { ...meta, stopped: true } }));
      } else {
        const err = e as Error & { status?: number; code?: string };
        update(asst.id, (m) => ({ ...m, content, reasoning, pending: false, meta: { ...meta }, error: { status: err.status ?? 0, message: err.message || "网络错误", code: err.code } }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      // 计费为异步结算，稍后刷新余额与用量
      setTimeout(() => qc.invalidateQueries({ queryKey: ["console"] }), 800);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || busy || !current) return;
    setInput("");
    run([...messages, { id: uid(), role: "user", content: text }]);
  }

  function regenerate() {
    if (busy) return;
    const idx = [...messages].reverse().findIndex((m) => m.role === "user");
    if (idx < 0) return;
    run(messages.slice(0, messages.length - idx));
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const grouped = useMemo(() => {
    const g = new Map<string, MarketModel[]>();
    for (const m of chatModels) {
      const k = m.vendor?.display_name ?? "其他";
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g.entries()];
  }, [chatModels]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="flex h-[calc(100svh-7.5rem)] min-h-[520px] gap-4">
      {/* 设置 */}
      <Card className="hidden w-80 shrink-0 gap-0 overflow-y-auto py-0 lg:flex">
        <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
          <Settings2 className="size-4" /> 参数设置
        </div>
        <div className="space-y-5 p-4">
          <div className="space-y-2">
            <Label>模型</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={mk.isLoading ? "加载中…" : "选择模型"} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {grouped.map(([vendor, list]) => (
                  <SelectGroup key={vendor}>
                    <SelectLabel>{vendor}</SelectLabel>
                    {list.map((m) => (
                      <SelectItem key={m.name} value={m.name}>
                        <VendorIcon vendor={m.vendor?.name} size={16} className="rounded" />
                        <span className="font-mono text-xs">{m.name}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {current && <ModelPrice m={current} ratio={ratio} group={groupLabel} />}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pg-system">系统提示词</Label>
            <Textarea id="pg-system" rows={5} value={system} onChange={(e) => setSystem(e.target.value)} placeholder="例如：你是一名资深的技术顾问，回答简洁准确。" className="text-sm" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <span className="num rounded bg-muted px-1.5 py-0.5 text-xs">{temperature.toFixed(1)}</span>
            </div>
            <Slider value={[temperature]} min={0} max={2} step={0.1} onValueChange={(v) => setTemperature(v[0])} />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>精确</span>
              <span>创意</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pg-max">最大输出 tokens</Label>
            <Input id="pg-max" type="number" min={0} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder={current?.max_output_tokens ? `留空使用默认（上限 ${num(current.max_output_tokens)}）` : "留空使用默认"} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>流式输出</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">逐字返回，可随时停止</p>
            </div>
            <Switch checked={stream} onCheckedChange={setStream} />
          </div>
          <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>操练场调用与 API 调用计费规则一致，会消耗余额或套餐。中途停止生成时，按已生成内容计费。</span>
          </div>
        </div>
      </Card>

      {/* 对话 */}
      <Card className="flex min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          {current ? (
            <div className="flex min-w-0 items-center gap-2">
              <VendorIcon vendor={current.vendor?.name} size={22} />
              <span className="truncate font-mono text-sm">{current.name}</span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">请选择模型</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={busy || !lastAssistant} onClick={regenerate}>
              <RefreshCw /> 重新生成
            </Button>
            <Button variant="ghost" size="sm" disabled={busy || messages.length === 0} onClick={() => setMessages([])}>
              <Eraser /> 清空
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Bot className="size-6" />
              </div>
              <div className="text-lg font-medium">开始一段对话</div>
              <p className="max-w-sm text-sm text-muted-foreground">在下方输入消息，测试模型效果、调试提示词。每次回复都会显示 token 用量、耗时与预估费用。</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {["用三句话介绍一下你自己", "写一个 Python 快速排序并解释复杂度", "把「今天天气很好」翻译成英文和日文"].map((s) => (
                  <button key={s} type="button" onClick={() => setInput(s)} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
              {messages.map((m) => (
                <MessageItem key={m.id} m={m} />
              ))}
            </div>
          )}
        </div>

        <div className="border-t p-3">
          <div className="mx-auto max-w-3xl">
            <div className="relative rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/30">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                rows={2}
                placeholder={current ? "输入消息，Enter 发送，Shift + Enter 换行" : "请先选择模型"}
                className="max-h-48 min-h-[60px] resize-none border-0 bg-transparent pr-14 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              <div className="absolute right-2 bottom-2">
                {busy ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="secondary" className="size-9 rounded-lg" onClick={() => abortRef.current?.abort()}>
                        <Square className="size-3.5 fill-current" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>停止生成（按已生成内容计费）</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button size="icon" className="size-9 rounded-lg" disabled={!input.trim() || !current} onClick={send}>
                    <ArrowUp />
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-1.5 flex justify-between px-1 text-[11px] text-muted-foreground">
              <span>AI 生成内容仅供参考</span>
              <span className="lg:hidden">在更宽的屏幕上可调整参数</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ModelPrice({ m, ratio, group }: { m: MarketModel; ratio: number; group: string }) {
  const p = scalePrice(m.price, ratio);
  return (
    <div className="space-y-1 rounded-lg bg-muted/50 p-2.5 text-xs">
      {p.billing_type === "per_call" ? (
        <div className="flex justify-between">
          <span className="text-muted-foreground">按次</span>
          <span className="num">{money(p.per_call_price)} / 次</span>
        </div>
      ) : (
        <>
          <div className="flex justify-between">
            <span className="text-muted-foreground">输入</span>
            <span className="num">{pricePerM(p.input_price)} / 1M tokens</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">输出</span>
            <span className="num">{pricePerM(p.output_price)} / 1M tokens</span>
          </div>
        </>
      )}
      {ratio !== 1 && (
        <div className="text-[11px] text-muted-foreground">
          已按「{group}」分组倍率 {ratioText(ratio)} 计算
        </div>
      )}
    </div>
  );
}

function MessageItem({ m }: { m: Msg }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">{m.content}</div>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="size-4 text-muted-foreground" />
        </div>
      </div>
    );
  }
  const meta = m.meta;
  return (
    <div className="group flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {m.reasoning && (
          <details className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" open={m.pending && !m.content}>
            <summary className="cursor-pointer select-none">思考过程</summary>
            <div className="mt-2 whitespace-pre-wrap">{m.reasoning}</div>
          </details>
        )}
        {m.pending && !m.content && !m.reasoning ? (
          <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在思考…
          </div>
        ) : m.content ? (
          <Markdown>{m.content + (m.pending ? " ▍" : "")}</Markdown>
        ) : null}
        {m.error && <ErrorBox e={m.error} />}
        {meta?.stopped && <div className="text-xs text-warning">已停止生成，已生成部分将正常计费</div>}
        {!m.pending && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {m.content && (
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-foreground"
                onClick={async () => {
                  await copyText(m.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />} 复制
              </button>
            )}
            {meta?.prompt_tokens != null && (
              <span className="num">
                输入 {num(meta.prompt_tokens)}
                {meta.cached_tokens ? `（缓存 ${num(meta.cached_tokens)}）` : ""} / 输出 {num(meta.completion_tokens)} tokens
              </span>
            )}
            {meta?.first_ms != null && <span className="num">首字 {ms(meta.first_ms)}</span>}
            {meta?.total_ms != null && <span className="num">总耗时 {ms(meta.total_ms)}</span>}
            {meta?.cost != null && (
              <span className="num" title="按模型单价 × 分组倍率估算；适用套餐时将优先抵扣套餐，实际以账单为准">
                预估 <span className="text-foreground">{money(meta.cost)}</span>
                {meta.period && <span className="ml-1 text-warning">（{meta.period}）</span>}
              </span>
            )}
            {meta?.request_id && (
              <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" title="复制 Request ID" onClick={() => copyText(meta.request_id!, "Request ID 已复制")}>
                <Mono className="text-[11px]">{meta.request_id}</Mono>
                <Copy className="size-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ e }: { e: NonNullable<Msg["error"]> }) {
  const recharge = e.status === 402 && e.code !== "token_quota_exceeded";
  return (
    <div className={cn("flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm")}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-destructive">
          {recharge ? "余额不足" : "请求失败"}
          {e.status ? <span className="ml-1.5 font-normal opacity-70">HTTP {e.status}</span> : null}
          {e.code && <Mono className="ml-1.5 opacity-70">{e.code}</Mono>}
        </div>
        <div className="mt-0.5 break-words text-muted-foreground">{e.message}</div>
        {recharge && (
          <div className="mt-2 flex gap-2">
            <Button asChild size="sm">
              <Link to="/console/wallet">去充值</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/console/packages">购买套餐</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
