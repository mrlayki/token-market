import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}

function apply(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "system",
      setMode: (mode) => {
        apply(mode);
        set({ mode });
      },
    }),
    { name: "tm_theme", onRehydrateStorage: () => (s) => apply(s?.mode ?? "system") },
  ),
);

export function resolvedDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => apply(useTheme.getState().mode));
