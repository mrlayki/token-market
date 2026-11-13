import {
  type ColumnDef,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Empty } from "./page";

export interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[] | undefined;
  loading?: boolean;
  /** 服务端分页 */
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  toolbar?: ReactNode;
  empty?: ReactNode;
  rowKey?: (row: T) => string | number;
  selectable?: boolean;
  onSelectionChange?: (rows: T[]) => void;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  loading,
  total,
  page = 1,
  pageSize = 20,
  onPageChange,
  onPageSizeChange,
  toolbar,
  empty,
  rowKey,
  selectable,
  onSelectionChange,
  onRowClick,
  footer,
  className,
}: DataTableProps<T>) {
  const [selection, setSelection] = useState<RowSelectionState>({});
  const cols: ColumnDef<T, any>[] = selectable
    ? [
        {
          id: "__select",
          size: 32,
          header: ({ table }) => (
            <Checkbox
              checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
              onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
              aria-label="全选"
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(v) => row.toggleSelected(!!v)}
              onClick={(e) => e.stopPropagation()}
              aria-label="选择"
            />
          ),
        },
        ...columns,
      ]
    : columns;

  const table = useReactTable({
    data: data ?? [],
    columns: cols,
    getCoreRowModel: getCoreRowModel(),
    getRowId: rowKey ? (r) => String(rowKey(r)) : undefined,
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
    enableRowSelection: !!selectable,
    manualPagination: true,
  });

  useEffect(() => {
    onSelectionChange?.(table.getSelectedRowModel().rows.map((r) => r.original));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => setSelection({}), [data]);

  const pages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <div className={cn("space-y-3", className)}>
      {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader className="bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="h-10 whitespace-nowrap text-xs font-medium text-muted-foreground" style={{ width: h.column.columnDef.size !== 150 ? h.column.columnDef.size : undefined }}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && !data?.length ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {cols.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={cn(onRowClick && "cursor-pointer", loading && "opacity-60")}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={cols.length}>{empty ?? <Empty />}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {(total != null || footer) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <div>{footer ?? (total != null && <>共 {total.toLocaleString()} 条</>)}</div>
          {total != null && onPageChange && (
            <div className="flex items-center gap-2">
              {onPageSizeChange && (
                <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
                  <SelectTrigger size="sm" className="w-[116px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} 条/页
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" size="icon" className="size-8" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                <ChevronLeft />
              </Button>
              <span className="num min-w-16 text-center">
                {page} / {pages}
              </span>
              <Button variant="outline" size="icon" className="size-8" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
