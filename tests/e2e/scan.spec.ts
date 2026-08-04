import { expect, test } from "@playwright/test";

/**
 * End-to-end coverage for the full public scan flow, run against a live
 * deployed environment (see playwright.config.ts — BASE_URL). Exercises:
 *   1. submitting a scan from the homepage,
 *   2. the progress UI cycling through to a terminal state,
 *   3. opening the resulting report and checking Vietnamese content,
 *   4. the report link's single-use guarantee (second open -> Gone).
 *
 * A real scan involves live AI evaluation, so the terminal wait is bounded
 * by the release-gate p95 latency budget (60s, see
 * docs/compliance/eval-baseline.md) plus headroom for network/queueing.
 */

test("submit a scan, follow it to a report, and confirm the link is single-use", async ({
  page,
}) => {
  await page.goto("/vi");

  await page.getByLabel("URL website").fill("https://example.com");
  await page.getByLabel("Loại ứng dụng").selectOption("digital_entertainment");
  await page.getByRole("button", { name: "Kiểm tra website" }).click();

  await page.waitForURL(/\/vi\/scan\/scan_[0-9a-f]+/, { timeout: 30_000 });

  const progressState = page.getByTestId("progress-state");
  await expect(progressState).toBeVisible();

  const reportLink = page.getByTestId("view-report-link");
  await expect(reportLink).toBeVisible({ timeout: 90_000 });

  const reportHref = await reportLink.getAttribute("href");
  expect(reportHref).toBeTruthy();

  await reportLink.click();
  await page.waitForURL(/\/vi\/report\//);
  await expect(page.getByTestId("report-status")).toBeVisible();

  // Re-opening the same single-use report URL must burn it: second GET
  // returns 410, and the page renders the "unavailable" fallback.
  await page.goto(reportHref!);
  await expect(page.getByRole("heading", { name: "Không thể tải báo cáo" })).toBeVisible();
});
