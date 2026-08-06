import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getUsageMetricsMock } = vi.hoisted(() => ({
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
}));

vi.mock("../../../lib/api-client", () => ({
  createApiClient: () => ({
    getUsageMetrics: getUsageMetricsMock,
  }),
}));

import MetricsPage from "./page";

describe("MetricsPage", () => {
  it("renders usage KPI tiles", async () => {
    const element = await MetricsPage();

    render(element);

    expect(getUsageMetricsMock).toHaveBeenCalledWith();
    expect(screen.getByRole("heading", { name: "Metrics" })).toBeVisible();
    expect(screen.getByText("Scans in last 24h")).toBeVisible();
    expect(screen.getByText("6")).toBeVisible();
    expect(screen.getByText("+2 vs previous 24h")).toBeVisible();
    expect(screen.getByText("Unique sites scanned")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("Reports opened")).toBeVisible();
    expect(screen.getByText("Active reviewers")).toBeVisible();
  });
});
