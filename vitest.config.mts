import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the `@/*` path alias from tsconfig.json. Without this, a test
      // importing app code the same way the app does fails to resolve, which
      // would quietly push tests toward relative imports that then drift from
      // the source they cover.
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
