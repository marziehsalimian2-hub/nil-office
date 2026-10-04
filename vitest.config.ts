import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws when imported outside a Next server bundle — stubbed so server modules are unit-testable.
      "server-only": path.resolve(__dirname, "lib/test-stubs/server-only.ts"),
    },
  },
});
