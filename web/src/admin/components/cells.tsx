import { Link } from "react-router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dt, fromNow } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 用户引用：显示用户名 + #id，点击跳转到用户管理并筛选 */
export function UserRef({ id, name, className }: { id: number | null | undefined; name?: string; className?: string }) {
  if (id == null) return <span className="text-muted-foreground">-</span>;
  return (
    <Link
      to={`/users?keyword=${id}`}
      onClick={(e) => e.stopPropagation()}
      className={cn("inline-flex items-baseline gap-1 hover:underline", className)}
    >
      {name && <span className="font-medium">{name}</span>}
      <span className="num text-xs text-muted-foreground">#{id}</span>
    </Link>
  );
}

/** 时间：显示格式化时间，悬浮显示相对时间 */
export function TimeCell({ v, fmt = "MM-DD HH:mm:ss", className }: { v: string | null | undefined; fmt?: string; className?: string }) {
  if (!v) return <span className="text-muted-foreground">-</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("num whitespace-nowrap text-xs", className)}>{dt(v, fmt)}</span>
      </TooltipTrigger>
      <TooltipContent>
        {dt(v)}（{fromNow(v)}）
      </TooltipContent>
    </Tooltip>
  );
}

export function Muted({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-xs text-muted-foreground", className)}>{children}</span>;
}
