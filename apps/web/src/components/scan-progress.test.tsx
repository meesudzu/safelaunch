import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanProgress, type ScanProgressMessages, type ScanProgressState } from "./scan-progress";

const messages: ScanProgressMessages = {
  headline: "Scanning",
  "state.queued": "Queued",
  "state.fetching": "Fetching",
  "state.extracting": "Extracting",
  "state.retrieving": "Retrieving",
  "state.evaluating": "Evaluating",
  "state.reporting": "Reporting",
  "state.completed": "Completed",
  "state.partial": "Partial",
  "state.failed": "Failed",
  "view.report": "View report",
  "view.retrying": "Retrying",
  "expiry.label": "Expires",
};

const progress = (state: string, reportUrl?: string): ScanProgressState => ({
  scanId: "scan_test",
  state,
  coverage: { fetched: [], failed: [], skipped: [] },
  ...(reportUrl ? { reportUrl } : {}),
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ScanProgress", () => {
  it("keeps polling across non-terminal state transitions until the scan completes", async () => {
    vi.useFakeTimers();
    const poll = vi
      .fn<(scanId: string) => Promise<ScanProgressState>>()
      .mockResolvedValueOnce(progress("fetching"))
      .mockResolvedValueOnce(progress("completed", "/vi/report/report-token"));

    render(
      <ScanProgress
        locale="vi"
        messages={messages}
        initialState={progress("queued")}
        poll={poll}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId("progress-state")).toHaveTextContent("Fetching");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(poll).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("progress-state")).toHaveTextContent("Completed");
    expect(screen.getByTestId("view-report-link")).toHaveAttribute(
      "href",
      "/vi/report/report-token",
    );
  });
});
