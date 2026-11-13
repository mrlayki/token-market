import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Empty } from "@/components/page";
import { confirm, Mono, StatusBadge } from "@/components/misc";
import { api, toastError } from "@/lib/api";
import { num } from "@/lib/format";
import type { OK } from "@/api/types";
import { TimeCell } from "../../components/cells";
import { CHANNEL_STATUS, lbl } from "../../lib/labels";
import type { Channel, ChannelKey, ChannelTestResult } from "../../lib/types";
import { CHANNELS_KEY, testToast } from "./test";

export function KeyManager({ channel, onOpenChange }: { channel: Channel | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const cid = channel?.id;
  const keysKey = ["admin", "channel-keys", cid];
  const q = useQuery({
    queryKey: keysKey,
    queryFn: () => api.get<ChannelKey[]>(`/api/admin/channels/${cid}/keys`),
    enabled: cid != null,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keysKey });
    qc.invalidateQueries({ queryKey: [CHANNELS_KEY] });
  };
  const status = useMutation({
    mutationFn: ({ kid, on }: { kid: number; on: boolean }) => api.post(`/api/admin/channels/${cid}/keys/${kid}/status`, { status: on ? 1 : 2 }),
    onSuccess: refresh,
    onError: toastError,
  });
  const del = useMutation({
    mutationFn: (kid: number) => api.del<OK>(`/api/admin/channels/${cid}/keys/${kid}`),
    onSuccess: () => {
      toast.success("Key 已删除");
      refresh();
    },
    onError: toastError,
  });
  const enableAll = useMutation({
    mutationFn: () => api.post<OK>(`/api/admin/channels/${cid}/keys/enable-auto-disabled`),
    onSuccess: (r) => {
      toast.success(r.message || "已启用");
      refresh();
    },
    onError: toastError,
  });
  const test = useMutation({
    mutationFn: (kid: number) => api.post<ChannelTestResult>(`/api/admin/channels/${cid}/test`, { key_id: kid }),
    onSuccess: (r) => {
      testToast(r);
      refresh();
    },
    onError: toastError,
  });
  const keys = q.data ?? [];
  const autoDisabled = keys.filter((k) => k.status === 3).length;

  return (
    <Dialog open={!!channel} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Key 管理 <span className="font-normal text-muted-foreground">· #{channel?.id} {channel?.name}</span>
          </DialogTitle>
          <DialogDescription>
            共 {keys.length} 个 Key，启用 {keys.filter((k) => k.status === 1).length} 个
            {autoDisabled > 0 && <>，自动禁用 {autoDisabled} 个</>}。多 Key 模式：{channel?.multi_key_mode === "polling" ? "轮询" : "随机"}。如需追加 Key，请在编辑渠道中填写。
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" disabled={!autoDisabled || enableAll.isPending} onClick={() => enableAll.mutate()}>
            {enableAll.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            启用全部自动禁用的 Key
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">请求数</TableHead>
                <TableHead>状态变更</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="w-40 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Empty title="暂无 Key" description="在编辑渠道中添加 Key" />
                  </TableCell>
                </TableRow>
              ) : (
                keys.map((k) => {
                  const s = lbl(CHANNEL_STATUS, k.status);
                  return (
                    <TableRow key={k.id}>
                      <TableCell className="num text-muted-foreground">#{k.id}</TableCell>
                      <TableCell>
                        <Mono>{k.key_mask}</Mono>
                      </TableCell>
                      <TableCell>
                        {k.status_reason ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <StatusBadge tone={s.tone} dot>
                                  {s.label}
                                </StatusBadge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm break-all">{k.status_reason}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <StatusBadge tone={s.tone} dot>
                            {s.label}
                          </StatusBadge>
                        )}
                        {k.status !== 1 && k.status_reason && (
                          <div className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground">{k.status_reason}</div>
                        )}
                      </TableCell>
                      <TableCell className="num text-right">{num(k.request_count)}</TableCell>
                      <TableCell>
                        <TimeCell v={k.status_changed_at} />
                      </TableCell>
                      <TableCell>
                        <TimeCell v={k.created_at} fmt="YYYY-MM-DD HH:mm" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          <Switch
                            checked={k.status === 1}
                            disabled={status.isPending && status.variables?.kid === k.id}
                            onCheckedChange={(on) => status.mutate({ kid: k.id, on })}
                            aria-label="启用/禁用"
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                disabled={test.isPending && test.variables === k.id}
                                onClick={() => test.mutate(k.id)}
                              >
                                {test.isPending && test.variables === k.id ? <Loader2 className="animate-spin" /> : <Zap />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>使用此 Key 测试</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-destructive hover:text-destructive"
                                onClick={async () => {
                                  if (await confirm({ title: `删除 Key #${k.id}？`, description: "删除后不可恢复。", danger: true, confirmText: "删除" }))
                                    del.mutate(k.id);
                                }}
                              >
                                <Trash2 />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>删除</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
