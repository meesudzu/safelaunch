import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { listAuditEventsMock } = vi.hoisted(() => ({
  listAuditEventsMock: vi.fn(async () => {
    await Promise.resolve();
    return {
      events: [
        {
          id: "evt-1",
          createdAt: "2026-08-05T02:00:00.000Z",
          actor: "reviewer@safelaunch.app",
          documentTitle: "Nghị định kiểm thử",
          jurisdiction: "VN",
          decision: "approved" as const,
          reason: "Đủ căn cứ",
        },
      ],
      nextCursor: null,
    };
  }),
}));

vi.mock("../../../lib/api-client", () => ({
  createApiClient: () => ({
    listAuditEvents: listAuditEventsMock,
  }),
}));

import AuditPage from "./page";

describe("AuditPage", () => {
  it("renders audit rows and sends filters to the API client", async () => {
    const element = await AuditPage({
      searchParams: Promise.resolve({
        actor: "reviewer@safelaunch.app",
        decision: "approved",
        from: "2026-08-01",
        to: "2026-08-05",
      }),
    });

    render(element);

    expect(listAuditEventsMock).toHaveBeenCalledWith({
      actor: "reviewer@safelaunch.app",
      decision: "approved",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-05T23:59:59.999Z",
      limit: 50,
    });
    const table = screen.getByRole("table", { name: "Audit log" });
    const row = within(table).getByText("Nghị định kiểm thử").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getByText("reviewer@safelaunch.app")).toBeVisible();
    expect(within(row as HTMLTableRowElement).getByText("VN")).toBeVisible();
    expect(within(row as HTMLTableRowElement).getByText("approved")).toBeVisible();
    expect(within(row as HTMLTableRowElement).getByText("Đủ căn cứ")).toBeVisible();
  });
});
