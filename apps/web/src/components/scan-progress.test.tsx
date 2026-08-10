import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanProgress, type ScanProgressMessages, type ScanProgressState } from "./scan-progress";

const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const messages: ScanProgressMessages = {
  headline: "Scanning",
  "headline.scanning": "Scanning website — step {current} / {total}",
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
  "expiry.label": "Expires",
  "steps.title": "Scan steps",
  "steps.subtitle": "Step {current} / {total}",
  "step.queued.label": "Queued",
  "step.queued.description": "Waiting",
  "step.fetching.label": "Fetching",
  "step.fetching.description": "Reading URLs",
  "step.extracting.label": "Extracting",
  "step.extracting.description": "Pulling out content",
  "step.retrieving.label": "Retrieving",
  "step.retrieving.description": "Looking up provisions",
  "step.evaluating.label": "Evaluating",
  "step.evaluating.description": "Matching evidence",
  "step.reporting.label": "Reporting",
  "step.reporting.description": "Composing report",
};

const progress = (state: string, reportUrl?: string): ScanProgressState => ({
  scanId: "scan_test",
  state,
  coverage: { fetched: [], failed: [], skipped: [] },
  ...(reportUrl ? { reportUrl } : {}),
});

afterEach(() => {
  pushMock.mockClear();
  replaceMock.mockClear();
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

  it("opts the report link out of Cloudflare Speed Brain prefetch", () => {
    // Regression: Cloudflare Speed Brain (configured at
    // /cdn-cgi/speculation with href_matches:"/*" and conservative
    // eagerness) prefetches any same-origin link on hover/viewport.
    // Keeping the opt-out avoids pulling in the full report HTML on
    // hover, which would be wasteful for the heavy compliance view.
    // The documented opt-out for Cloudflare Speed Brain is the
    // data-cf-no-prefetch attribute on the <a> element.
    const terminal = progress("completed", "/vi/report/report-token");
    render(
      <ScanProgress
        locale="vi"
        messages={messages}
        initialState={terminal}
        poll={vi.fn().mockResolvedValue(terminal)}
      />,
    );
    const link = screen.getByTestId("view-report-link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("data-cf-no-prefetch");
  });

  it("updates the aria-live announcement and the stepper when the state advances", async () => {
    vi.useFakeTimers();
    const poll = vi
      .fn<(scanId: string) => Promise<ScanProgressState>>()
      .mockResolvedValueOnce(progress("fetching"))
      .mockResolvedValueOnce(progress("evaluating"));

    render(
      <ScanProgress
        locale="vi"
        messages={messages}
        initialState={progress("queued")}
        poll={poll}
      />,
    );

    // First tick: state -> fetching.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const live = screen.getByTestId("progress-state");
    expect(live).toHaveTextContent("Fetching");
    expect(live).toHaveAttribute("aria-live", "polite");
    // Stepper: queued row should now show the completed marker, fetching
    // row should be the only aria-current="step".
    const stepperList = screen.getByRole("list", { name: /scan steps/i });
    const activeAfterFirst = stepperList.querySelectorAll<HTMLElement>("[aria-current='step']");
    expect(activeAfterFirst).toHaveLength(1);
    expect(activeAfterFirst[0]?.textContent).toContain("Fetching");

    // Second tick: state -> evaluating.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId("progress-state")).toHaveTextContent("Evaluating");
    const activeAfterSecond = screen
      .getByRole("list", { name: /scan steps/i })
      .querySelectorAll<HTMLElement>("[aria-current='step']");
    expect(activeAfterSecond).toHaveLength(1);
    expect(activeAfterSecond[0]?.textContent).toContain("Evaluating");
  });

  it("renders the dynamic scanning headline with step N / 6 for non-terminal states", () => {
    render(
      <ScanProgress
        locale="vi"
        messages={messages}
        initialState={progress("retrieving")}
        poll={vi.fn().mockResolvedValue(progress("retrieving"))}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Scanning website — step 5 / 6");
  });

  it("renders the terminal headline instead of the scanning one when the scan completes", () => {
    render(
      <ScanProgress
        locale="vi"
        messages={messages}
        initialState={progress("completed", "/vi/report/r1")}
        poll={vi.fn().mockResolvedValue(progress("completed"))}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Completed");
  });

  it("hides the expiry line while the scan is still in progress", () => {
    render(
      <ScanProgress
        locale="vi"
        messages={messages}
        initialState={{ ...progress("fetching"), expiresAt: "2026-08-05T10:30:00Z" }}
        poll={vi.fn().mockResolvedValue(progress("fetching"))}
      />,
    );
    expect(screen.queryByTestId("progress-expiry")).toBeNull();
  });

  it("renders the localised expiry line when the scan reaches a terminal state", () => {
    render(
      <ScanProgress
        locale="vi"
        messages={messages}
        initialState={{
          ...progress("completed", "/vi/report/r2"),
          expiresAt: "2026-08-05T10:30:00Z",
        }}
        poll={vi.fn().mockResolvedValue(progress("completed"))}
      />,
    );
    const expiry = screen.getByTestId("progress-expiry");
    expect(expiry).toHaveTextContent(/Expires/i);
    // ISO string should be replaced by an Intl.DateTimeFormat value, not the
    // raw ISO shape that backend hands us.
    expect(expiry.textContent ?? "").not.toContain("2026-08-05T10:30:00Z");
  });

  describe("auto-redirect after terminal state", () => {
    it("redirects to the report URL ~1.5s after reaching a terminal state with a reportUrl", async () => {
      vi.useFakeTimers();
      const reportUrl = "/vi/report/auto-redirect-token";
      // First poll @t≈1000 -> fetching. Second poll @t≈2000 -> completed
      // (terminal with reportUrl). The auto-redirect useEffect schedules
      // router.push at terminal_time + 1500ms.
      const poll = vi
        .fn<(scanId: string) => Promise<ScanProgressState>>()
        .mockResolvedValueOnce(progress("fetching"))
        .mockResolvedValueOnce(progress("completed", reportUrl));

      render(
        <ScanProgress
          locale="vi"
          messages={messages}
          initialState={progress("queued")}
          poll={poll}
        />,
      );

      // Land in terminal state. With fake timers the queued->fetching
      // poll resolves at t≈1000, the fetching->completed poll at t≈2000.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      // Right after terminal: redirect window (1.5s) not yet elapsed.
      expect(pushMock).not.toHaveBeenCalled();

      // Advance 1.4s -- still inside the 1.5s window. Nothing should fire.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400);
      });
      expect(pushMock).not.toHaveBeenCalled();

      // Cross the 1.5s threshold (now t ≈ 3400, past the t=3500 window).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith(reportUrl);
    });

    it("does not redirect when the terminal state has no reportUrl (e.g. failed)", async () => {
      vi.useFakeTimers();
      const poll = vi
        .fn<(scanId: string) => Promise<ScanProgressState>>()
        .mockResolvedValueOnce(progress("failed"));

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
      // Advance well past the 1.5s redirect window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(pushMock).not.toHaveBeenCalled();
    });

    it("does not redirect while the scan is still running", async () => {
      vi.useFakeTimers();
      const poll = vi
        .fn<(scanId: string) => Promise<ScanProgressState>>()
        .mockResolvedValue(progress("fetching"));

      render(
        <ScanProgress
          locale="vi"
          messages={messages}
          initialState={progress("queued")}
          poll={poll}
        />,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(pushMock).not.toHaveBeenCalled();
    });

    it("still renders the manual report link while auto-redirect is pending", async () => {
      vi.useFakeTimers();
      const reportUrl = "/vi/report/manual-link-token";
      const poll = vi
        .fn<(scanId: string) => Promise<ScanProgressState>>()
        .mockResolvedValueOnce(progress("completed", reportUrl));

      render(
        <ScanProgress
          locale="vi"
          messages={messages}
          initialState={progress("queued")}
          poll={poll}
        />,
      );

      // Reach terminal, but stay inside the redirect window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      const link = screen.getByTestId("view-report-link");
      expect(link).toHaveAttribute("href", reportUrl);
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("does not redirect twice if the state updates again with the same reportUrl", async () => {
      vi.useFakeTimers();
      const reportUrl = "/vi/report/dedup-token";
      // Two terminal polls in a row with the same URL should still only
      // fire router.push once.
      const poll = vi
        .fn<(scanId: string) => Promise<ScanProgressState>>()
        .mockResolvedValueOnce(progress("completed", reportUrl))
        .mockResolvedValueOnce(progress("completed", reportUrl));

      render(
        <ScanProgress
          locale="vi"
          messages={messages}
          initialState={progress("queued")}
          poll={poll}
        />,
      );

      // First terminal state.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      // Past the redirect window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      // Second terminal poll (same URL).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      // Past another redirect window — should still be only one push.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith(reportUrl);
    });
  });
});
