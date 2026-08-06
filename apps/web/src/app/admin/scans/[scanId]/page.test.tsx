import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getAdminScanMock } = vi.hoisted(() => ({
  getAdminScanMock: vi.fn(async () => {
    await Promise.resolve();
    return {
      scanId: "scan_1",
      createdAt: "2026-08-06T01:00:00.000Z",
      jurisdiction: "VN",
      category: "online_game",
      state: "completed",
      expiresAt: "2026-08-13T01:00:00.000Z",
      urlHashPrefix: "abcdef123456",
      coverage: { fetched: ["homepage"], failed: [], skipped: ["terms"] },
      severityCounts: { high: 2, review: 1, pass: 3 },
      analysisRuns: [
        {
          modelId: "@cf/meta/llama",
          promptVersion: "p1",
          retrievalVersion: "r1",
          createdAt: "2026-08-06T01:30:00.000Z",
        },
      ],
      reportUrl: "/vi/report/tok_1",
    };
  }),
}));

vi.mock("../../../../lib/api-client", () => ({
  createApiClient: () => ({
    getAdminScan: getAdminScanMock,
  }),
}));

import ScanDetailPage from "./page";

describe("ScanDetailPage", () => {
  it("renders coverage, severity counts, analysis runs, and report link", async () => {
    const element = await ScanDetailPage({
      params: Promise.resolve({ scanId: "scan_1" }),
    });

    render(element);

    expect(getAdminScanMock).toHaveBeenCalledWith("scan_1");
    expect(screen.getByRole("heading", { name: "scan_1" })).toBeVisible();
    expect(screen.getByText("abcdef123456")).toBeVisible();
    expect(screen.getByText("homepage")).toBeVisible();
    expect(screen.getByText("terms")).toBeVisible();
    expect(screen.getByRole("link", { name: "Mở report" })).toHaveAttribute(
      "href",
      "/vi/report/tok_1",
    );
    const severity = screen.getByRole("table", { name: "Finding severity" });
    expect(within(severity).getByText("high")).toBeVisible();
    expect(within(severity).getByText("2")).toBeVisible();
    expect(screen.getByText("@cf/meta/llama")).toBeVisible();
    expect(screen.queryByText("https://example.com")).toBeNull();
  });
});
