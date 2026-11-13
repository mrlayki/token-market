import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Loader2, XCircle, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/misc";
import { api, toastError } from "@/lib/api";
import { ms } from "@/lib/format";
import type { Channel, ChannelTestResult } from "../../lib/types";

export const CHANNELS_KEY = "/api/admin/channels";

export function testToast(r: ChannelTestResult, prefix = "") {
  const detail = [r.model && `模型 ${r.model}`, r.elapsed_ms != null && `耗时 ${ms(r.elapsed_ms)}`, r.key_id && `Key #${r.key_id}`]
    .filter(Boolean)
    .join(" · ");
  if (r.ok) toast.success(`${prefix}${r.message || "测试成功"}`, { description: detail });
  else toast.error(`${prefix}${r.message || "测试失败"}`, { description: detail || undefined, duration: 8000 });
}

/** 渠道测试分裂按钮：主按钮使用默认测试模型，下拉可选模型与流式 */
export function TestButton({ channel }: { channel: Channel }) {
  const qc = useQueryClient();
  const [stream, setStream] = useState(false);
  const m = useMutation({
    mutationFn: (model?: string) => api.post<ChannelTestResult>(`/api/admin/channels/${channel.id}/test`, { model, stream }),
    onSuccess: (r) => {
      testToast(r, `#${channel.id} `);
      qc.invalidateQueries({ queryKey: [CHANNELS_KEY] });
    },
    onError: toastError,
  });
  return (
    <div className="inline-flex">
      <Button
        variant="outline"
        size="xs"
        className="rounded-r-none border-r-0"
        disabled={m.isPending}
        onClick={(e) => {
          e.stopPropagation();
          m.mutate(undefined);
        }}
      >
        {m.isPending ? <Loader2 className="animate-spin" /> : <Zap />}
        测试
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-xs" className="rounded-l-none" disabled={m.isPending}>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-60 overflow-y-auto">
          <DropdownMenuCheckboxItem checked={stream} onCheckedChange={setStream} onSelect={(e) => e.preventDefault()}>
            流式测试（stream）
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">选择模型测试</DropdownMenuLabel>
          {channel.models.length === 0 && <DropdownMenuItem disabled>未配置模型</DropdownMenuItem>}
          {channel.models.map((md) => (
            <DropdownMenuItem key={md} onClick={() => m.mutate(md)} className="font-mono text-xs">
              {md}
              {md === channel.test_model && <span className="ml-auto text-[10px] text-muted-foreground">默认</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** 批量测试结果 */
export function BatchTestDialog({
  open,
  onOpenChange,
  loading,
  results,
  names,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  loading: boolean;
  results: ChannelTestResult[] | null;
  names: Record<number, string>;
}) {
  const ok = results?.filter((r) => r.ok).length ?? 0;
  const fail = (results?.length ?? 0) - ok;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>批量测试结果</DialogTitle>
          <DialogDescription>
            {loading ? (
              "正在测试，请稍候…"
            ) : results ? (
              <>
                共 {results.length} 个渠道，<span className="text-success">成功 {ok}</span>，
                <span className="text-destructive">失败 {fail}</span>。测试成功的自动禁用渠道将按「渠道健康」设置自动启用。
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" />
            测试中…
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead>渠道</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                  <TableHead>信息</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(results ?? [])
                  .slice()
                  .sort((a, b) => Number(a.ok) - Number(b.ok))
                  .map((r) => (
                    <TableRow key={r.channel_id}>
                      <TableCell className="num text-muted-foreground">#{r.channel_id}</TableCell>
                      <TableCell className="font-medium">{names[r.channel_id ?? 0] ?? "-"}</TableCell>
                      <TableCell>
                        {r.ok ? (
                          <StatusBadge tone="success">
                            <CheckCircle2 className="size-3" />
                            成功
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="danger">
                            <XCircle className="size-3" />
                            失败{r.status ? ` ${r.status}` : ""}
                          </StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.model ?? "-"}</TableCell>
                      <TableCell className="num text-right">{r.elapsed_ms != null ? ms(r.elapsed_ms) : "-"}</TableCell>
                      <TableCell className="max-w-[260px] text-xs break-all whitespace-normal text-muted-foreground">{r.message}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
