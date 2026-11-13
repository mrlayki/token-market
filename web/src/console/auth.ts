import { createAuthStore } from "@/lib/auth";

export const useAuth = createAuthStore("tm_console_auth", "/login");
