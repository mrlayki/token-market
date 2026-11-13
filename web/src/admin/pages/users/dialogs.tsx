import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, toastError } from "@/lib/api";
import { compact, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AffixInput, Field, SubmitButton, toNum } from "../../components/form";
import { useGroups, useIsRoot, useProducts } from "../../lib/queries";
import type { AdminUser } from "../../lib/types";

export const USERS_URL = "/api/admin/users";

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [USERS_URL] });
    qc.invalidateQueries({ queryKey: ["admin", "user-detail"] });
    qc.invalidateQueries({ queryKey: ["admin", "user-packages"] });
  };
}

/** 打开时重置表单 */
function useResetOnOpen(open: boolean, key: string | number | undefined, reset: () => void) {
  const [last, setLast] = useState<string | null>(null);
  const k = open ? String(key ?? "new") : null;
  if (k !== last) {
    setLast(k);
    if (open) reset();
  }
}

function GroupSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const groups = useGroups();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(groups.data ?? [{ name: "default", display_name: "默认分组" }]).map((g) => (
          <SelectItem key={g.name} value={g.name}>
            {g.display_name}
            <span className="ml-1 text-xs text-muted-foreground">{g.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RoleSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="user">普通用户</SelectItem>
        <SelectItem value="admin">管理员</SelectItem>
        {value === "root" && <SelectItem value="root">超级管理员</SelectItem>}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------- 新建用户
export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const isRoot = useIsRoot();
  const invalidate = useInvalidateUsers();
  const [f, setF] = useState({ username: "", password: "", display_name: "", email: "", role: "user", group: "default", remark: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useResetOnOpen(open, "new", () => {
    setF({ username: "", password: "", display_name: "", email: "", role: "user", group: "default", remark: "" });
    setErrors({});
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => api.post<AdminUser>(USERS_URL, { ...f, username: f.username.trim(), email: f.email.trim() || null }),
    onSuccess: (u) => {
      toast.success(`用户 ${u.username} 已创建`);
      invalidate();
      onOpenChange(false);
    },
    onError: toastError,
  });
  const submit = () => {
    const e: Record<string, string> = {};
    const un = f.username.trim();
    if (un.length < 3 || un.length > 32) e.username = "3 ~ 32 个字符";
    if (f.password.length < 8 || f.password.length > 64) e.password = "8 ~ 64 位";
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "邮箱格式不正确";
    setErrors(e);
    if (!Object.keys(e).length) save.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建用户</DialogTitle>
          <DialogDescription>新用户默认余额为 0，可创建后通过「调整余额」充值。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="用户名" required error={errors.username}>
            <Input value={f.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="初始密码" required error={errors.password}>
            <Input type="password" value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="显示名称" hint="留空同用户名">
            <Input value={f.display_name} onChange={(e) => set("display_name", e.target.value)} />
          </Field>
          <Field label="邮箱" error={errors.email}>
            <Input value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="分组">
            <GroupSelect value={f.group} onChange={(v) => set("group", v)} />
          </Field>
          <Field label="角色" hint={isRoot ? undefined : "仅超级管理员可创建管理员"}>
            <RoleSelect value={f.role} onChange={(v) => set("role", v)} disabled={!isRoot} />
          </Field>
          <Field label="备注" className="col-span-2">
            <Textarea rows={2} value={f.remark} onChange={(e) => set("remark", e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <SubmitButton loading={save.isPending} onClick={submit}>
            创建
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 编辑用户
export function EditUserDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const isRoot = useIsRoot();
  const invalidate = useInvalidateUsers();
  const open = !!user;
  const [f, setF] = useState({ display_name: "", email: "", group: "default", role: "user", status: 1, remark: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useResetOnOpen(open, user?.id, () => {
    if (!user) return;
    setF({ display_name: user.display_name, email: user.email ?? "", group: user.group, role: user.role, status: user.status, remark: user.remark, password: "" });
    setErrors({});
  });
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        display_name: f.display_name,
        email: f.email.trim() || null,
        group: f.group,
        status: f.status,
        remark: f.remark,
      };
      if (isRoot && f.role !== user!.role && f.role !== "root") body.role = f.role;
      if (f.password) body.password = f.password;
      return api.put<AdminUser>(`${USERS_URL}/${user!.id}`, body);
    },
    onSuccess: () => {
      toast.success("用户信息已更新");
      invalidate();
      onClose();
    },
    onError: toastError,
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (f.password && (f.password.length < 8 || f.password.length > 64)) e.password = "8 ~ 64 位";
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "邮箱格式不正确";
    setErrors(e);
    if (!Object.keys(e).length) save.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            编辑用户 · {user?.username} <span className="num text-sm font-normal text-muted-foreground">#{user?.id}</span>
          </DialogTitle>
          <DialogDescription>修改密码、禁用或变更角色后，该用户已登录的会话将失效。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="显示名称">
            <Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          </Field>
          <Field label="邮箱" error={errors.email}>
            <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="分组">
            <GroupSelect value={f.group} onChange={(v) => setF({ ...f, group: v })} />
          </Field>
          <Field label="角色" hint={isRoot ? undefined : "仅超级管理员可修改角色"}>
            <RoleSelect value={f.role} onChange={(v) => setF({ ...f, role: v })} disabled={!isRoot || user?.role === "root"} />
          </Field>
          <Field label="重置密码" error={errors.password} hint="留空则不修改" className="col-span-2">
            <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" placeholder="输入新密码（8 位以上）" />
          </Field>
          <Field label="备注" className="col-span-2">
            <Textarea rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} />
          </Field>
          <div className="col-span-2 flex items-center gap-3 rounded-md border px-3 py-2.5">
            <Switch id="user-status" checked={f.status === 1} onCheckedChange={(v) => setF({ ...f, status: v ? 1 : 2 })} />
            <label htmlFor="user-status" className="text-sm">
              账户启用
              <span className="ml-2 text-xs text-muted-foreground">禁用后无法登录，API 令牌也将立即失效</span>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <SubmitButton loading={save.isPending} onClick={submit}>
            保存
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 调整余额
export function AdjustDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const invalidate = useInvalidateUsers();
  const open = !!user;
  const [sign, setSign] = useState<"+" | "-">("+");
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  useResetOnOpen(open, user?.id, () => {
    setSign("+");
    setAmount("");
    setRemark("");
    setErrors({});
  });
  const delta = Math.round(toNum(amount) * 1_000_000) * (sign === "+" ? 1 : -1);
  const save = useMutation({
    mutationFn: () => api.post(`${USERS_URL}/${user!.id}/adjust`, { amount: delta, remark: remark.trim() }),
    onSuccess: () => {
      toast.success("余额已调整");
      invalidate();
      onClose();
    },
    onError: toastError,
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!(toNum(amount) > 0)) e.amount = "请输入大于 0 的金额";
    if (!remark.trim()) e.remark = "请填写调整原因（将记入账务流水）";
    setErrors(e);
    if (!Object.keys(e).length) save.mutate();
  };
  const after = (user?.balance ?? 0) + delta;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>调整余额 · {user?.username}</DialogTitle>
          <DialogDescription>调整将生成一条「管理员调整」账务流水，不可撤销；如需回退请反向调整。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/40 p-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">当前余额</div>
              <div className="num font-medium">{money(user?.balance)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">调整后</div>
              <div className={cn("num font-medium", after < 0 && "text-destructive")}>{money(after)}</div>
            </div>
          </div>
          <Field label="调整金额" required error={errors.amount}>
            <div className="flex gap-2">
              <ToggleGroup type="single" variant="outline" value={sign} onValueChange={(v) => v && setSign(v as "+" | "-")}>
                <ToggleGroupItem value="+" aria-label="增加" className="data-[state=on]:text-success">
                  <Plus />
                </ToggleGroupItem>
                <ToggleGroupItem value="-" aria-label="扣减" className="data-[state=on]:text-destructive">
                  <Minus />
                </ToggleGroupItem>
              </ToggleGroup>
              <AffixInput prefix="¥" suffix="元" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1" autoFocus />
            </div>
          </Field>
          <Field label="备注" required error={errors.remark}>
            <Input value={remark} maxLength={200} onChange={(e) => setRemark(e.target.value)} placeholder="如：线下转账充值、补偿故障损失" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <SubmitButton loading={save.isPending} onClick={submit} variant={sign === "-" ? "destructive" : "default"}>
            确认{sign === "+" ? "增加" : "扣减"}
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 发放套餐
export function GrantDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const invalidate = useInvalidateUsers();
  const products = useProducts();
  const open = !!user;
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  useResetOnOpen(open, user?.id, () => {
    setProductId("");
    setQuantity("1");
    setRemark("");
    setError(null);
  });
  const product = products.data?.find((p) => String(p.id) === productId);
  const save = useMutation({
    mutationFn: () => api.post(`${USERS_URL}/${user!.id}/grant-package`, { product_id: Number(productId), quantity: Math.round(toNum(quantity, 1)), remark }),
    onSuccess: () => {
      toast.success("套餐已发放");
      invalidate();
      onClose();
    },
    onError: toastError,
  });
  const submit = () => {
    const q = toNum(quantity);
    if (!productId) return setError("请选择套餐");
    if (q < 1 || q > 100 || !Number.isInteger(q)) return setError("数量为 1 ~ 100 的整数");
    setError(null);
    save.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发放套餐 · {user?.username}</DialogTitle>
          <DialogDescription>免费赠送套餐，不产生订单，记入账务流水「套餐发放」。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="套餐" required>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择套餐商品" />
              </SelectTrigger>
              <SelectContent>
                {(products.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                    <span className="text-xs text-muted-foreground">
                      {compact(p.tokens)} tokens · {p.valid_days} 天{!p.on_sale && " · 已下架"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="数量" required hint={product ? `合计 ${compact(product.tokens * toNum(quantity, 1))} tokens，价值 ${money(product.price * toNum(quantity, 1))}` : undefined}>
            <AffixInput suffix="份" type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="备注">
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <SubmitButton loading={save.isPending} onClick={submit}>
            发放
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
