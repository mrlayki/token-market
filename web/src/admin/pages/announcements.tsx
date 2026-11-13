import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, MoreHorizontal, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Announcement } from "@/api/types";
import { DataTable } from "@/components/data-table";
import { confirm, StatusBadge } from "@/components/misc";
import { Empty, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, toastError } from "@/lib/api";
import { MarkdownView } from "../components/announcements-markdown";
import { TimeCell } from "../components/cells";
import { Field, SubmitButton } from "../components/form";
import { ANN_LEVEL, lbl } from "../lib/labels";

type Ann = Announcement & { published: boolean };
type AnnIn = Pick<Ann, "title" | "content" | "level" | "published" | "pinned">;

const KEY = ["admin", "announcements"];
const EMPTY: AnnIn = { title: "", content: "", level: "info", published: true, pinned: false };

export default function AnnouncementsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<Ann[]>("/api/admin/announcements") });
  const [editing, setEditing] = useState<Ann | "new" | null>(null);
  const [preview, setPreview] = useState<Ann | null>(null);

  const save = useMutation({
    mutationFn: ({ id, body }: { id?: number; body: AnnIn }) =>
      id ? api.put<Ann>(`/api/admin/announcements/${id}`, body) : api.post<Ann>("/api/admin/announcements", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: toastError,
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/announcements/${id}`),
    onSuccess: () => {
      toast.success("已删除");
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: toastError,
  });

  const patch = (a: Ann, p: Partial<AnnIn>) =>
    save.mutate(
      { id: a.id, body: { title: a.title, content: a.content, level: a.level, published: a.published, pinned: a.pinned, ...p } },
      { onSuccess: () => toast.success("已更新") },
    );

  const rows = [...(q.data ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.id - a.id);

  return (
    <div>
      <PageHeader
        title="公告管理"
        description="发布到用户控制台首页的公告，支持 Markdown，置顶公告优先展示"
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus />
            新建公告
          </Button>
        }
      />
      <DataTable
        data={rows}
        loading={q.isLoading}
        rowKey={(r) => r.id}
        footer={<>共 {rows.length} 条，已发布 {rows.filter((r) => r.published).length} 条</>}
        total={undefined}
        empty={
          <Empty
            title="暂无公告"
            action={
              <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                <Plus />
                新建公告
              </Button>
            }
          />
        }
        columns={[
          {
            id: "title",
            header: "标题",
            cell: ({ row }) => (
              <div className="flex max-w-[460px] items-center gap-2">
                {row.original.pinned && <Pin className="size-3.5 shrink-0 fill-current text-primary" />}
                <button className="truncate text-left font-medium hover:underline" onClick={() => setPreview(row.original)}>
                  {row.original.title}
                </button>
              </div>
            ),
          },
          {
            id: "level",
            header: "级别",
            size: 80,
            cell: ({ row }) => {
              const l = lbl(ANN_LEVEL, row.original.level);
              return <StatusBadge tone={l.tone}>{l.label}</StatusBadge>;
            },
          },
          {
            id: "summary",
            header: "内容摘要",
            cell: ({ row }) => (
              <span className="block max-w-[360px] truncate text-xs text-muted-foreground">
                {row.original.content.replace(/[#>*`_\-[\]()!]/g, "").slice(0, 120) || "-"}
              </span>
            ),
          },
          {
            id: "pinned",
            header: "置顶",
            size: 70,
            cell: ({ row }) => <Switch checked={row.original.pinned} onCheckedChange={(v) => patch(row.original, { pinned: v })} />,
          },
          {
            id: "published",
            header: "发布",
            size: 70,
            cell: ({ row }) => <Switch checked={row.original.published} onCheckedChange={(v) => patch(row.original, { published: v })} />,
          },
          { id: "time", header: "创建时间", size: 140, cell: ({ row }) => <TimeCell v={row.original.created_at} /> },
          {
            id: "ops",
            header: "",
            size: 90,
            cell: ({ row }) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => setEditing(row.original)}>
                  <Pencil />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="size-7">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setPreview(row.original)}>
                      <Eye />
                      预览
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={async () => {
                        if (await confirm({ title: "删除公告", description: `确定删除「${row.original.title}」？此操作不可恢复。`, danger: true, confirmText: "删除" }))
                          del.mutate(row.original.id);
                      }}
                    >
                      <Trash2 />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ),
          },
        ]}
      />

      {editing && (
        <Editor
          initial={editing === "new" ? null : editing}
          loading={save.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(body) =>
            save.mutate(
              { id: editing === "new" ? undefined : editing.id, body },
              {
                onSuccess: () => {
                  toast.success(editing === "new" ? "公告已创建" : "公告已保存");
                  setEditing(null);
                },
              },
            )
          }
        />
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {preview && <StatusBadge tone={lbl(ANN_LEVEL, preview.level).tone}>{lbl(ANN_LEVEL, preview.level).label}</StatusBadge>}
              {preview?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">{preview && <MarkdownView>{preview.content}</MarkdownView>}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Editor({
  initial,
  loading,
  onClose,
  onSubmit,
}: {
  initial: Ann | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (b: AnnIn) => void;
}) {
  const [f, setF] = useState<AnnIn>(
    initial ? { title: initial.title, content: initial.content, level: initial.level, published: initial.published, pinned: initial.pinned } : EMPTY,
  );
  const [err, setErr] = useState<Record<string, string>>({});
  const set = <K extends keyof AnnIn>(k: K, v: AnnIn[K]) => setF((p) => ({ ...p, [k]: v }));
  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = "请填写标题";
    if (f.title.length > 128) e.title = "标题不超过 128 字";
    if (!f.content.trim()) e.content = "请填写内容";
    setErr(e);
    if (Object.keys(e).length) return;
    onSubmit({ ...f, title: f.title.trim() });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? "编辑公告" : "新建公告"}</DialogTitle>
          <DialogDescription>内容支持 Markdown（GFM 表格、列表、链接等）</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <Field label="标题" required error={err.title}>
              <Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="例如：Claude 模型限时 8 折" maxLength={128} />
            </Field>
            <Field label="级别">
              <Select value={f.level} onValueChange={(v) => set("level", v as AnnIn["level"])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ANN_LEVEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="内容" required error={err.content}>
            <Tabs defaultValue="edit">
              <TabsList>
                <TabsTrigger value="edit">编辑</TabsTrigger>
                <TabsTrigger value="preview">预览</TabsTrigger>
              </TabsList>
              <TabsContent value="edit">
                <Textarea
                  value={f.content}
                  onChange={(e) => set("content", e.target.value)}
                  rows={14}
                  className="max-h-[50vh] font-mono text-xs"
                  placeholder={"## 标题\n\n- 支持 **Markdown**\n- [链接](https://example.com)"}
                />
              </TabsContent>
              <TabsContent value="preview">
                <div className="h-[300px] overflow-auto rounded-md border p-4">
                  {f.content.trim() ? <MarkdownView>{f.content}</MarkdownView> : <p className="text-sm text-muted-foreground">暂无内容</p>}
                </div>
              </TabsContent>
            </Tabs>
          </Field>
          <div className="flex gap-8">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.published} onCheckedChange={(v) => set("published", v)} />
              立即发布
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.pinned} onCheckedChange={(v) => set("pinned", v)} />
              置顶
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <SubmitButton loading={loading} onClick={submit}>
            保存
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
