import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanProgress, type ScanProgressMessages, type ScanProgressState } from "./scan-progress";

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
  "coverage.title": "Scanned pages",
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
    // For a single-use report URL that prefetch runs the Next.js
    // server component, which calls the API and burns the token
    // before the user actually clicks - so a later direct open of
    // the same URL returns 404 REPORT_NOT_FOUND. The documented
    // opt-out for Cloudflare Speed Brain is the data-cf-no-prefetch
    // attribute on the <a> element.
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

  it("does not crash when coverage is an empty object (server default)", () => {
    // Bug repro: GET /v1/scans/:id returns `coverage: {}` for a fresh scan
    // (DB default `coverage_json = '{}'`). The client must not call
    // `.map()` on undefined sub-fields.
    const incompleteState = {
      scanId: "scan_test",
      state: "queued",
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
    expect(list.textContent?.match(/homepage/g)).toHaveLength(1);
    expect(list.textContent?.includes("! homepage")).toBe(false);
    expect(list.textContent?.includes("✓ homepage")).toBe(true);
    expect(list.textContent?.includes("! privacy")).toBe(true);
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
    expect(heading).toHaveTextContent("Scanning website — step 4 / 6");
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

  it("renders the coverage heading above the URL list", () => {
    render(
      <ScanProgress
        locale="vi"
        messages={messages}
        initialState={{
          ...progress("fetching"),
          coverage: { fetched: ["/about"], failed: [], skipped: [] },
        }}
        poll={vi.fn().mockResolvedValue(progress("fetching"))}
      />,
    );
    expect(screen.getByRole("heading", { name: messages["coverage.title"] })).toBeInTheDocument();
  });
});
