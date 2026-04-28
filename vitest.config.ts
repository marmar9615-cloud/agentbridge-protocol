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
      "@marmarlabs/agentbridge-core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@marmarlabs/agentbridge-sdk": new URL("./packages/sdk/src/index.ts", import.meta.url).pathname,
      "@marmarlabs/agentbridge-scanner": new URL("./packages/scanner/src/index.ts", import.meta.url).pathname,
      "@marmarlabs/agentbridge-openapi": new URL("./packages/openapi/src/index.ts", import.meta.url).pathname,
      "@marmarlabs/agentbridge-cli": new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
    },
  },
});
