import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getRedeemInventoryMock } = vi.hoisted(() => ({
  getRedeemInventoryMock: vi.fn(async () => {
    await Promise.resolve();
    return {
      generatedAt: "2026-08-06T00:00:00.000Z",
      tiles: [
        { key: "issued" as const, label: "Codes issued", value: 10, secondaryValue: 4 },
        { key: "redeemed" as const, label: "Codes redeemed", value: 6, secondaryValue: 2 },
        { key: "redemptionRate" as const, label: "Redemption rate", value: 60 },
        { key: "expiringSoon" as const, label: "Expiring soon", value: 1 },
      ],
      batches: [
        {
          batchId: "Q3 marketing campaign",
          issuedAt: "2026-08-01T00:00:00.000Z",
          issuedBy: "ops@safelaunch.app",
          total: 10,
          redeemed: 6,
          expired: 1,
          unused: 3,
        },
      ],
    };
  }),
}));

vi.mock("../../../lib/api-client", () => ({
  createApiClient: () => ({
    getRedeemInventory: getRedeemInventoryMock,
  }),
}));

import RedeemPage from "./page";

describe("RedeemPage", () => {
  it("renders redeem inventory tiles and batch rows", async () => {
    const element = await RedeemPage();

    render(element);

    expect(getRedeemInventoryMock).toHaveBeenCalledWith();
    expect(screen.getByRole("heading", { name: "Redeem codes" })).toBeVisible();
    const issuedTile = screen.getByRole("region", { name: "Codes issued" });
    expect(within(issuedTile).getByText("10")).toBeVisible();
    expect(within(issuedTile).getByText("4 last 7d")).toBeVisible();
    const table = screen.getByRole("table", { name: "Redeem batches" });
    const row = within(table).getByText("Q3 marketing campaign").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getByText("ops@safelaunch.app")).toBeVisible();
    expect(within(row as HTMLTableRowElement).getByText("3")).toBeVisible();
    expect(screen.queryByText(/^SL-/)).toBeNull();
  });
});
