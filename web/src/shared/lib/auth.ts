import { create } from "zustand";
import { persist } from "zustand/middleware";
import { configureApi } from "./api";
import type { UserBrief } from "../api/types";

interface AuthState {
  token: string | null;
  user: UserBrief | null;
  setAuth: (token: string, user: UserBrief) => void;
  setUser: (user: UserBrief) => void;
  logout: () => void;
}

/** 每个应用独立的登录态（用户端与管理端互不影响） */
export function createAuthStore(storageKey: string, loginPath = "/login") {
  const store = create<AuthState>()(
    persist(
      (set) => ({
        token: null,
        user: null,
        setAuth: (token, user) => set({ token, user }),
        setUser: (user) => set({ user }),
        logout: () => set({ token: null, user: null }),
      }),
      { name: storageKey },
    ),
  );
  configureApi({
    getToken: () => store.getState().token,
    onUnauthorized: () => {
      if (store.getState().token) {
        store.getState().logout();
        const next = encodeURIComponent(location.pathname + location.search);
        if (!location.pathname.startsWith(loginPath)) location.href = `${loginPath}?next=${next}`;
      }
    },
  });
  return store;
}
