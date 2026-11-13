import { toast } from "sonner";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type TokenGetter = () => string | null;
type UnauthorizedHandler = () => void;

let getToken: TokenGetter = () => null;
let onUnauthorized: UnauthorizedHandler = () => {};

export function configureApi(opts: { getToken: TokenGetter; onUnauthorized: UnauthorizedHandler }) {
  getToken = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query) {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function request<T>(method: string, url: string, body?: unknown, query?: Query): Promise<T> {
  const res = await fetch(url + qs(query), {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    onUnauthorized();
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && ("message" in data ? data.message : "detail" in data ? fmtDetail(data.detail) : null)) ||
      `请求失败（${res.status}）`;
    throw new ApiError(res.status, (data as { code?: string })?.code ?? "error", String(msg));
  }
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function fmtDetail(d: unknown): string {
  if (Array.isArray(d)) {
    return d.map((e) => `${(e.loc ?? []).slice(1).join(".")}: ${e.msg}`).join("；");
  }
  return String(d);
}

export const api = {
  get: <T>(url: string, query?: Query) => request<T>("GET", url, undefined, query),
  post: <T>(url: string, body?: unknown, query?: Query) => request<T>("POST", url, body ?? {}, query),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/** 带登录态下载文件（CSV 导出等） */
export async function download(url: string, query?: Query, filename?: string) {
  const res = await fetch(url + qs(query), { headers: authHeaders() });
  if (!res.ok) {
    toast.error(`下载失败（${res.status}）`);
    return;
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename ?? res.headers.get("content-disposition")?.split("filename=")[1] ?? "export.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function toastError(e: unknown) {
  toast.error(errorMessage(e));
}
