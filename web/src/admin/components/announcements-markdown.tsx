import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** 轻量 Markdown 渲染（无 typography 插件，手动定义元素样式，兼容深色模式） */
export function MarkdownView({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed break-words", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="text-xl font-semibold" {...p} />,
          h2: (p) => <h2 className="text-lg font-semibold" {...p} />,
          h3: (p) => <h3 className="text-base font-semibold" {...p} />,
          h4: (p) => <h4 className="font-semibold" {...p} />,
          a: (p) => <a className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
          ul: (p) => <ul className="list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="list-decimal space-y-1 pl-5" {...p} />,
          blockquote: (p) => <blockquote className="border-l-2 pl-3 text-muted-foreground" {...p} />,
          code: ({ className: c, ...p }) => <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-xs", c)} {...p} />,
          pre: (p) => <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0" {...p} />,
          table: (p) => (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-xs" {...p} />
            </div>
          ),
          th: (p) => <th className="border bg-muted/50 px-2 py-1 text-left font-medium" {...p} />,
          td: (p) => <td className="border px-2 py-1" {...p} />,
          hr: () => <hr className="border-border" />,
          img: (p) => <img className="max-w-full rounded-md" {...p} />,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
