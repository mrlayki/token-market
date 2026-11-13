import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, useNavigate, useSearchParams } from "react-router";
import { LoginForm } from "@/components/login-form";
import { RouteError } from "@/components/route-error";
import { useAuth } from "./auth";
import { AdminLayout } from "./layout";

const AnnouncementsPage = lazy(() => import("./pages/announcements"));
const AuditPage = lazy(() => import("./pages/audit"));
const ChannelsPage = lazy(() => import("./pages/channels"));
const DashboardPage = lazy(() => import("./pages/dashboard"));
const GroupsPage = lazy(() => import("./pages/groups"));
const LedgerPage = lazy(() => import("./pages/ledger"));
const LogsPage = lazy(() => import("./pages/logs"));
const ModelsPage = lazy(() => import("./pages/models"));
const NotificationsPage = lazy(() => import("./pages/notifications"));
const OrdersPage = lazy(() => import("./pages/orders"));
const PackagesPage = lazy(() => import("./pages/packages"));
const PricingPage = lazy(() => import("./pages/pricing"));
const ReconPage = lazy(() => import("./pages/recon"));
const RedemptionsPage = lazy(() => import("./pages/redemptions"));
const SettingsPage = lazy(() => import("./pages/settings"));
const StatementsPage = lazy(() => import("./pages/statements"));
const SystemPage = lazy(() => import("./pages/system"));
const UpstreamPage = lazy(() => import("./pages/upstream"));
const UsersPage = lazy(() => import("./pages/users"));

function page(el: ReactNode) {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载中…</div>}>{el}</Suspense>;
}

function AdminLogin() {
  const setAuth = useAuth((s) => s.setAuth);
  const nav = useNavigate();
  const [sp] = useSearchParams();
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <LoginForm
        title="管理后台"
        description="使用管理员账号登录"
        validate={(r) => (r.user.role === "user" ? "该账号没有管理权限" : null)}
        onSuccess={(r) => {
          setAuth(r.token, r.user);
          nav(sp.get("next") || "/dashboard", { replace: true });
        }}
      />
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/login", element: <AdminLogin />, errorElement: <RouteError /> },
  {
    path: "/",
    element: <AdminLayout />,
    errorElement: <RouteError />,
    children: [
      {
        // 子页面出错时保留侧边栏，只替换内容区
        errorElement: <RouteError />,
        children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: page(<DashboardPage />) },
      { path: "channels", element: page(<ChannelsPage />) },
      { path: "models", element: page(<ModelsPage />) },
      { path: "pricing", element: page(<PricingPage />) },
      { path: "groups", element: page(<GroupsPage />) },
      { path: "packages", element: page(<PackagesPage />) },
      { path: "users", element: page(<UsersPage />) },
      { path: "orders", element: page(<OrdersPage />) },
      { path: "redemptions", element: page(<RedemptionsPage />) },
      { path: "logs", element: page(<LogsPage />) },
      { path: "ledger", element: page(<LedgerPage />) },
      { path: "statements", element: page(<StatementsPage />) },
      { path: "recon", element: page(<ReconPage />) },
      { path: "upstream", element: page(<UpstreamPage />) },
      { path: "announcements", element: page(<AnnouncementsPage />) },
      { path: "notifications", element: page(<NotificationsPage />) },
      { path: "audit", element: page(<AuditPage />) },
      { path: "settings", element: page(<SettingsPage />) },
      { path: "system", element: page(<SystemPage />) },
      { path: "*", element: <Navigate to="/dashboard" replace /> },
    ],
      },
    ],
  },
]);
