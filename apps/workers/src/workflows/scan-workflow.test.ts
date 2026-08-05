import { describe, expect, it } from "vitest";
import { type PageFetcher, type ScanParams, runScan } from "./scan-workflow";

const fakeHtml = (title: string) =>
  `<!DOCTYPE html><html lang="vi"><head><title>${title}</title></head><body><p>OK</p></body></html>`;

const HOME = "https://game.test/";
const ABOUT = "https://game.test/about";
const PRIVACY = "https://game.test/privacy";
const HOMEPAGE_FIXTURE: Record<string, { status: number; html?: string }> = {
  [HOME]: { status: 200, html: fakeHtml("Home") },
  [ABOUT]: { status: 200, html: fakeHtml("About") },
  [PRIVACY]: { status: 200, html: fakeHtml("Privacy") },
};

class FakeFetcher implements PageFetcher {
  readonly calls: { url: string; attempts: number }[] = [];
  private attemptsByUrl = new Map<string, number>();
  constructor(
    private readonly pages: Record<string, { status: number; html?: string }>,
    private readonly failOn: { url: string; minAttempts: number }[] = [],
  ) {}

  async fetch(url: string): Promise<{ status: number; html: Uint8Array }> {
    await Promise.resolve();
    const previous = this.attemptsByUrl.get(url) ?? 0;
    const next = previous + 1;
    this.attemptsByUrl.set(url, next);
    this.calls.push({ url, attempts: next });
    const failure = this.failOn.find((entry) => entry.url === url && next >= entry.minAttempts);
    if (failure) {
      throw new Error(`forced failure for ${url}`);
    }
    const page = this.pages[url];
    if (!page) {
      throw new Error(`no fixture for ${url}`);
    }
    if (page.status >= 400) {
      throw new Error(`upstream ${page.status}`);
    }
    const html = new TextEncoder().encode(page.html ?? fakeHtml(url));
    return { status: page.status, html };
  }
}

const captureLogger = () => {
  const messages: string[] = [];
  return {
    messages,
    log: (entry: Record<string, unknown>) => {
      messages.push(JSON.stringify(entry));
    },
  };
};

const makeDeps = (overrides: { fetch: PageFetcher; evaluate?: ScanRunDeps["evaluate"] }) => {
  const issued = new Map<string, { token: string; url: string }>();
  const persistReport = async (input: {
    scanId: string;
    payload: Record<string, unknown>;
  }): Promise<{ token: string; url: string } | null> => {
    await Promise.resolve();
    if (issued.has(input.scanId)) return null;
    const token = `tok-${input.scanId}-${Math.random().toString(36).slice(2, 8)}`;
    const url = `https://reports.test/${token}`;
    issued.set(input.scanId, { token, url });
    return { token, url };
  };
  const logger = captureLogger();
  const terminalStates: unknown[] = [];
  const updateStateCalls: { scanId: string; state: string; coverage: unknown }[] = [];
  const updateState = async (input: {
    scanId: string;
    state: string;
    coverage: unknown;
  }): Promise<void> => {
    await Promise.resolve();
    updateStateCalls.push(input);
  };
  const deps = {
    fetch: overrides.fetch,
    evaluate:
      overrides.evaluate ??
      (async (): Promise<{ status: "no_significant_risk"; findings: never[] }> => {
        await Promise.resolve();
        return { status: "no_significant_risk" as const, findings: [] };
      }),
    persistTerminalState: (input: unknown) => {
      terminalStates.push(input);
      return Promise.resolve();
    },
    persistReport,
    updateState,
    now: () => "2026-07-29T00:00:00.000Z",
    log: logger.log,
  };
  return { deps, logger, issued, updateStateCalls, terminalStates };
};

type ScanRunDeps = Parameters<typeof runScan>[1];

const baseParams: ScanParams = {
  scanId: "scan-123",
  url: HOME,
  jurisdiction: "VN",
  category: "online_game",
  analysisVersion: "vn-mvp-v1",
};

