import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/misc";
import { cn } from "@/lib/utils";

const components: Components = {
  h1: ({ children }) => <h1 className="mt-6 mb-3 text-2xl font-semibold tracking-tight first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 mb-3 text-xl font-semibold tracking-tight first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2.5 leading-7 first:mt-0 last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1 pl-6 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1 pl-6 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 pl-4 text-muted-foreground italic">{children}</blockquote>,
  hr: () => <hr className="my-5" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => <th className="border-b px-3 py-2 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-2 align-top">{children}</td>,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? "");
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    const block = !!lang || text.includes("\n");
    if (!block) {
      return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>;
    }
    const code = text.replace(/\n$/, "");
    return (
      <div className="my-3 overflow-hidden rounded-lg border bg-muted/40 dark:bg-black/30">
        <div className="flex h-8 items-center justify-between border-b bg-muted/50 px-3 dark:bg-white/[0.03]">
          <span className="font-mono text-[11px] text-muted-foreground">{lang ?? "text"}</span>
          <CopyButton text={code} className="size-6 text-muted-foreground" />
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    );
  },
};

export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
