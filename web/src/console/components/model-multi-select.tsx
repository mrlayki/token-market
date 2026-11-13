import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";
import { VendorIcon } from "@/components/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useMarketplace } from "../lib/data";

/** 模型多选（按厂商分组） */
export function ModelMultiSelect({ value, onChange, placeholder = "不限制（可调用全部模型）" }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const mk = useMarketplace();
  const [open, setOpen] = useState(false);
  const models = mk.data?.models ?? [];
  const byVendor = new Map<string, typeof models>();
  for (const m of models) {
    const k = m.vendor?.display_name ?? "其他";
    byVendor.set(k, [...(byVendor.get(k) ?? []), m]);
  }
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((x) => x !== name) : [...value, name]);
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className={cn("truncate", !value.length && "text-muted-foreground")}>{value.length ? `已选择 ${value.length} 个模型` : placeholder}</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder="搜索模型…" />
            <CommandList className="max-h-72">
              <CommandEmpty>没有匹配的模型</CommandEmpty>
              {[...byVendor.entries()].map(([vendor, list]) => (
                <CommandGroup key={vendor} heading={vendor}>
                  {list.map((m) => {
                    const on = value.includes(m.name);
                    return (
                      <CommandItem key={m.name} value={m.name} onSelect={() => toggle(m.name)}>
                        <div className={cn("flex size-4 items-center justify-center rounded-sm border", on ? "border-primary bg-primary text-primary-foreground" : "opacity-60")}>
                          {on && <Check className="size-3 text-current" />}
                        </div>
                        <VendorIcon vendor={m.vendor?.name} size={16} className="rounded" />
                        <span className="font-mono text-xs">{m.name}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1 font-mono text-[11px] font-normal">
              {v}
              <button type="button" onClick={() => toggle(v)} className="rounded-sm opacity-60 hover:opacity-100" aria-label={`移除 ${v}`}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>
            清空
          </button>
        </div>
      )}
    </div>
  );
}
