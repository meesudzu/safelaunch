import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { listAdminScansMock } = vi.hoisted(() => ({
  listAdminScansMock: vi.fn(async () => {
    await Promise.resolve();
    return {
      scans: [
        {
          scanId: "scan_1",
          createdAt: "2026-08-06T01:00:00.000Z",
          jurisdiction: "VN",
          category: "online_game",
          state: "evaluating",
          pagesDone: 2,
          totalPages: 3,
          expiresAt: "2026-08-13T01:00:00.000Z",
          urlHashPrefix: "abcdef123456",
        },
      ],
      nextCursor: null,
      live: true,
    };
  }),
}));

vi.mock("../../../lib/api-client", () => ({
  createApiClient: () => ({
    listAdminScans: listAdminScansMock,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import ScansPage from "./page";

describe("ScansPage", () => {
  it("renders scan status rows with hash prefixes", async () => {
    const element = await ScansPage({ searchParams: Promise.resolve({}) });

    render(element);

    expect(listAdminScansMock).toHaveBeenCalledWith({ live: true, limit: 100 });
    const table = screen.getByRole("table", { name: "Site scans" });
    const row = within(table).getByText("scan_1").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getByText("evaluating")).toBeVisible();
    expect(within(row as HTMLTableRowElement).getByText("2/3")).toBeVisible();
    expect(within(row as HTMLTableRowElement).getByText("abcdef123456")).toBeVisible();
    expect(screen.queryByText("https://example.com")).toBeNull();
  });
});
