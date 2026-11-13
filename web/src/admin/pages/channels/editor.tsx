import type { TimeRule } from "@/api/types";
import { normalizeTimeRules, TimeRulesEditor, validateTimeRules } from "../../components/time-rules-editor";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CloudDownload, Library, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, toastError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Field, FormSection, SubmitButton } from "../../components/form";
import { JsonTextarea, parseJson, prettyJson } from "../../components/json";
import { MultiSelect, TagInput } from "../../components/tag-input";
import { qk, useAllModels, useChannelTags, useChannelTypes, useGroups } from "../../lib/queries";
import type { Channel } from "../../lib/types";
import { CHANNELS_KEY } from "./test";

interface MapRow {
  from: string;
  to: string;
}

interface FormState {
  type: string;
  name: string;
  base_url: string;
  keys: string;
  replace_keys: boolean;
  multi_key_mode: "random" | "polling";
  models: string[];
  mapping: MapRow[];
  groups: string[];
  priority: string;
  weight: string;
  test_model: string;
  cost_ratio: string;
  cost_time_rules: TimeRule[];
  auto_ban: boolean;
  param_override: string;
  header_override: string;
  tag: string;
  remark: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

function initial(c: Channel | null): FormState {
  return {
    type: c?.type ?? "openai",
    name: c?.name ?? "",
    base_url: c?.base_url ?? "",
    keys: "",
    replace_keys: false,
    multi_key_mode: c?.multi_key_mode ?? "random",
    models: c?.models ?? [],
    mapping: Object.entries(c?.model_mapping ?? {}).map(([from, to]) => ({ from, to: String(to) })),
    groups: c?.groups ?? ["default"],
    priority: String(c?.priority ?? 0),
    weight: String(c?.weight ?? 1),
    test_model: c?.test_model ?? "",
    cost_ratio: String(c ? Number(c.cost_ratio) : 1),
    cost_time_rules: c?.cost_time_rules ? c.cost_time_rules.map((r) => ({ ...r, days: [...(r.days ?? [])] })) : [],
    auto_ban: c?.auto_ban ?? true,
    param_override: prettyJson(c?.param_override),
    header_override: prettyJson(c?.header_override),
    tag: c?.tag ?? "",
    remark: c?.remark ?? "",
  };
}

const NONE = "__none__";

export function ChannelEditor({
  open,
  channel,
  onOpenChange,
}: {
  open: boolean;
  /** null = 新建 */
  channel: Channel | null;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const types = useChannelTypes();
  const groups = useGroups();
  const allModels = useAllModels();
  const tags = useChannelTags();
  const [f, setF] = useState<FormState>(() => initial(channel));
  const [errors, setErrors] = useState<Errors>({});
  const [fetched, setFetched] = useState<string[] | null>(null);
  const editing = !!channel;

  useEffect(() => {
    if (open) {
      setF(initial(channel));
      setErrors({});
    }
  }, [open, channel]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const typeMeta = types.data?.find((t) => t.value === f.type);
  const keyCount = useMemo(() => f.keys.split("\n").filter((s) => s.trim()).length, [f.keys]);
  const libraryNames = useMemo(() => (allModels.data ?? []).map((m) => m.name), [allModels.data]);

  const fetchModels = useMutation({
    mutationFn: () =>
      api.post<{ models: string[] }>("/api/admin/channels/fetch-models", {
        type: f.type,
        base_url: f.base_url.trim(),
        key: f.keys.split("\n").find((s) => s.trim())?.trim() || undefined,
        channel_id: channel?.id,
      }),
    onSuccess: (r) => {
      if (!r.models.length) toast.info("上游未返回任何模型");
      else setFetched(r.models);
    },
    onError: toastError,
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? api.put<Channel>(`/api/admin/channels/${channel!.id}`, body) : api.post<Channel>("/api/admin/channels", body),
    onSuccess: () => {
      toast.success(editing ? "渠道已保存" : "渠道已创建");
      qc.invalidateQueries({ queryKey: [CHANNELS_KEY] });
      qc.invalidateQueries({ queryKey: qk.channelTags });
      qc.invalidateQueries({ queryKey: ["admin", "channel-keys", channel?.id] });
      onOpenChange(false);
    },
    onError: toastError,
  });

  const submit = () => {
    const e: Errors = {};
    if (!f.name.trim()) e.name = "请填写渠道名称";
    if (!f.type) e.type = "请选择类型";
    if (!editing && keyCount === 0) e.keys = "至少填写一个 Key";
    if (editing && f.replace_keys && keyCount === 0) e.keys = "勾选「替换全部 Key」时必须填写新 Key";
    if (f.base_url.trim() && !/^https?:\/\//.test(f.base_url.trim())) e.base_url = "需以 http:// 或 https:// 开头";
    if (f.models.length === 0) e.models = "至少选择一个模型";
    const pr = Number(f.priority);
    if (!Number.isInteger(pr)) e.priority = "需为整数";
    const w = Number(f.weight);
    if (!Number.isInteger(w) || w < 0) e.weight = "需为非负整数";
    const cr = Number(f.cost_ratio);
    if (f.cost_ratio.trim() === "" || !Number.isFinite(cr) || cr < 0) e.cost_ratio = "需为非负数";
    const tre = validateTimeRules(f.cost_time_rules);
    if (tre) e.cost_time_rules = tre;
    const mapping: Record<string, string> = {};
    for (const r of f.mapping) {
      const a = r.from.trim();
      const b = r.to.trim();
      if (!a && !b) continue;
      if (!a || !b) {
        e.mapping = "映射的两侧都需要填写";
        break;
      }
      if (mapping[a]) {
        e.mapping = `重复的映射：${a}`;
        break;
      }
      mapping[a] = b;
    }
    const po = parseJson<Record<string, unknown>>(f.param_override);
    if (po.error) e.param_override = po.error;
    const ho = parseJson<Record<string, unknown>>(f.header_override);
    if (ho.error) e.header_override = ho.error;
    else if (ho.value && Object.values(ho.value).some((v) => typeof v !== "string")) e.header_override = "请求头的值必须为字符串";
    setErrors(e);
    if (Object.values(e).some(Boolean)) {
      toast.error("请检查表单中的错误");
      return;
    }
    const body: Record<string, unknown> = {
      name: f.name.trim(),
      type: f.type,
      base_url: f.base_url.trim(),
      multi_key_mode: f.multi_key_mode,
      models: f.models,
      model_mapping: mapping,
      groups: f.groups.length ? f.groups : ["default"],
      priority: pr,
      weight: w,
      test_model: f.test_model,
      cost_ratio: f.cost_ratio.trim(),
      cost_time_rules: normalizeTimeRules(f.cost_time_rules),
      auto_ban: f.auto_ban,
      param_override: po.value ?? {},
      header_override: ho.value ?? {},
      tag: f.tag.trim(),
      remark: f.remark,
    };
    if (keyCount > 0) body.keys = f.keys;
    if (editing && f.replace_keys) body.replace_keys = true;
    save.mutate(body);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-[760px]">
        <SheetHeader className="border-b">
          <SheetTitle>{editing ? `编辑渠道 #${channel!.id}` : "新增渠道"}</SheetTitle>
          <SheetDescription>{editing ? channel!.name : "配置上游供应商、Key 与可用模型"}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-8 overflow-y-auto px-6 py-5">
          {/* ------------------------------------------------ 基础 */}
          <FormSection title="基础信息">
            <div className="grid grid-cols-2 gap-4">
              <Field label="类型" required error={errors.type}>
                <Select value={f.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择类型" />
                  </SelectTrigger>
                  <SelectContent>
                    {types.data?.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="名称" required error={errors.name}>
                <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="如：OpenAI 官方 - 主力" maxLength={64} />
              </Field>
              <Field
                label="Base URL"
                className="col-span-2"
                error={errors.base_url}
                hint={
                  typeMeta?.base_url ? (
                    <>
                      留空使用默认地址 <code className="font-mono">{typeMeta.base_url}</code>
                    </>
                  ) : (
                    "该类型无默认地址，请填写上游 API 地址（通常以 /v1 结尾）"
                  )
                }
              >
                <Input
                  value={f.base_url}
                  onChange={(e) => set("base_url", e.target.value)}
                  placeholder={typeMeta?.base_url || "https://api.example.com/v1"}
                  className="font-mono text-xs"
                />
              </Field>
            </div>
          </FormSection>

          {/* ------------------------------------------------ Key */}
          <FormSection title="密钥" description="一行一个 Key，多个 Key 时按「多 Key 模式」分摊请求；出错的 Key 会被单独自动禁用。">
            <Field
              label={editing ? "追加 Key" : "Key"}
              required={!editing}
              error={errors.keys}
              extra={keyCount > 0 && <span className="text-xs text-muted-foreground">{keyCount} 个</span>}
              hint={editing ? `当前共 ${channel!.key_total} 个 Key（启用 ${channel!.key_enabled} 个），可在「Key 管理」中逐个启停或删除。` : undefined}
            >
              <Textarea
                value={f.keys}
                onChange={(e) => set("keys", e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={editing ? "留空则不修改；填写则追加" : "sk-xxxxxxxx\nsk-yyyyyyyy"}
                className="font-mono text-xs"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              {editing && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={f.replace_keys} onCheckedChange={(v) => set("replace_keys", !!v)} />
                  替换全部 Key
                  <span className="text-xs text-muted-foreground">（删除现有 Key 后写入上方 Key）</span>
                </label>
              )}
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">多 Key 模式</span>
                <RadioGroup
                  value={f.multi_key_mode}
                  onValueChange={(v) => set("multi_key_mode", v as FormState["multi_key_mode"])}
                  className="flex gap-4"
                >
                  <label className="flex items-center gap-1.5">
                    <RadioGroupItem value="random" />
                    随机
                  </label>
                  <label className="flex items-center gap-1.5">
                    <RadioGroupItem value="polling" />
                    轮询
                  </label>
                </RadioGroup>
              </div>
            </div>
          </FormSection>

          {/* ------------------------------------------------ 模型 */}
          <FormSection title="模型" description="对外提供的模型名。用户请求这些模型时才会路由到本渠道。">
            <Field
              label="模型列表"
              required
              error={errors.models}
              extra={
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={fetchModels.isPending}
                    onClick={() => fetchModels.mutate()}
                    title={editing ? "使用填写的 Key（未填写则使用渠道第一个 Key）拉取" : "使用填写的第一个 Key 拉取"}
                  >
                    {fetchModels.isPending ? <Loader2 className="animate-spin" /> : <CloudDownload />}
                    从上游获取
                  </Button>
                  <LibraryPicker names={libraryNames} value={f.models} onChange={(v) => set("models", v)} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={!f.models.length}
                    className="text-muted-foreground"
                    onClick={() => set("models", [])}
                  >
                    <X />
                    清空
                  </Button>
                </div>
              }
              hint={`已选 ${f.models.length} 个；可直接输入模型名后回车，或粘贴多行/逗号分隔。`}
            >
              <TagInput value={f.models} onChange={(v) => set("models", v)} mono placeholder="输入模型名后回车，如 gpt-4o-mini" maxHeight={180} />
            </Field>

            <Field
              label="模型映射"
              error={errors.mapping}
              hint="对外模型名 → 上游真实模型名。例如对外提供 gpt-4o，实际请求上游的 gpt-4o-2024-08-06。"
              extra={
                <Button type="button" variant="ghost" size="xs" onClick={() => set("mapping", [...f.mapping, { from: "", to: "" }])}>
                  <Plus />
                  添加映射
                </Button>
              }
            >
              {f.mapping.length === 0 ? (
                <div className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">未配置映射</div>
              ) : (
                <div className="space-y-2">
                  <datalist id="channel-model-options">
                    {f.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  {f.mapping.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        list="channel-model-options"
                        value={r.from}
                        placeholder="对外模型名"
                        className="font-mono text-xs"
                        onChange={(e) => set("mapping", f.mapping.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
                      />
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      <Input
                        value={r.to}
                        placeholder="上游模型名"
                        className="font-mono text-xs"
                        onChange={(e) => set("mapping", f.mapping.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground"
                        onClick={() => set("mapping", f.mapping.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  {f.mapping.some((r) => r.from.trim() && !f.models.includes(r.from.trim())) && (
                    <p className="text-xs text-[oklch(0.55_0.13_70)] dark:text-warning">提示：部分映射的对外模型名不在模型列表中，将不会生效。</p>
                  )}
                </div>
              )}
            </Field>

            <Field label="测试模型" hint="渠道测试与定时巡检时使用；不选则使用模型列表中的第一个。">
              <Select value={f.test_model || NONE} onValueChange={(v) => set("test_model", v === NONE ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    <span className="text-muted-foreground">默认（第一个模型）</span>
                  </SelectItem>
                  {f.test_model && !f.models.includes(f.test_model) && <SelectItem value={f.test_model}>{f.test_model}（不在列表中）</SelectItem>}
                  {f.models.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono text-xs">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FormSection>

          {/* ------------------------------------------------ 路由 */}
          <FormSection title="路由与计费" description="优先级高的渠道优先使用；同优先级按权重随机分配，失败时依次降级重试。">
            <div className="grid grid-cols-3 gap-4">
              <Field label="分组" className="col-span-3" hint="仅这些分组的用户（及可用分组包含它们的用户）可以使用本渠道。">
                <MultiSelect
                  value={f.groups}
                  onChange={(v) => set("groups", v)}
                  options={(groups.data ?? []).map((g) => ({ value: g.name, label: `${g.display_name}（${g.name}）`, keywords: [g.display_name] }))}
                  placeholder="选择分组"
                />
              </Field>
              <Field label="优先级" error={errors.priority} hint="数值越大越优先">
                <Input type="number" value={f.priority} onChange={(e) => set("priority", e.target.value)} className="num" />
              </Field>
              <Field label="权重" error={errors.weight} hint="同优先级内的分配比例">
                <Input type="number" min={0} value={f.weight} onChange={(e) => set("weight", e.target.value)} className="num" />
              </Field>
              <Field label="成本倍率" error={errors.cost_ratio} hint="渠道成本 = 原价 × 倍率">
                <Input type="number" min={0} step="0.01" value={f.cost_ratio} onChange={(e) => set("cost_ratio", e.target.value)} className="num" />
              </Field>
            </div>
            <Alert className="bg-muted/40">
              <AlertDescription className="text-xs">
                成本倍率用于统计毛利：例如上游按官方价 7 折结算，填 <b>0.7</b>；看板中「渠道成本」= 模型原价（未乘分组倍率）× 成本倍率 × 时段倍率，「毛利」= 售价 − 渠道成本。不影响用户扣费。
              </AlertDescription>
            </Alert>
            <Field
              label="采购时段规则（可选）"
              error={errors.cost_time_rules}
              hint="留空：渠道成本跟随售价的时段规则；填写：按该渠道自己的采购时段计算成本（适合对用户统一售价、但上游分时计费的情况）"
            >
              <TimeRulesEditor value={f.cost_time_rules} onChange={(v) => setF((x) => ({ ...x, cost_time_rules: v }))} emptyText="未设置：跟随售价时段" />
            </Field>
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <Label className="text-sm">自动禁用</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">上游返回鉴权失败、余额不足等错误时，自动禁用对应 Key；全部 Key 禁用时渠道变为「自动禁用」。</p>
              </div>
              <Switch checked={f.auto_ban} onCheckedChange={(v) => set("auto_ban", v)} />
            </div>
          </FormSection>

          {/* ------------------------------------------------ 高级 */}
          <FormSection title="高级">
            <div className="grid grid-cols-2 gap-4">
              <Field label="参数覆盖" error={errors.param_override} hint="合并到请求体，如强制 temperature">
                <JsonTextarea value={f.param_override} onChange={(v) => set("param_override", v)} placeholder={'{\n  "temperature": 0.7\n}'} />
              </Field>
              <Field label="请求头覆盖" error={errors.header_override} hint="追加/覆盖上游请求头，值须为字符串">
                <JsonTextarea value={f.header_override} onChange={(v) => set("header_override", v)} placeholder={'{\n  "X-Org": "my-org"\n}'} />
              </Field>
              <Field label="标签" hint="用于分组筛选与按标签批量操作">
                <Input value={f.tag} onChange={(e) => set("tag", e.target.value)} list="channel-tag-options" placeholder="如：官方 / 中转A" maxLength={64} />
                <datalist id="channel-tag-options">
                  {tags.data?.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
              <Field label="备注">
                <Input value={f.remark} onChange={(e) => set("remark", e.target.value)} placeholder="仅管理员可见" />
              </Field>
            </div>
          </FormSection>
        </div>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <SubmitButton loading={save.isPending} onClick={submit}>
            {editing ? "保存" : "创建"}
          </SubmitButton>
        </SheetFooter>
        <FetchedModelsDialog
          models={fetched}
          current={f.models}
          onClose={() => setFetched(null)}
          onApply={(v) => {
            set("models", v);
            setFetched(null);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

/** 从模型库挑选（已存在的模型元数据） */
function LibraryPicker({ names, value, onChange }: { names: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const missing = names.filter((n) => !value.includes(n));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="xs">
          <Library />
          填入已有模型
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="搜索模型库…" />
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
            <span>模型库共 {names.length} 个</span>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto p-0"
              disabled={!missing.length}
              onClick={() => onChange([...value, ...missing])}
            >
              全部填入（+{missing.length}）
            </Button>
          </div>
          <CommandList>
            <CommandEmpty>无匹配模型</CommandEmpty>
            <CommandGroup>
              {names.map((n) => {
                const on = value.includes(n);
                return (
                  <CommandItem key={n} value={n} onSelect={() => onChange(on ? value.filter((x) => x !== n) : [...value, n])}>
                    <Checkbox checked={on} className="pointer-events-none" />
                    <span className="font-mono text-xs">{n}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** 上游拉取结果：勾选后写入 */
function FetchedModelsDialog({
  models,
  current,
  onClose,
  onApply,
}: {
  models: string[] | null;
  current: string[];
  onClose: () => void;
  onApply: (v: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [kw, setKw] = useState("");
  useEffect(() => {
    if (models) {
      setSel(models.filter((m) => current.includes(m)));
      setKw("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);
  const list = (models ?? []).filter((m) => m.toLowerCase().includes(kw.toLowerCase()));
  const newCount = sel.filter((m) => !current.includes(m)).length;
  return (
    <Dialog open={!!models} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>上游模型列表</DialogTitle>
          <DialogDescription>上游共返回 {models?.length ?? 0} 个模型，勾选需要对外提供的模型。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="筛选" className="h-8" />
          <Button size="sm" variant="outline" onClick={() => setSel(Array.from(new Set([...sel, ...list])))}>
            全选
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSel(sel.filter((m) => !list.includes(m)))}>
            取消全选
          </Button>
        </div>
        <div className="grid max-h-[50vh] grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
          {list.map((m) => (
            <label key={m} className={cn("flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted", sel.includes(m) && "bg-muted/60")}>
              <Checkbox checked={sel.includes(m)} onCheckedChange={(v) => setSel(v ? [...sel, m] : sel.filter((x) => x !== m))} />
              <span className="truncate font-mono text-xs">{m}</span>
              {current.includes(m) && <span className="ml-auto text-[10px] text-muted-foreground">已有</span>}
            </label>
          ))}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            已选 {sel.length} 个，其中新增 {newCount} 个
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="outline"
              onClick={() => onApply(Array.from(new Set([...current, ...sel])))}
              disabled={!newCount}
            >
              追加到现有
            </Button>
            <Button onClick={() => onApply(sel)} disabled={!sel.length}>
              替换为所选
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
