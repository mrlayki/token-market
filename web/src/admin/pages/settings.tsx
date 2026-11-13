import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/misc";
import { Empty, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, toastError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AffixInput, SubmitButton, yuanStr } from "../components/form";
import { JsonTextarea, parseJson } from "../components/json";
import { TagInput } from "../components/tag-input";
import { PAY_METHOD } from "../lib/labels";
import { useIsRoot } from "../lib/queries";
import type { SettingItem } from "../lib/types";

const GROUPS: { key: string; label: string; desc: string }[] = [
  { key: "site", label: "站点", desc: "站点名称、Logo、首页与协议内容" },
  { key: "auth", label: "注册登录", desc: "注册开关与登录方式" },
  { key: "billing", label: "计费", desc: "新用户赠送、透支与预扣估算" },
  { key: "payment", label: "支付", desc: "支付方式、充值档位与满额折扣" },
  { key: "channel", label: "渠道健康", desc: "失败重试、自动禁用与巡检策略" },
  { key: "ratelimit", label: "限流", desc: "全站与单用户请求频率限制" },
  { key: "notify", label: "通知", desc: "管理员告警推送" },
  { key: "recon", label: "对账", desc: "对账时区、允许误差、汇率与上游余额快照" },
  { key: "log", label: "日志", desc: "调用流水保留策略" },
];

type Kind = "bool" | "num" | "int" | "yuan" | "text" | "textarea" | "tags" | "numtags" | "methods" | "discounts" | "json";
type Row = { k: string; v: string };
type Draft = boolean | string | string[] | Row[];

function kindOf(it: SettingItem): Kind {
  const d = it.default;
  if (it.key === "payment.topup_options") return "numtags";
  if (it.key === "payment.methods") return "methods";
  if (it.key === "payment.discounts") return "discounts";
  if (typeof d === "boolean") return "bool";
  if (typeof d === "number") return it.description.includes("微元") ? "yuan" : it.key === "recon.tolerance_pct" ? "num" : "int";
  if (typeof d === "string") return /markdown|html/i.test(it.description) ? "textarea" : "text";
  if (Array.isArray(d) && d.every((x) => typeof x === "string")) return "tags";
  return "json";
}

function toDraft(kind: Kind, v: unknown): Draft {
  switch (kind) {
    case "bool":
      return Boolean(v);
    case "int":
    case "num":
      return String(v ?? 0);
    case "yuan":
      return yuanStr(Number(v ?? 0));
    case "text":
    case "textarea":
      return String(v ?? "");
    case "tags":
    case "methods":
      return Array.isArray(v) ? v.map(String) : [];
    case "numtags":
      return Array.isArray(v) ? v.map(String) : [];
    case "discounts":
      return v && typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => ({ k, v: String(x) })) : [];
    case "json":
      return JSON.stringify(v, null, 2);
  }
}

