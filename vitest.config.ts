import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/src/tests/**/*.test.ts",
      "apps/**/src/tests/**/*.test.ts",
    ],
    environment: "node",
    globals: false,
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      "@agentbridge/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@agentbridge/sdk": new URL("./packages/sdk/src/index.ts", import.meta.url).pathname,
      "@agentbridge/scanner": new URL("./packages/scanner/src/index.ts", import.meta.url).pathname,
      "@agentbridge/openapi": new URL("./packages/openapi/src/index.ts", import.meta.url).pathname,
      "@agentbridge/cli": new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
    },
  },
});
