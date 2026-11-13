import type { LucideIcon } from "lucide-react";
import { ChevronsUpDown, LogOut, Moon, Sun, SunMoon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useTheme, type ThemeMode } from "@/lib/theme";

export interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
  badge?: ReactNode;
  end?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export interface ShellUser {
  name: string;
  subtitle?: string;
}

interface AppShellProps {
  brand: ReactNode;
  nav: NavGroup[];
  user: ShellUser;
  userMenu?: ReactNode;
  headerRight?: ReactNode;
  onLogout: () => void;
}

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const next: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : SunMoon;
  const label = { light: "浅色", dark: "深色", system: "跟随系统" }[mode];
  return (
    <button
      type="button"
      onClick={() => setMode(next[mode])}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      title={`主题：${label}`}
    >
      <Icon className="size-4" />
    </button>
  );
}

function useActiveTitle(nav: NavGroup[]) {
  const { pathname } = useLocation();
  let best: NavItem | undefined;
  for (const g of nav)
    for (const it of g.items)
      if (pathname === it.to || (pathname.startsWith(it.to + "/") && (!best || it.to.length > best.to.length))) best = it;
  return best?.title;
}

export function AppShell({ brand, nav, user, userMenu, headerRight, onLogout }: AppShellProps) {
  const title = useActiveTitle(nav);
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>{brand}</SidebarHeader>
        <SidebarContent>
          {nav.map((g, i) => (
            <SidebarGroup key={g.label ?? i}>
              {g.label && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
              <SidebarMenu>
                {g.items.map((it) => (
                  <SidebarMenuItem key={it.to}>
                    <NavLink to={it.to} end={it.end}>
                      {({ isActive }) => (
                        <SidebarMenuButton isActive={isActive} tooltip={it.title}>
                          <it.icon />
                          <span>{it.title}</span>
                        </SidebarMenuButton>
                      )}
                    </NavLink>
                    {it.badge != null && <SidebarMenuBadge>{it.badge}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-primary/10 text-primary font-medium">
                        {user.name.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{user.name}</span>
                      {user.subtitle && <span className="truncate text-xs text-muted-foreground">{user.subtitle}</span>}
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="text-sm font-medium">{user.name}</div>
                    {user.subtitle && <div className="text-xs text-muted-foreground">{user.subtitle}</div>}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {userMenu}
                  {userMenu && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={onLogout}>
                    <LogOut />
                    退出登录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 rounded-t-xl border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="text-sm font-medium">{title}</span>
          <div className="ml-auto flex items-center gap-1">
            {headerRight}
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function Brand({ name, sub, logo, to = "/" }: { name: string; sub?: string; logo?: string; to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-md px-1 py-1.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        {logo ? <img src={logo} alt="" className="size-5" /> : <span className="text-sm font-bold">T</span>}
      </div>
      <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-semibold">{name}</span>
        {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
      </div>
    </Link>
  );
}
