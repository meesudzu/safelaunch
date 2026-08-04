import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against a deployed environment (staging/preview), never against a
 * local dev server — the scan pipeline depends on Cloudflare bindings
 * (Vectorize, Workers AI, Workflows) that `wrangler dev` cannot proxy.
 * Set BASE_URL to the environment under test; CI wires it to
 * `secrets.PREVIEW_URL` (see .github/workflows/ci.yml).
 */
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 120_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
