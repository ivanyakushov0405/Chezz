import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const BACKEND = "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  build: { assetsInlineLimit: 0, sourcemap: true },
  server: {
    proxy: {
      "/api": BACKEND,
      "/auth": BACKEND,
      "/ws": { target: BACKEND, ws: true },
    },
  },
});
