import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminMetricsPage from "./page";

afterEach(() => vi.unstubAllGlobals());

describe("admin usage metrics page", () => {
  it("renders four real usage KPIs and completeness warning", async () => {
    process.env.NEXT_PUBLIC_API_ORIGIN = "https://api.example.test";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            window: {
              from: "2026-08-04T00:00:00.000Z",
              to: "2026-08-05T00:00:00.000Z",
              previousFrom: "2026-08-03T00:00:00.000Z",
            },
            scans: { value: 12, previous: 9, delta: 3 },
            uniqueSites: { value: 7, previous: 8, delta: -1 },
            reportsOpened: { value: 5, previous: 2, delta: 3 },
            activeReviewers: { value: 3, previous: 1, delta: 2 },
            uniqueSitesComplete: false,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            window: { from: "2026-07-29T00:00:00.000Z", to: "2026-08-05T00:00:00.000Z" },
            severityOrder: ["pass", "review", "high"],
            totals: { pass: 1, review: 2, high: 1 },
            categories: [
              {
                category: "online_game",
                counts: { pass: 1, review: 2, high: 1 },
                total: 4,
                medianSeverity: "review",
              },
            ],
            version: {
              rule_version_id: "vn-mvp-v1",
              prompt_version: "p1",
              retrieval_version: "r1",
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(await AdminMetricsPage());
    expect(screen.getByRole("heading", { name: "Chỉ số sử dụng" })).toBeInTheDocument();
    expect(screen.getByText("Lượt quét")).toBeInTheDocument();
    expect(screen.getByText(/chưa có hash riêng tư/)).toBeInTheDocument();
    expect(screen.getByText("Phân bố tín hiệu tuân thủ")).toBeInTheDocument();
    expect(screen.getByText("online_game")).toBeInTheDocument();
  });
});
