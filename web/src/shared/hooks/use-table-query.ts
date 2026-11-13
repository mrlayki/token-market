import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { api, type Query } from "@/lib/api";
import type { Page } from "@/api/types";

/**
 * 列表页通用 hook：分页与筛选条件同步到 URL（刷新/分享链接可复现），服务端分页。
 *   const t = useTableQuery<CallLog>("/api/console/logs", { model: "", status: "" });
 *   <DataTable data={t.items} total={t.total} page={t.page} ... />
 */
export function useTableQuery<T, F extends Record<string, string> = Record<string, string>>(
  url: string,
  defaults: F = {} as F,
  opts: { pageSize?: number; refetchInterval?: number; extra?: Query } = {},
) {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get("page") ?? 1) || 1;
  const pageSize = Number(sp.get("page_size") ?? opts.pageSize ?? 20) || 20;
  const filters = useMemo(() => {
    const f = { ...defaults } as Record<string, string>;
    for (const k of Object.keys(defaults)) {
      const v = sp.get(k);
      if (v !== null) f[k] = v;
    }
    return f as F;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const query = useQuery({
    queryKey: [url, page, pageSize, filters, opts.extra],
    queryFn: () => api.get<Page<T> & Record<string, unknown>>(url, { page, page_size: pageSize, ...filters, ...opts.extra }),
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval,
  });

  const update = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === "" || v === null) next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  return {
    ...query,
    items: query.data?.items,
    total: query.data?.total ?? 0,
    page,
    pageSize,
    filters,
    setPage: (p: number) => update({ page: p }),
    setPageSize: (n: number) => update({ page_size: n, page: 1 }),
    setFilters: (patch: Partial<F>) => update({ ...(patch as Record<string, string>), page: 1 }),
    resetFilters: () => update(Object.fromEntries(Object.keys(defaults).map((k) => [k, undefined]))),
  };
}
