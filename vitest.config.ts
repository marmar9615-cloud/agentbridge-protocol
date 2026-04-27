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
      "@marmar9615-cloud/agentbridge-core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@marmar9615-cloud/agentbridge-sdk": new URL("./packages/sdk/src/index.ts", import.meta.url).pathname,
      "@marmar9615-cloud/agentbridge-scanner": new URL("./packages/scanner/src/index.ts", import.meta.url).pathname,
      "@marmar9615-cloud/agentbridge-openapi": new URL("./packages/openapi/src/index.ts", import.meta.url).pathname,
      "@marmar9615-cloud/agentbridge-cli": new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
    },
  },
});
