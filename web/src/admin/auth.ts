import { createAuthStore } from "@/lib/auth";

export const useAuth = createAuthStore("tm_admin_auth", "/login");
