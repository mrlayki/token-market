import type { ComponentType } from "react";
import { Link, createBrowserRouter, Navigate, useNavigate, useSearchParams } from "react-router";
import { LoginForm } from "@/components/login-form";
import { RouteError } from "@/components/route-error";
import { useAuth } from "./auth";
import { ConsoleLayout, PublicLayout } from "./layout";

function ConsoleLogin() {
  const setAuth = useAuth((s) => s.setAuth);
  const nav = useNavigate();
  const [sp] = useSearchParams();
  return (
    <div className="flex min-h-[calc(100svh-8rem)] items-center justify-center p-4">
      <LoginForm
        title="登录"
        description="登录你的账户以管理 API Key 与用量"
        onSuccess={(r) => {
          setAuth(r.token, r.user);
          nav(sp.get("next") || "/console", { replace: true });
        }}
        footer={
          <p className="text-center text-sm text-muted-foreground">
            还没有账户？
            <Link to="/register" className="ml-1 text-primary hover:underline">
              立即注册
            </Link>
          </p>
        }
      />
    </div>
  );
}

function RouteFallback() {
  return <div className="flex min-h-svh items-center justify-center"><div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
}

/** 页面按路由拆分加载 */
function page(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default });
}

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <RouteFallback />,
    children: [
      { path: "/", lazy: page(() => import("./pages/home")) },
      { path: "/models", lazy: page(() => import("./pages/marketplace")) },
      { path: "/pricing", element: <Navigate to="/models" replace /> },
      { path: "/docs", lazy: page(() => import("./pages/docs")) },
      { path: "/login", element: <ConsoleLogin /> },
      { path: "/register", lazy: page(() => import("./pages/register")) },
      { path: "/pay/:orderNo", lazy: page(() => import("./pages/cashier")) },
    ],
  },
  {
    path: "/console",
    element: <ConsoleLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <RouteFallback />,
    children: [
      {
        // 子页面出错时保留侧边栏，只替换内容区
        errorElement: <RouteError />,
        children: [
      { index: true, lazy: page(() => import("./pages/overview")) },
      { path: "tokens", lazy: page(() => import("./pages/tokens")) },
      { path: "playground", lazy: page(() => import("./pages/playground")) },
      { path: "wallet", lazy: page(() => import("./pages/wallet")) },
      { path: "packages", lazy: page(() => import("./pages/packages")) },
      { path: "orders", lazy: page(() => import("./pages/orders")) },
      { path: "logs", lazy: page(() => import("./pages/logs")) },
      { path: "billing", lazy: page(() => import("./pages/billing")) },
      { path: "profile", lazy: page(() => import("./pages/profile")) },
    ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
