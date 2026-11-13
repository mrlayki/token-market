import { RotateCcw, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__all__";

/** 搜索框：输入后 400ms 或回车提交 */
export function SearchInput({
  value,
  onChange,
  placeholder = "搜索",
  className,
  icon = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  icon?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft.trim()), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  return (
    <div className={cn("relative w-56", className)}>
      {icon && <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onChange(draft.trim())}
        placeholder={placeholder}
        className={cn("h-8", icon && "pl-8", draft && "pr-7")}
      />
      {draft && (
        <button
          type="button"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setDraft("");
            onChange("");
          }}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** 筛选下拉，空值代表「全部」 */
export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  allLabel,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: ReactNode }[];
  placeholder: string;
  allLabel?: string;
  className?: string;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger size="sm" className={cn("w-32", className, value && "border-primary/40")}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel ?? `全部${placeholder}`}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ResetButton({ onClick, show = true }: { onClick: () => void; show?: boolean }) {
  if (!show) return null;
  return (
    <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={onClick}>
      <RotateCcw />
      重置
    </Button>
  );
}

export function hasFilters(f: Record<string, string>) {
  return Object.values(f).some((v) => v !== "");
}
