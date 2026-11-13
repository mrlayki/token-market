import { Check, ChevronsUpDown, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** 自由输入标签：回车 / 逗号 / 空格 分隔，支持粘贴多行 */
export function TagInput({
  value,
  onChange,
  placeholder = "输入后回车添加",
  className,
  mono,
  maxHeight = 160,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  maxHeight?: number;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(/[\n,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "，") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1 overflow-y-auto rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
      style={{ maxHeight }}
    >
      {value.map((t) => (
        <Badge key={t} variant="secondary" className={cn("gap-1 pr-1 font-normal", mono && "font-mono text-[11px]")}>
          {t}
          <button type="button" className="rounded-sm opacity-60 hover:opacity-100" onClick={() => onChange(value.filter((x) => x !== t))}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => draft && add(draft)}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (/[\n,，\s]/.test(t)) {
            e.preventDefault();
            add(t);
          }
        }}
        placeholder={value.length ? "" : placeholder}
        className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export interface Option {
  value: string;
  label?: ReactNode;
  keywords?: string[];
}

/** 下拉多选（带搜索），选中项以 Badge 展示 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "请选择",
  className,
  emptyText = "无匹配项",
}: {
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  className?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className={cn("h-auto min-h-9 w-full justify-between px-2 py-1.5 font-normal", className)}
        >
          <div className="flex flex-wrap gap-1">
            {value.length ? (
              value.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1 pr-1 font-normal">
                  {labelOf(v)}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="rounded-sm opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(v);
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            ) : (
              <span className="px-1 text-muted-foreground">{placeholder}</span>
            )}
          </div>
          <ChevronsUpDown className="ml-1 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索…" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.value} keywords={o.keywords} onSelect={() => toggle(o.value)}>
                  <Check className={cn("size-4", value.includes(o.value) ? "opacity-100" : "opacity-0")} />
                  {o.label ?? o.value}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** 单选可搜索下拉 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "请选择",
  className,
  allowClear,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className={cn("w-full justify-between px-3 font-normal", className)}>
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? (cur?.label ?? value) : placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索…" />
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            <CommandGroup>
              {allowClear && value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground">清除选择</span>
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  keywords={o.keywords}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  {o.label ?? o.value}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
