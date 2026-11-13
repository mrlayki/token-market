import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";

const CHUNK_ERR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
const RELOAD_FLAG = "tm_chunk_reload_at";

/**
 * 路由级错误边界。
 * 发布新版本后，已打开的旧页面引用的分包文件名已不存在，会出现「Failed to fetch dynamically imported module」。
 * 这种情况自动刷新一次加载新版本；其他错误显示可恢复的错误页。
 */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  const isChunk = CHUNK_ERR.test(message);

  useEffect(() => {
    if (!isChunk) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    } catch {
      /* 存储不可用时直接刷新 */
    }
    if (Date.now() - last > 10_000) {
      try {
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
      } catch {
        /* ignore */
      }
      location.reload();
    }
  }, [isChunk]);

  return (
    <div className="flex min-h-[60svh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-5 text-destructive" />
        </div>
        <h2 className="text-lg font-semibold">{isChunk ? "系统已更新，正在加载新版本" : "页面出错了"}</h2>
        <p className="text-sm text-muted-foreground">
          {isChunk ? "如果没有自动刷新，请点击下方按钮。" : "请刷新页面重试；如果问题持续出现，请联系管理员。"}
        </p>
        {!isChunk && <pre className="max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 text-left text-xs">{message}</pre>}
        <Button onClick={() => location.reload()}>
          <RefreshCw /> 刷新页面
        </Button>
      </div>
    </div>
  );
}
