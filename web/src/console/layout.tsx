import {
  BookOpen, CreditCard, Menu, Wallet, FlaskConical, Gauge, KeyRound, Package, Receipt, ScrollText, ShoppingBag, Store, UserCog,
} from "lucide-react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { AppShell, Brand, ThemeToggle, type NavGroup } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "./auth";
import { Markdown } from "./components/markdown";
import { useSite } from "./site";
import { useWallet } from "./lib/data";
import { money } from "@/lib/format";

export function ConsoleLayout() {
  const { token, user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const site = useSite();
  if (!token || !user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  const groups: NavGroup[] = [
    {
      items: [
        { title: "概览", to: "/console", icon: Gauge, end: true },
        { title: "API Key", to: "/console/tokens", icon: KeyRound },
        { title: "操练场", to: "/console/playground", icon: FlaskConical },
      ],
    },
    {
      label: "账户与计费",
      items: [
        { title: "钱包充值", to: "/console/wallet", icon: CreditCard },
        { title: "套餐包", to: "/console/packages", icon: Package },
        { title: "我的订单", to: "/console/orders", icon: ShoppingBag },
        { title: "调用日志", to: "/console/logs", icon: ScrollText },
        { title: "账单明细", to: "/console/billing", icon: Receipt },
      ],
    },
    {
      label: "更多",
      items: [
        { title: "模型广场", to: "/models", icon: Store },
        { title: "接入文档", to: "/docs", icon: BookOpen },
        { title: "个人设置", to: "/console/profile", icon: UserCog },
      ],
    },
  ];
  return (
    <AppShell
      brand={<Brand name={site.data?.["site.name"] ?? "Token Market"} sub="控制台" logo={site.data?.["site.logo"]} to="/console" />}
      nav={groups}
      user={{ name: user.display_name || user.username, subtitle: user.email ?? `分组：${user.group}` }}
      userMenu={
        <DropdownMenuItem onClick={() => nav("/console/profile")}>
          <UserCog />
          个人设置
        </DropdownMenuItem>
      }
      headerRight={<BalanceChip />}
      onLogout={() => {
        logout();
        nav("/");
      }}
    />
  );
}

/** 公开站点布局：首页 / 模型广场 / 文档 */
export function PublicLayout() {
  const site = useSite();
  const token = useAuth((s) => s.token);
  const name = site.data?.["site.name"] ?? "Token Market";
  const links = [
    { to: "/", label: "首页", end: true },
    { to: "/models", label: "模型广场" },
    { to: "/docs", label: "接入文档" },
  ];
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">T</div>
            {name}
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn("rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground", isActive && "bg-accent text-accent-foreground")
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 sm:hidden" aria-label="菜单">
                  <Menu />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {links.map((l) => (
                  <DropdownMenuItem key={l.to} asChild>
                    <Link to={l.to}>{l.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {token ? (
              <Button asChild size="sm">
                <Link to="/console">进入控制台</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">登录</Link>
                </Button>
                {site.data?.["auth.register_enabled"] !== false && (
                  <Button asChild size="sm" className="hidden min-[400px]:inline-flex">
                    <Link to="/register">免费注册</Link>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">T</div>
            {site.data?.["site.footer"] ? (
              <span dangerouslySetInnerHTML={{ __html: site.data["site.footer"] }} />
            ) : (
              <span>© {new Date().getFullYear()} {name}</span>
            )}
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/models" className="hover:text-foreground">模型广场</Link>
            <Link to="/docs" className="hover:text-foreground">接入文档</Link>
            {site.data?.["site.terms"] && <LegalLink title="服务条款" content={site.data["site.terms"]} />}
            {site.data?.["site.privacy"] && <LegalLink title="隐私政策" content={site.data["site.privacy"]} />}
          </nav>
        </div>
      </footer>
    </div>
  );
}

function LegalLink({ title, content }: { title: string; content: string }) {
  return (
    <Dialog>
      <DialogTrigger className="hover:text-foreground">{title}</DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Markdown>{content}</Markdown>
      </DialogContent>
    </Dialog>
  );
}

function BalanceChip() {
  const w = useWallet();
  return (
    <Link
      to="/console/wallet"
      className="mr-1 hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:inline-flex"
    >
      <Wallet className="size-3.5" />
      余额 <span className="num font-medium text-foreground">{w.data ? money(w.data.balance) : "…"}</span>
    </Link>
  );
}
