import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/misc";
import { cn } from "@/lib/utils";

export function JsonBlock({ value, className, maxHeight = 360 }: { value: unknown; className?: string; maxHeight?: number }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div className={cn("group relative rounded-md border bg-muted/40", className)}>
      <CopyButton text={text} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100" />
      <pre className="overflow-auto p-3 font-mono text-xs leading-relaxed" style={{ maxHeight }}>
        {text}
      </pre>
    </div>
  );
}

export function JsonPopover({ value, label }: { value: unknown; label?: string }) {
  const empty = value == null || (typeof value === "object" && Object.keys(value as object).length === 0);
  if (empty) return <span className="text-muted-foreground">-</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          <Braces />
          {label ?? "查看"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[480px] p-2" align="end">
        <JsonBlock value={value} maxHeight={420} className="border-0" />
      </PopoverContent>
    </Popover>
  );
}

/** 解析 JSON 文本；空字符串视为 {} */
export function parseJson<T = unknown>(text: string, expect: "object" | "array" | "any" = "object"): { value?: T; error?: string } {
  if (!text.trim()) return { value: (expect === "array" ? [] : {}) as T };
  try {
    const v = JSON.parse(text);
    if (expect === "object" && (typeof v !== "object" || v === null || Array.isArray(v))) return { error: "需要 JSON 对象，如 {\"key\": \"value\"}" };
    if (expect === "array" && !Array.isArray(v)) return { error: "需要 JSON 数组" };
    return { value: v as T };
  } catch (e) {
    return { error: `JSON 格式错误：${(e as Error).message}` };
  }
}

export function JsonTextarea({
  value,
  onChange,
  error,
  placeholder,
  rows = 5,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-1">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        spellCheck={false}
        className={cn("font-mono text-xs", error && "border-destructive focus-visible:ring-destructive/30")}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto p-0 text-muted-foreground"
          onClick={() => {
            try {
              onChange(JSON.stringify(JSON.parse(value), null, 2));
            } catch {
              /* 格式错误时忽略 */
            }
          }}
        >
          格式化
        </Button>
      </div>
    </div>
  );
}

export function prettyJson(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && Object.keys(v as object).length === 0) return "";
  return JSON.stringify(v, null, 2);
}
