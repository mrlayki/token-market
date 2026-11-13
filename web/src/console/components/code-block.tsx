import { type ReactNode, useState } from "react";
import { CopyButton } from "@/components/misc";
import { cn } from "@/lib/utils";

/** 代码块：标题栏 + 复制按钮，暗色风格在两种主题下均保持一致的可读性 */
export function CodeBlock({ code, lang, title, className, actions }: { code: string; lang?: string; title?: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <div className={cn("group/code overflow-hidden rounded-lg border bg-muted/40 dark:bg-black/30", className)}>
      <div className="flex h-9 items-center justify-between border-b bg-muted/50 px-3 dark:bg-white/[0.03]">
        <span className="font-mono text-xs text-muted-foreground">{title ?? lang ?? "code"}</span>
        <div className="flex items-center gap-1">
          {actions}
          <CopyButton text={code} className="size-7 text-muted-foreground" />
        </div>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export interface CodeTab {
  key: string;
  label: string;
  code: string;
  lang?: string;
}

/** 多语言代码示例切换 */
export function CodeTabs({ tabs, className, defaultKey }: { tabs: CodeTab[]; className?: string; defaultKey?: string }) {
  const [active, setActive] = useState(defaultKey ?? tabs[0]?.key);
  const cur = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!cur) return null;
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-muted/40 dark:bg-black/30", className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 pr-2 dark:bg-white/[0.03]">
        <div className="flex min-w-0 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={cn(
                "relative shrink-0 px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                t.key === cur.key && "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <CopyButton text={cur.code} className="size-7 shrink-0 text-muted-foreground" />
      </div>
      <pre className="max-h-[420px] overflow-auto p-4 font-mono text-[12.5px] leading-relaxed">
        <code>{cur.code}</code>
      </pre>
    </div>
  );
}
