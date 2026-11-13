import {
  Activity, BadgeDollarSign, Landmark, Bell, Boxes, Cable, FileClock, FileText, Gift, LayoutDashboard, Megaphone, Package,
  ReceiptText, Scale, ScrollText, Settings, ShieldCheck, ShoppingCart, Users, UsersRound,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router";
import { AppShell, Brand, type NavGroup } from "@/components/app-shell";
import { api } from "@/lib/api";
import { useAuth } from "./auth";

export function AdminLayout() {
  const { token, user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const unread = useQuery({
    queryKey: ["admin-unread"],
    queryFn: () => api.get<{ total: number }>("/api/admin/notifications", { unread: true, page_size: 1 }),
    enabled: !!token,
    refetchInterval: 60_000,
  });
  if (!token || !user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  const isRoot = user.role === "root";
  const groups: NavGroup[] = [
    { items: [{ title: "数据看板", to: "/dashboard", icon: LayoutDashboard }] },
    {
      label: "供给",
      items: [
        { title: "渠道管理", to: "/channels", icon: Cable },
        { title: "模型管理", to: "/models", icon: Boxes },
        { title: "模型计费", to: "/pricing", icon: BadgeDollarSign },
      ],
    },
    {
      label: "运营",
      items: [
        { title: "用户管理", to: "/users", icon: Users },
        { title: "用户分组", to: "/groups", icon: UsersRound },
        { title: "套餐商品", to: "/packages", icon: Package },
        { title: "订单管理", to: "/orders", icon: ShoppingCart },
        { title: "兑换码", to: "/redemptions", icon: Gift },
        { title: "公告管理", to: "/announcements", icon: Megaphone },
      ],
    },
    {
      label: "财务与审计",
      items: [
        { title: "调用日志", to: "/logs", icon: ScrollText },
        { title: "账务流水", to: "/ledger", icon: ReceiptText },
        { title: "账单", to: "/statements", icon: FileText },
        { title: "对账中心", to: "/recon", icon: Scale },
        { title: "上游对账", to: "/upstream", icon: Landmark },
        { title: "审计日志", to: "/audit", icon: FileClock },
      ],
    },
    {
      label: "系统",
      items: [
        { title: "系统通知", to: "/notifications", icon: Bell, badge: unread.data?.total || undefined },
        { title: "系统状态", to: "/system", icon: Activity },
        ...(isRoot ? [{ title: "系统设置", to: "/settings", icon: Settings }] : []),
      ],
    },
  ];
  return (
    <AppShell
      brand={<Brand name="Token Market" sub="管理后台" to="/dashboard" />}
      nav={groups}
      user={{ name: user.display_name || user.username, subtitle: { root: "超级管理员", admin: "管理员", user: "用户" }[user.role] }}
      headerRight={<ShieldCheck className="mr-1 size-4 text-muted-foreground" />}
      onLogout={() => {
        logout();
        nav("/login");
      }}
    />
  );
}
