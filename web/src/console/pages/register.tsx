import { Loader2, Lock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import type { LoginResult } from "@/api/types";
import { useAuth } from "../auth";
import { useSite } from "../site";

const USERNAME_RE = /^[A-Za-z0-9_\-.]{3,32}$/;

export default function RegisterPage() {
  const site = useSite();
  const setAuth = useAuth((s) => s.setAuth);
  const nav = useNavigate();
  const [f, setF] = useState({ username: "", email: "", password: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!USERNAME_RE.test(f.username)) return setError("用户名需为 3-32 位字母、数字、下划线、横线或点");
    if (f.password.length < 8) return setError("密码至少 8 位");
    if (f.password !== f.confirm) return setError("两次输入的密码不一致");
    setLoading(true);
    try {
      const r = await api.post<LoginResult>("/api/auth/register", { username: f.username, password: f.password, email: f.email.trim() || null });
      setAuth(r.token, r.user);
      toast.success("注册成功，欢迎使用");
      nav("/console", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const disabled = site.data?.["auth.register_enabled"] === false;
  const mismatch = f.confirm.length > 0 && f.password !== f.confirm;

  return (
    <div className="flex min-h-[calc(100svh-8rem)] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">创建账户</CardTitle>
          <CardDescription>注册后即可创建 API Key，调用全部模型</CardDescription>
        </CardHeader>
        <CardContent>
          {site.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : disabled ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <Lock className="size-5 text-muted-foreground" />
              </div>
              <div className="font-medium">当前暂未开放注册</div>
              <p className="text-sm text-muted-foreground">如需开通账户，请联系站点管理员。</p>
              <Button asChild variant="outline" className="mt-2">
                <Link to="/login">已有账户，去登录</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="username">用户名</Label>
                <Input id="username" autoComplete="username" value={f.username} onChange={set("username")} placeholder="3-32 位字母、数字或 _-." required autoFocus />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">
                  邮箱 <span className="font-normal text-muted-foreground">（可选）</span>
                </Label>
                <Input id="email" type="email" autoComplete="email" value={f.email} onChange={set("email")} placeholder="用于找回账户与接收通知" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">密码</Label>
                <Input id="password" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} placeholder="至少 8 位" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm">确认密码</Label>
                <Input id="confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={set("confirm")} aria-invalid={mismatch} required />
                {mismatch && <p className="text-xs text-destructive">两次输入的密码不一致</p>}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={loading} className="w-full">
                {loading && <Loader2 className="animate-spin" />}
                注册
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                已有账户？
                <Link to="/login" className="ml-1 text-primary hover:underline">
                  立即登录
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
