import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: { include: ["src/**/*.{test,e2e.test}.ts"], globals: true, environment: "node" },
  plugins: [swc.vite()],
});
