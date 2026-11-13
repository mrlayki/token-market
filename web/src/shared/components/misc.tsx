import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- 复制
export async function copyText(text: string, msg = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast.success(msg);
}

export function CopyButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size={label ? "sm" : "icon"}
      className={cn(!label && "size-7", className)}
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="text-success" /> : <Copy />}
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------- 状态徽标
export type Tone = "default" | "success" | "warning" | "danger" | "info" | "muted";

const toneClass: Record<Tone, string> = {
  default: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/15 text-[oklch(0.55_0.13_70)] dark:text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
  info: "bg-chart-2/10 text-chart-2 border-chart-2/20",
  muted: "bg-muted text-muted-foreground border-transparent",
};

export function StatusBadge({ tone = "default", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", toneClass[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </Badge>
  );
}

// ---------------------------------------------------------------- 确认弹窗（命令式）
interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (v: boolean) => void;
}

const useConfirmStore = create<ConfirmState>(() => ({ open: false, title: "" }));

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ ...opts, open: true, resolve }));
}

export function ConfirmHost() {
  const s = useConfirmStore();
  const close = (v: boolean) => {
    s.resolve?.(v);
    useConfirmStore.setState({ open: false, resolve: undefined });
  };
  return (
    <AlertDialog open={s.open} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{s.title}</AlertDialogTitle>
          {s.description && <AlertDialogDescription>{s.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>取消</AlertDialogCancel>
          <AlertDialogAction
            className={cn(s.danger && "bg-destructive text-white hover:bg-destructive/90")}
            onClick={() => close(true)}
          >
            {s.confirmText ?? "确定"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------- 供应商 / 模型图标
const VENDOR_COLORS: Record<string, string> = {
  openai: "#10a37f",
  anthropic: "#d97757",
  deepseek: "#4d6bfe",
  google: "#4285f4",
  gemini: "#4285f4",
  dashscope: "#615ced",
  qwen: "#615ced",
  mock: "#71717a",
};

export function VendorIcon({ vendor, icon, size = 28, className }: { vendor?: string | null; icon?: string; size?: number; className?: string }) {
  const key = (vendor ?? "").toLowerCase();
  if (icon && /^(https?:)?\/\//.test(icon)) {
    return <img src={icon} alt={vendor ?? ""} style={{ width: size, height: size }} className={cn("rounded-md", className)} />;
  }
  const color = VENDOR_COLORS[key] ?? "#6366f1";
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-md font-semibold text-white", className)}
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
    >
      {(vendor ?? "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------- 带提示的文本截断
export function Truncate({ text, className }: { text: string; className?: string }) {
  if (!text) return <span className="text-muted-foreground">-</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("block max-w-[240px] truncate", className)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-md break-all">{text}</TooltipContent>
    </Tooltip>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs", className)}>{children}</span>;
}
