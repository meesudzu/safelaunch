import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the server action so the test doesn't depend on Next.js's server-action
// transport. The factory must not capture top-level variables (vi.mock is
// hoisted), so we create the mock here and re-import it for assertions via
// the resolved module.
const { createScanMock } = vi.hoisted(() => ({
  createScanMock: vi.fn(async () => {
    await Promise.resolve();
    return { scanId: "scan_abc", state: "queued" as const };
  }),
}));
vi.mock("./actions", () => ({ createScan: createScanMock }));

import HomePage from "./page";

const ORIGINAL_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_ORIGIN = "https://api.example.test";
  createScanMock.mockClear();
});

afterEach(() => {
  if (ORIGINAL_ORIGIN === undefined) {
    delete process.env.NEXT_PUBLIC_API_ORIGIN;
  } else {
    process.env.NEXT_PUBLIC_API_ORIGIN = ORIGINAL_ORIGIN;
  }
  vi.restoreAllMocks();
});

describe("HomePage", () => {
  it("wires a server-side createScan so the form does not depend on client-side env inlining", async () => {
    const element = await HomePage({
      params: Promise.resolve({ locale: "vi" }),
    });
    render(element);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("URL website"), "https://example.com");
    await user.selectOptions(screen.getByLabelText("Loại ứng dụng"), "online_game");
    await user.click(screen.getByRole("button", { name: "Kiểm tra website" }));

    expect(createScanMock).toHaveBeenCalledTimes(1);
    expect(createScanMock).toHaveBeenCalledWith({
      url: "https://example.com",
      jurisdiction: "VN",
      category: "online_game",
    });
  });
});
