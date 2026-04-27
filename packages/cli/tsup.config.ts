import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: { compilerOptions: { incremental: false } },
    clean: true,
    sourcemap: true,
    target: "node20",
    splitting: false,
    shims: false,
  },
  {
    entry: ["src/bin.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "node20",
    splitting: false,
    shims: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