function fromDraft(kind: Kind, d: Draft): { value?: unknown; error?: string } {
  switch (kind) {
    case "bool":
      return { value: d as boolean };
    case "int": {
      const s = (d as string).trim();
      if (!/^-?\d+$/.test(s)) return { error: "请输入整数" };
      return { value: Number(s) };
    }
    case "num": {
      const s = (d as string).trim();
      if (s === "" || !Number.isFinite(Number(s))) return { error: "请输入数字" };
      return { value: Number(s) };
    }
    case "yuan": {
      const s = (d as string).trim();
      const n = Number(s);
      if (s === "" || !Number.isFinite(n)) return { error: "请输入金额" };
      return { value: Math.round(n * 1_000_000) };
    }
    case "text":
    case "textarea":
      return { value: d as string };
    case "tags":
    case "methods":
      return { value: d as string[] };
    case "numtags": {
      const arr = (d as string[]).map(Number);
      if (arr.some((n) => !Number.isFinite(n) || n <= 0)) return { error: "档位需为正数" };
      return { value: [...arr].sort((a, b) => a - b) };
    }
    case "discounts": {
      const out: Record<string, string> = {};
      for (const r of d as Row[]) {
        if (!r.k.trim() && !r.v.trim()) continue;
        const k = Number(r.k);
        const v = Number(r.v);
        if (!Number.isFinite(k) || k <= 0) return { error: "满额门槛需为正数" };
        if (!Number.isFinite(v) || v <= 0 || v > 1) return { error: "折扣需在 0~1 之间，如 0.95" };
        out[String(k)] = r.v.trim();
      }
      return { value: out };
    }
    case "json":
      return parseJson(d as string, "any");
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function SettingsPage() {
  const isRoot = useIsRoot();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api.get<SettingItem[]>("/api/admin/settings"),
    enabled: isRoot,
  });
  const items = useMemo(() => q.data ?? [], [q.data]);
  const kinds = useMemo(() => Object.fromEntries(items.map((it) => [it.key, kindOf(it)])) as Record<string, Kind>, [items]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [tab, setTab] = useState("site");

  useEffect(() => {
    setDrafts(Object.fromEntries(items.map((it) => [it.key, toDraft(kindOf(it), it.value)])));
  }, [items]);

  const parsed = useMemo(() => {
    const out: Record<string, { value?: unknown; error?: string; dirty: boolean }> = {};
    for (const it of items) {
      const d = drafts[it.key];
      if (d === undefined) continue;
      const r = fromDraft(kinds[it.key], d);
      out[it.key] = { ...r, dirty: r.error ? true : !same(r.value, it.value) };
    }
    return out;
  }, [drafts, items, kinds]);

  const dirtyKeys = Object.keys(parsed).filter((k) => parsed[k].dirty);
  const errorKeys = dirtyKeys.filter((k) => parsed[k].error);

  const save = useMutation({
    mutationFn: () =>
      api.put("/api/admin/settings", { values: Object.fromEntries(dirtyKeys.map((k) => [k, parsed[k].value])) }),
    onSuccess: () => {
      toast.success(`已保存 ${dirtyKeys.length} 项配置`);
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: toastError,
  });

  if (!isRoot)
    return (
      <div>
        <PageHeader title="系统设置" />
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Lock className="size-5 text-muted-foreground" />
              </div>
              <div className="font-medium">403 · 无权访问</div>
              <p className="text-sm text-muted-foreground">系统设置仅超级管理员可查看和修改</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  const setDraft = (k: string, v: Draft) => setDrafts((p) => ({ ...p, [k]: v }));

  return (
    <div className="pb-20">
      <PageHeader title="系统设置" description="运行时业务配置，保存后约 2 秒内在所有节点生效，无需重启" />
      {q.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <Empty title="加载失败" description={(q.error as Error).message} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto flex-wrap">
            {GROUPS.map((g) => {
              const n = dirtyKeys.filter((k) => k.startsWith(g.key + ".")).length;
              return (
                <TabsTrigger key={g.key} value={g.key} className="gap-1.5">
                  {g.label}
                  {n > 0 && <span className="num rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">{n}</span>}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {GROUPS.map((g) => (
            <TabsContent key={g.key} value={g.key}>
              <Card className="py-0">
                <CardContent className="px-0">
                  <div className="border-b px-5 py-3 text-sm text-muted-foreground">{g.desc}</div>
                  <div className="divide-y">
                    {items
                      .filter((it) => it.group === g.key)
                      .map((it) => (
                        <SettingRow
                          key={it.key}
                          item={it}
                          kind={kinds[it.key]}
                          draft={drafts[it.key]}
                          state={parsed[it.key]}
                          onChange={(v) => setDraft(it.key, v)}
                          onReset={() => setDraft(it.key, toDraft(kinds[it.key], it.default))}
                        />
                      ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {dirtyKeys.length > 0 && (
        <div className="fixed right-6 bottom-6 z-40 flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-lg">
          <span className="text-sm">
            已修改 <b className="num">{dirtyKeys.length}</b> 项
            {errorKeys.length > 0 && <span className="ml-2 text-destructive">{errorKeys.length} 项格式有误</span>}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setDrafts(Object.fromEntries(items.map((it) => [it.key, toDraft(kinds[it.key], it.value)])))}>
            放弃修改
          </Button>
          <SubmitButton size="sm" loading={save.isPending} disabled={errorKeys.length > 0} onClick={() => save.mutate()}>
            <Save />
            保存
          </SubmitButton>
        </div>
      )}
    </div>
  );
}

function SettingRow({
  item,
  kind,
  draft,
  state,
  onChange,
  onReset,
}: {
  item: SettingItem;
  kind: Kind;
  draft: Draft | undefined;
  state: { value?: unknown; error?: string; dirty: boolean } | undefined;
  onChange: (v: Draft) => void;
  onReset: () => void;
}) {
  if (draft === undefined) return null;
  const isDefault = state && !state.error && same(state.value, fromDraft(kind, toDraft(kind, item.default)).value);
  return (
    <div className={cn("grid gap-3 px-5 py-4 lg:grid-cols-[280px_1fr]", state?.dirty && "bg-primary/[0.03]")}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          {item.description.replace(/（微元）/, "")}
          {state?.dirty && <StatusBadge tone="default">已修改</StatusBadge>}
        </div>
        <code className="mt-0.5 block text-xs text-muted-foreground">{item.key}</code>
      </div>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <Control kind={kind} draft={draft} onChange={onChange} error={state?.error} />
          {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-8 shrink-0 text-muted-foreground" disabled={isDefault} onClick={onReset}>
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm break-all">恢复默认：{fmtDefault(kind, item.default)}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function fmtDefault(kind: Kind, d: unknown): string {
  if (kind === "bool") return d ? "开启" : "关闭";
  if (kind === "yuan") return `¥${yuanStr(Number(d))}`;
  if (typeof d === "string") return d === "" ? "（空）" : d;
  return JSON.stringify(d);
}

function Control({ kind, draft, onChange, error }: { kind: Kind; draft: Draft; onChange: (v: Draft) => void; error?: string }) {
  const errCls = error && "border-destructive";
  switch (kind) {
    case "bool":
      return <Switch checked={draft as boolean} onCheckedChange={onChange} />;
    case "num":
      return <Input type="number" step={0.1} value={draft as string} onChange={(e) => onChange(e.target.value)} className={cn("num w-48", errCls)} />;
    case "int":
      return <Input type="number" step={1} value={draft as string} onChange={(e) => onChange(e.target.value)} className={cn("num w-48", errCls)} />;
    case "yuan":
      return (
        <AffixInput
          type="number"
          step="0.01"
          prefix="¥"
          suffix="元"
          value={draft as string}
          onChange={(e) => onChange(e.target.value)}
          className={cn("w-48", errCls)}
        />
      );
    case "text":
      return <Input value={draft as string} onChange={(e) => onChange(e.target.value)} className="max-w-xl" />;
    case "textarea":
      return <Textarea value={draft as string} onChange={(e) => onChange(e.target.value)} rows={5} className="max-h-80 font-mono text-xs" />;
    case "tags":
      return <TagInput value={draft as string[]} onChange={onChange} placeholder="输入后回车添加，支持粘贴多行" />;
    case "numtags":
      return (
        <div className="max-w-xl">
          <TagInput value={draft as string[]} onChange={(v) => onChange(v.filter((x) => x !== ""))} placeholder="输入金额（元）后回车，如 100" />
          <p className="mt-1 text-xs text-muted-foreground">单位：元，用户充值页展示的快捷档位</p>
        </div>
      );
    case "methods": {
      const v = draft as string[];
      return (
        <div className="flex flex-wrap gap-4 pt-1">
          {Object.entries(PAY_METHOD)
            .filter(([k]) => k !== "balance")
            .map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox checked={v.includes(k)} onCheckedChange={(c) => onChange(c ? [...v, k] : v.filter((x) => x !== k))} />
                {label}
                <code className="text-xs text-muted-foreground">{k}</code>
              </label>
            ))}
        </div>
      );
    }
    case "discounts": {
      const rows = draft as Row[];
      const set = (i: number, p: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
      return (
        <div className="max-w-md space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">满</span>
              <AffixInput value={r.k} onChange={(e) => set(i, { k: e.target.value })} suffix="元" className="w-32" />
              <span className="text-muted-foreground">享</span>
              <Input value={r.v} onChange={(e) => set(i, { v: e.target.value })} className="num w-24" placeholder="0.95" />
              <span className="w-14 text-xs text-muted-foreground">
                {Number(r.v) > 0 && Number(r.v) <= 1 ? `${parseFloat((Number(r.v) * 10).toFixed(2))} 折` : ""}
              </span>
              <Button variant="ghost" size="icon-sm" className="size-8" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="xs" onClick={() => onChange([...rows, { k: "", v: "" }])}>
            <Plus />
            添加档位
          </Button>
        </div>
      );
    }
    case "json":
      return <JsonTextarea value={draft as string} onChange={onChange} error={error} rows={6} />;
  }
}
