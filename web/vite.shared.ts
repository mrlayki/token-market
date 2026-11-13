import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { UserConfig } from "vite";

export function makeConfig(app: "console" | "admin", port: number): UserConfig {
  const api = process.env.TM_API_URL || "http://localhost:18000";
  const relay = process.env.TM_RELAY_URL || "http://localhost:18001";
  return {
    root: path.resolve(__dirname, `src/${app}`),
    publicDir: path.resolve(__dirname, "public"),
    envDir: __dirname,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/shared"),
        "@console": path.resolve(__dirname, "src/console"),
        "@admin": path.resolve(__dirname, "src/admin"),
      },
    },
    server: { port, proxy: { "/api": api, "/v1": relay } },
    build: { outDir: path.resolve(__dirname, `dist/${app}`), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  };
}
