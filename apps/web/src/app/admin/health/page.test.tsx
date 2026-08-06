import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getSystemHealthMock } = vi.hoisted(() => ({
  getSystemHealthMock: vi.fn(async () => {
    await Promise.resolve();
    return {
      generatedAt: "2026-08-06T00:00:00.000Z",
      d1: {
        rowCounts: [
          { tableName: "scans", rows: 12 },
          { tableName: "legal_documents", rows: 4 },
        ],
        retention: {
          oldestScan: "2026-08-01T00:00:00.000Z",
          nextPurge: "2026-08-08T00:00:00.000Z",
        },
        oldestPendingReview: "2026-08-02T00:00:00.000Z",
      },
      bindings: [
        { name: "ARTIFACTS", status: "missing" },
        { name: "LEGAL_INDEX", status: "configured" },
      ],
    };
  }),
}));

vi.mock("../../../lib/api-client", () => ({
  createApiClient: () => ({
    getSystemHealth: getSystemHealthMock,
  }),
}));

import HealthPage from "./page";

describe("HealthPage", () => {
  it("renders D1 health and binding statuses", async () => {
    const element = await HealthPage();

    render(element);

    expect(getSystemHealthMock).toHaveBeenCalledWith();
    expect(screen.getByRole("heading", { name: "System health" })).toBeVisible();
    const table = screen.getByRole("table", { name: "D1 row counts" });
    expect(within(table).getByText("scans")).toBeVisible();
    expect(within(table).getByText("12")).toBeVisible();
    expect(screen.getByText("ARTIFACTS")).toBeVisible();
    expect(screen.getByText("missing")).toBeVisible();
    expect(screen.queryByText("https://example.com")).toBeNull();
  });
});
