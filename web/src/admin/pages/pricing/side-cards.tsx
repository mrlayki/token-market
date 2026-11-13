import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Calculator } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/misc";
import { Section } from "@/components/page";
import { api, toastError } from "@/lib/api";
import { money } from "@/lib/format";
import { AffixInput, Field, SubmitButton, toNum } from "../../components/form";
import { Combobox } from "../../components/tag-input";
import { useAllModels, useGroups } from "../../lib/queries";
import { ratioLabel } from "./price-utils";

interface PreviewResult {
  base_cost: number;
  cost: number;
  group_ratio: string;
  time_multiplier: string;
  period: string;
}

export function PreviewCard() {
  const models = useAllModels();
  const groups = useGroups();
  const [model, setModel] = useState("");
  const [group, setGroup] = useState("default");
  const [prompt, setPrompt] = useState("1000");
  const [completion, setCompletion] = useState("1000");
  const [cache, setCache] = useState("0");
  const [at, setAt] = useState("");
  const run = useMutation({
    mutationFn: () =>
      api.post<PreviewResult>("/api/admin/prices/preview", {
        model,
        group,
        prompt_tokens: toNum(prompt),
        completion_tokens: toNum(completion),
        cache_read_tokens: toNum(cache),
        at: at ? new Date(at).toISOString() : null,
      }),
    onError: toastError,
  });
  const priced = (models.data ?? []).filter((m) => m.price);
  const r = run.data;
  return (
    <Section title="价格试算" description="按当前生效价格与分组倍率计算一次调用的费用">
      <div className="grid grid-cols-2 gap-3">
        <Field label="模型" className="col-span-2">
          <Combobox
            options={priced.map((m) => ({ value: m.name, label: <span className="font-mono text-xs">{m.name}</span> }))}
            value={model}
            onChange={(v) => {
              setModel(v);
              run.reset();
            }}
            placeholder="选择已定价模型"
          />
        </Field>
        <Field label="用户分组" className="col-span-2">
          <Select value={group} onValueChange={(v) => (setGroup(v), run.reset())}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(groups.data ?? [{ name: "default", display_name: "默认分组", price_ratio: "1" }]).map((g) => (
                <SelectItem key={g.name} value={g.name}>
                  {g.display_name}（{ratioLabel(g.price_ratio)}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="输入 tokens">
          <AffixInput type="number" min={0} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </Field>
        <Field label="输出 tokens">
          <AffixInput type="number" min={0} value={completion} onChange={(e) => setCompletion(e.target.value)} />
        </Field>
        <Field label="其中缓存命中 tokens" className="col-span-2" hint="计入输入 tokens 之内">
          <AffixInput type="number" min={0} value={cache} onChange={(e) => setCache(e.target.value)} />
        </Field>
        <Field label="计价时间" className="col-span-2" hint="用于匹配分时规则，留空为当前时间">
          <AffixInput type="datetime-local" value={at} onChange={(e) => (setAt(e.target.value), run.reset())} />
        </Field>
      </div>
      <SubmitButton className="mt-4 w-full" variant="secondary" loading={run.isPending} disabled={!model} onClick={() => run.mutate()}>
        <Calculator />
        计算
      </SubmitButton>
      {r && (
        <div className="mt-4 grid grid-cols-4 gap-2 rounded-lg border bg-muted/30 p-3 text-center">
          <div>
            <div className="text-xs text-muted-foreground">模型原价</div>
            <div className="num mt-1 font-medium">{money(r.base_cost, { precise: true })}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">时段</div>
            <div className="num mt-1 font-medium">{r.period ? `${r.period} ×${parseFloat(r.time_multiplier)}` : "基础价"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">分组倍率</div>
            <div className="num mt-1 font-medium">×{parseFloat(r.group_ratio)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">用户实付</div>
            <div className="num mt-1 font-semibold text-primary">{money(r.cost, { precise: true })}</div>
          </div>
        </div>
      )}
    </Section>
  );
}

export function GroupRatioCard() {
  const groups = useGroups();
  return (
    <Section
      title="分组倍率"
      description="用户实际价格 = 模型价格 × 所属分组倍率"
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/groups">
            管理分组
            <ArrowRight />
          </Link>
        </Button>
      }
    >
      {groups.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {groups.data?.map((g) => (
            <div key={g.name} className="flex items-center justify-between px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{g.display_name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {g.name} · {g.user_count} 位用户
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="num text-xs text-muted-foreground">×{parseFloat(g.price_ratio)}</span>
                <StatusBadge tone={Number(g.price_ratio) < 1 ? "success" : Number(g.price_ratio) > 1 ? "warning" : "muted"}>
                  {ratioLabel(g.price_ratio)}
                </StatusBadge>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
