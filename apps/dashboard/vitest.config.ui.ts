import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.ui.test.tsx"],
    setupFiles: ["tests/setup.tsx"],
    coverage: {
      provider: "v8",
      include: [
        "app/dashboard/agents/components/**",
        "app/dashboard/agents/agents-client.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
});
