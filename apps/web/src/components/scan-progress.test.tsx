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

  it("does not crash when coverage is an empty object (server default)", () => {
    // Bug repro: GET /v1/scans/:id returns `coverage: {}` for a fresh scan
    // (DB default `coverage_json = '{}'`). The client must not call
    // `.map()` on undefined sub-fields.
    const incompleteState = {
      scanId: "scan_test",
      state: "queued",
      // Intentionally not conforming to ScanProgressState.coverage — no
      // fetched/failed/skipped keys. Cast to satisfy the type at the call
      // site; the point is that the runtime value is malformed.
      coverage: {},
    } as unknown as ScanProgressState;

    expect(() =>
      render(
        <ScanProgress
          locale="vi"
          messages={messages}
          initialState={incompleteState}
          poll={vi.fn().mockResolvedValue(incompleteState)}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByTestId("progress-state")).toHaveTextContent("Queued");
  });

  it("does not crash when coverage is missing entirely", () => {
    const incompleteState = {
      scanId: "scan_test",
      state: "queued",
    } as unknown as ScanProgressState;

    expect(() =>
      render(
        <ScanProgress
          locale="vi"
          messages={messages}
          initialState={incompleteState}
          poll={vi.fn().mockResolvedValue(incompleteState)}
        />,
      ),
    ).not.toThrow();
  });

  it("does not render the same page in both fetched and failed lists", () => {
    const inconsistentState = {
      scanId: "scan_test",
      state: "completed",
      coverage: {
        fetched: ["homepage", "about"],
        failed: ["homepage", "privacy"],
        skipped: [],
      },
    } satisfies ScanProgressState;
    render(
      <ScanProgress
        locale="vi"
        messages={messages}
        initialState={inconsistentState}
        poll={vi.fn().mockResolvedValue(inconsistentState)}
      />,
    );
    const list = screen.getByTestId("coverage-list");
    // 'homepage' should appear once (in fetched), not twice (in fetched + failed).
    expect(list.textContent?.match(/homepage/g)).toHaveLength(1);
    expect(list.textContent?.includes("! homepage")).toBe(false);
    expect(list.textContent?.includes("✓ homepage")).toBe(true);
    // 'privacy' stays in failed (not in fetched).
    expect(list.textContent?.includes("! privacy")).toBe(true);
  });
});
