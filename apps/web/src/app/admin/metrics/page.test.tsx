import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminMetricsPage from "./page";

afterEach(() => vi.unstubAllGlobals());

describe("admin usage metrics page", () => {
  it("renders four real usage KPIs and completeness warning", async () => {
    process.env.NEXT_PUBLIC_API_ORIGIN = "https://api.example.test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
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
      ),
    );
    render(await AdminMetricsPage());
    expect(screen.getByRole("heading", { name: "Chỉ số sử dụng" })).toBeInTheDocument();
    expect(screen.getByText("Lượt quét")).toBeInTheDocument();
    expect(screen.getByText(/chưa có hash riêng tư/)).toBeInTheDocument();
  });
});
