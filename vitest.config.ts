import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@hotel-rate-comparator/shared": path.resolve(
        __dirname,
        "packages/shared/src",
      ),
    },
  },
});
