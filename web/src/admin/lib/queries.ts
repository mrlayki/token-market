import { useQuery } from "@tanstack/react-query";
import type { Page, PackageProduct } from "@/api/types";
import { api } from "@/lib/api";
import { useAuth } from "../auth";
import type { ChannelType, Group, ModelMeta, Vendor } from "./types";

/** 下拉选项类数据，统一 queryKey 方便变更后 invalidate */
export const qk = {
  channelTypes: ["admin", "channel-types"] as const,
  channelTags: ["admin", "channel-tags"] as const,
  groups: ["admin", "groups"] as const,
  vendors: ["admin", "vendors"] as const,
  allModels: ["admin", "all-models"] as const,
  products: ["admin", "products"] as const,
};

export function useChannelTypes() {
  return useQuery({ queryKey: qk.channelTypes, queryFn: () => api.get<ChannelType[]>("/api/admin/channels/types"), staleTime: Infinity });
}

export function useChannelTags() {
  return useQuery({ queryKey: qk.channelTags, queryFn: () => api.get<string[]>("/api/admin/channels/tags") });
}

export function useGroups() {
  return useQuery({ queryKey: qk.groups, queryFn: () => api.get<Group[]>("/api/admin/groups") });
}

export function useVendors() {
  return useQuery({ queryKey: qk.vendors, queryFn: () => api.get<Vendor[]>("/api/admin/vendors") });
}

/** 全部模型元数据（最多 200 个，管理端选项足够） */
export function useAllModels() {
  return useQuery({
    queryKey: qk.allModels,
    queryFn: () => api.get<Page<ModelMeta>>("/api/admin/models", { page_size: 200 }).then((p) => p.items),
  });
}

export function useProducts() {
  return useQuery({ queryKey: qk.products, queryFn: () => api.get<PackageProduct[]>("/api/admin/package-products") });
}

export function useIsRoot() {
  return useAuth((s) => s.user?.role === "root");
}
