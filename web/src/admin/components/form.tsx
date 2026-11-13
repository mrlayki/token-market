import { Loader2 } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** 表单字段：标签 + 控件 + 说明 / 错误 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
  extra,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  extra?: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-[13px]">
          {label}
          {required && <span className="text-destructive">*</span>}
        </Label>
        {extra}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** 表单分节标题 */
export function FormSection({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="border-b pb-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** 带前后缀的输入框 */
export function AffixInput({
  prefix,
  suffix,
  className,
  ...props
}: ComponentProps<typeof Input> & { prefix?: ReactNode; suffix?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn("relative flex items-center", className)}>
      {prefix && <span className="pointer-events-none absolute left-3 text-sm text-muted-foreground">{prefix}</span>}
      <Input id={props.id ?? id} {...props} className={cn("num", prefix && "pl-7", suffix && "pr-14")} />
      {suffix && <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/** 提交按钮：提交中禁用并显示转圈 */
export function SubmitButton({ loading, children, ...props }: ComponentProps<typeof Button> & { loading?: boolean }) {
  return (
    <Button {...props} disabled={loading || props.disabled}>
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

/** 将可能为空的字符串转为数字（空 → fallback） */
export function toNum(v: string, fallback = 0): number {
  if (v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 元 → 字符串（去掉多余 0），用于把微元回填到输入框 */
export function yuanStr(micro: number | null | undefined): string {
  const y = (micro ?? 0) / 1_000_000;
  return String(parseFloat(y.toFixed(6)));
}