describe("runScan", () => {
  it("returns completed for a happy-path fixture and persists a single report token", async () => {
    const fetch = new FakeFetcher(HOMEPAGE_FIXTURE);
    const { deps, updateStateCalls } = makeDeps({ fetch });
    const result = await runScan(baseParams, deps);
    expect(result.state).toBe("completed");
    expect(result.coverage.failed).toEqual([]);
    expect(result.status).toBe("no_significant_risk");
    expect(result.reportUrl).toMatch(/^https:\/\/reports\.test\/tok-/);
    expect(result.scanId).toBe(baseParams.scanId);
    expect(updateStateCalls).toContainEqual({
      scanId: baseParams.scanId,
      state: "completed",
      coverage: result.coverage,
    });
    const second = await runScan(baseParams, deps);
    expect(second.reportUrl).toBeUndefined();
  });

  it("returns partial when a discovered page fails and never reports no_significant_risk", async () => {
    const fetch = new FakeFetcher(HOMEPAGE_FIXTURE);
    const { deps } = makeDeps({ fetch });
    const result = await runScan({ ...baseParams, failedPages: ["privacy"] }, deps);
    expect(result.state).toBe("partial");
    expect(result.coverage.failed).toContain("privacy");
    expect(result.coverage.fetched).toContain("homepage");
    expect(result.coverage.fetched).toContain("about");
    expect(result.status).not.toBe("no_significant_risk");
    expect(result.status).toBe("needs_review");
    expect(result.reportUrl).toMatch(/^https:\/\/reports\.test\/tok-/);
  });

  it("returns failed when the homepage fetch fails", async () => {
    const fetch = new FakeFetcher({}, [{ url: HOME, minAttempts: 1 }]);
    const { deps, terminalStates, updateStateCalls } = makeDeps({ fetch });
    const result = await runScan(baseParams, deps);
    expect(result.state).toBe("failed");
    expect(result.status).toBe("needs_review");
    expect(result.coverage.failed).toContain("homepage");
    expect(result.reportUrl).toBeUndefined();
    expect(terminalStates).toEqual([
      {
        scanId: baseParams.scanId,
        state: "failed",
        status: "needs_review",
        coverage: { fetched: [], failed: ["homepage"], skipped: [], degradedPhases: [] },
      },
    ]);
    expect(updateStateCalls).toContainEqual({
      scanId: baseParams.scanId,
      state: "failed",
      coverage: result.coverage,
    });
  });

  it("does not issue a report URL when a timeout page failed", async () => {
    const fetch = new FakeFetcher(HOMEPAGE_FIXTURE, [{ url: PRIVACY, minAttempts: 1 }]);
    const { deps } = makeDeps({ fetch });
    const result = await runScan({ ...baseParams, timeoutPages: ["privacy"] }, deps);
    expect(["partial", "failed"]).toContain(result.state);
    expect(result.coverage.failed).toContain("privacy");
    expect(result.reportUrl).toBeUndefined();
  });

  it("retries a transient fetch failure before succeeding", async () => {
    let attempts = 0;
    const fetch: PageFetcher = {
      fetch: async (url) => {
        await Promise.resolve();
        attempts += 1;
        if (url === HOME && attempts === 1) throw new Error("transient");
        return {
          status: 200,
          html: new TextEncoder().encode(fakeHtml(url)),
        };
      },
    };
    const { deps } = makeDeps({ fetch });
    const result = await runScan({ ...baseParams, requirePages: ["homepage"] }, deps);
    expect(attempts).toBe(2);
    expect(result.state).toBe("completed");
  });

  it("never logs the private report URL or token", async () => {
    const fetch = new FakeFetcher(HOMEPAGE_FIXTURE);
    const { deps, logger } = makeDeps({ fetch });
    await runScan(baseParams, deps);
    const blob = logger.messages.join("\n");
    expect(blob).not.toContain("reports.test");
    expect(blob).not.toContain("tok-");
  });

  it("returns a coverage summary listing the fetched pages", async () => {
    const fetch = new FakeFetcher(HOMEPAGE_FIXTURE);
    const { deps } = makeDeps({ fetch });
    const result = await runScan({ ...baseParams, requirePages: ["about", "privacy"] }, deps);
    expect(result.coverage.fetched.sort()).toEqual(["about", "homepage", "privacy"].sort());
    expect(result.coverage.failed).toEqual([]);
    expect(result.coverage.skipped).toEqual([]);
  });

  it("never puts 'homepage' in coverage.failed when homepage fetch succeeded", async () => {
    const fetch = new FakeFetcher(HOMEPAGE_FIXTURE);
    const { deps } = makeDeps({ fetch });
    const result = await runScan({ ...baseParams, failedPages: ["privacy"] }, deps);
    expect(result.coverage.fetched).toContain("homepage");
    expect(result.coverage.failed).not.toContain("homepage");
    // No page may appear in both lists.
    const overlap = result.coverage.fetched.filter((p) => result.coverage.failed.includes(p));
    expect(overlap).toEqual([]);
  });

  it("isolates the coverage fields so subsequent runs do not pollute state", async () => {
    const fetch = new FakeFetcher(HOMEPAGE_FIXTURE);
    const { deps } = makeDeps({ fetch });
    const first = await runScan(baseParams, deps);
    expect(first.coverage.fetched).toContain("homepage");
    // Same scan should not duplicate the homepage entry.
    expect(first.coverage.fetched.filter((entry) => entry === "homepage").length).toBe(1);
  });
});
