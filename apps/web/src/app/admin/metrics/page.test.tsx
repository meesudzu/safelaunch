import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getUsageMetricsMock, getComplianceMetricsMock } = vi.hoisted(() => ({
  getUsageMetricsMock: vi.fn(async () => {
    await Promise.resolve();
    return {
      windowHours: 24,
      generatedAt: "2026-08-06T00:00:00.000Z",
      tiles: [
        { key: "scans24h" as const, label: "Scans in last 24h", value: 6, delta: 2 },
        { key: "uniqueSites24h" as const, label: "Unique sites scanned", value: 3 },
        { key: "reportsOpened24h" as const, label: "Reports opened", value: 2 },
        { key: "activeReviewers24h" as const, label: "Active reviewers", value: 1 },
      ],
    };
  }),
  getComplianceMetricsMock: vi.fn(async () => {
    await Promise.resolve();
    return {
      generatedAt: "2026-08-06T00:00:00.000Z",
      severityHistogram: [
        { severity: "high" as const, count: 2 },
        { severity: "review" as const, count: 3 },
        { severity: "pass" as const, count: 5 },
      ],
      categorySeverity: [{ category: "online_game", high: 2, review: 1, pass: 0 }],
    };
  }),
}));

vi.mock("../../../lib/api-client", () => ({
  createApiClient: () => ({
    getUsageMetrics: getUsageMetricsMock,
    getComplianceMetrics: getComplianceMetricsMock,
  }),
}));

import MetricsPage from "./page";

describe("MetricsPage", () => {
  it("renders usage KPI tiles", async () => {
    const element = await MetricsPage();

    render(element);

    expect(getUsageMetricsMock).toHaveBeenCalledWith();
    expect(getComplianceMetricsMock).toHaveBeenCalledWith();
    expect(screen.getByRole("heading", { name: "Metrics" })).toBeVisible();
    const scansTile = screen.getByRole("region", { name: "Scans in last 24h" });
    expect(within(scansTile).getByText("6")).toBeVisible();
    expect(within(scansTile).getByText("+2 vs previous 24h")).toBeVisible();
    const sitesTile = screen.getByRole("region", { name: "Unique sites scanned" });
    expect(within(sitesTile).getByText("3")).toBeVisible();
    expect(screen.getByText("Reports opened")).toBeVisible();
    expect(screen.getByText("Active reviewers")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Compliance distribution" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Severity histogram" })).toBeVisible();
    expect(screen.getByText("online_game")).toBeVisible();
  });
});
