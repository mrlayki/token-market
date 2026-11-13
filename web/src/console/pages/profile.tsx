import { useMutation } from "@tanstack/react-query";
import { KeyRound, Loader2, UserRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { StatusBadge } from "@/components/misc";
import { KV, PageHeader, Section } from "@/components/page";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage, toastError } from "@/lib/api";
import { dt } from "@/lib/format";
import type { OK, UserBrief } from "@/api/types";
import { useAuth } from "../auth";
import { useMyGroupRatio, ratioText } from "../lib/data";

const ROLE: Record<string, string> = { user: "普通用户", admin: "管理员", root: "超级管理员" };

export default function ProfilePage() {
  const { user, setUser, logout } = useAuth();
  const nav = useNavigate();
  const g = useMyGroupRatio();
  const [profile, setProfile] = useState({ display_name: user?.display_name ?? "", email: user?.email ?? "" });
  const [pw, setPw] = useState({ old: "", next: "", confirm: "" });
  const [pwErr, setPwErr] = useState("");

  // 进入页面时刷新一次用户信息
  useEffect(() => {
    api
      .get<UserBrief>("/api/auth/me")
      .then((u) => {
        setUser(u);
        setProfile({ display_name: u.display_name, email: u.email ?? "" });
      })
      .catch(() => {});
  }, [setUser]);

  const saveProfile = useMutation({
    mutationFn: () => api.put<UserBrief>("/api/auth/profile", { display_name: profile.display_name.trim(), email: profile.email.trim() }),
    onSuccess: (u) => {
      setUser(u);
      toast.success("资料已更新");
    },
    onError: toastError,
  });

  const changePw = useMutation({
    mutationFn: () => api.put<OK>("/api/auth/password", { old_password: pw.old, new_password: pw.next }),
    onSuccess: (r) => {
      toast.success(r.message || "密码已修改，请重新登录");
      logout();
      nav("/login", { replace: true });
    },
    onError: (e) => setPwErr(errorMessage(e)),
  });

  function submitPw(e: FormEvent) {
    e.preventDefault();
    setPwErr("");
    if (pw.next.length < 8) return setPwErr("新密码至少 8 位");
    if (pw.next !== pw.confirm) return setPwErr("两次输入的新密码不一致");
    if (pw.next === pw.old) return setPwErr("新密码不能与原密码相同");
    changePw.mutate();
  }

  if (!user) return null;
  const dirty = profile.display_name !== user.display_name || profile.email !== (user.email ?? "");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="个人设置" description="管理账户资料与登录密码" />

      <Section title="账户信息">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <Avatar className="size-16 rounded-xl">
            <AvatarFallback className="rounded-xl bg-primary/10 text-2xl font-semibold text-primary">{(user.display_name || user.username).slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <KV
            className="flex-1"
            items={[
              ["用户名", <span className="font-medium">{user.username}</span>],
              ["用户 ID", <span className="num">{user.id}</span>],
              [
                "用户分组",
                <span>
                  {g.label}
                  {g.ratio !== 1 && <span className="ml-1.5 text-xs text-muted-foreground">价格倍率 {ratioText(g.ratio)}</span>}
                </span>,
              ],
              ["角色", <StatusBadge tone={user.role === "user" ? "muted" : "default"}>{ROLE[user.role] ?? user.role}</StatusBadge>],
              ["注册时间", dt(user.created_at)],
            ]}
          />
        </div>
      </Section>

      <Section title="基本资料" description="显示名称会出现在控制台中">
        <form
          className="grid max-w-md gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveProfile.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="pf-name">显示名称</Label>
            <Input id="pf-name" maxLength={64} value={profile.display_name} onChange={(e) => setProfile((s) => ({ ...s, display_name: e.target.value }))} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pf-email">邮箱</Label>
            <Input id="pf-email" type="email" value={profile.email} onChange={(e) => setProfile((s) => ({ ...s, email: e.target.value }))} placeholder="未绑定" />
          </div>
          <div>
            <Button type="submit" disabled={!dirty || saveProfile.isPending}>
              {saveProfile.isPending ? <Loader2 className="animate-spin" /> : <UserRound />}
              保存资料
            </Button>
          </div>
        </form>
      </Section>

      <Section title="修改密码" description="修改成功后所有设备上的登录状态都将失效，需要重新登录">
        <form className="grid max-w-md gap-4" onSubmit={submitPw}>
          <div className="grid gap-2">
            <Label htmlFor="pw-old">原密码</Label>
            <Input id="pw-old" type="password" autoComplete="current-password" value={pw.old} onChange={(e) => setPw((s) => ({ ...s, old: e.target.value }))} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-new">新密码</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" placeholder="至少 8 位" value={pw.next} onChange={(e) => setPw((s) => ({ ...s, next: e.target.value }))} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-confirm">确认新密码</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((s) => ({ ...s, confirm: e.target.value }))} required />
          </div>
          {pwErr && <p className="text-sm text-destructive">{pwErr}</p>}
          <div>
            <Button type="submit" variant="outline" disabled={changePw.isPending}>
              {changePw.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
              修改密码
            </Button>
          </div>
        </form>
      </Section>
    </div>
  );
}
