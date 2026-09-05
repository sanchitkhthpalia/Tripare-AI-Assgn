import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
  resolve: {
    alias: {
      "@hotel-rate-comparator/shared": new URL(
        "../../packages/shared/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
