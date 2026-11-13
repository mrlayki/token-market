import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SiteConfig } from "@/api/types";

export function useSite() {
  return useQuery({ queryKey: ["site"], queryFn: () => api.get<SiteConfig>("/api/public/site"), staleTime: 300_000 });
}
