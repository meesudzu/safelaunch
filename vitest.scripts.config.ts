import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Top-level utility scripts in `scripts/` run in plain Node — no Worker
    // pool. Tests live alongside the code they cover so we don't have to
    // wire `apps/workers/vitest.config.ts` for non-Worker code paths.
    include: ["scripts/**/*.test.mjs", "scripts/**/*.test.mts"],
    environment: "node",
  },
});
