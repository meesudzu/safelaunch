import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getScanMock, legacyGetScanMock, scanProgressPropsMock } = vi.hoisted(() => ({
  getScanMock: vi.fn((scanId: string) =>
    Promise.resolve({
      scanId,
      state: "fetching",
      coverage: { fetched: ["homepage"], failed: [], skipped: [] },
    }),
  ),
  legacyGetScanMock: vi.fn((scanId: string) =>
    Promise.resolve({
      scanId,
      state: "fetching",
      coverage: { fetched: ["homepage"], failed: [], skipped: [] },
    }),
  ),
  scanProgressPropsMock: vi.fn(),
}));

vi.mock("../../actions", () => ({ getScan: getScanMock }));

vi.mock("../../../../lib/api-client", () => ({
  createApiClient: () => ({ getScan: legacyGetScanMock }),
}));

vi.mock("../../../../components/scan-progress", () => ({
  ScanProgress: (props: unknown) => {
    scanProgressPropsMock(props);
    return <div data-testid="scan-progress" />;
  },
}));

import ScanPage from "./page";

describe("ScanPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the exported server action across the RSC boundary for polling", async () => {
    const element = await ScanPage({
      params: Promise.resolve({ locale: "vi", scanId: "scan_test" }),
    });

    render(element);

    expect(screen.getByTestId("scan-progress")).toBeInTheDocument();
    expect(getScanMock).toHaveBeenCalledWith("scan_test");

    const props = scanProgressPropsMock.mock.calls[0]?.[0] as { poll?: unknown } | undefined;
    expect(props?.poll).toBe(getScanMock);
  });
});
