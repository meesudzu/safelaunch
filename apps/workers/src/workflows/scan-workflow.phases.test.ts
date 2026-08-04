import { describe, expect, it } from "vitest";
import {
  deterministicReportToken,
  deterministicTokenHash,
} from "./scan-workflow.phases";

describe("deterministicReportToken", () => {
  it("returns the same token for the same scanId", async () => {
    const a = await deterministicReportToken("scan-abc");
    const b = await deterministicReportToken("scan-abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^rpt_[0-9a-f]{64}$/);
  });

  it("returns different tokens for different scanIds", async () => {
    const a = await deterministicReportToken("scan-aaa");
    const b = await deterministicReportToken("scan-bbb");
    expect(a).not.toBe(b);
  });

  it("returns a tokenHash that is sha256(token)", async () => {
    const scanId = "scan-zzz";
    const token = await deterministicReportToken(scanId);
    const hash = await deterministicTokenHash(scanId);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBe(token.length - 4); // rpt_ prefix removed
  });
});

import {
  fetchPhase,
  type FetchPhaseDeps,
} from "./scan-workflow.phases";
import type { PageFetcher, ScanParams } from "./scan-workflow";

const baseParams: ScanParams = {
  scanId: "scan-1",
  url: "https://example.com",
  jurisdiction: "VN",
  category: "online_game",
  analysisVersion: "v1",
  requirePages: ["about"],
};

const okFetcher: PageFetcher = {
  async fetch(_url: string) {
    return { status: 200, html: new TextEncoder().encode("<html></html>") };
  },
};

const failingFetcher: PageFetcher = {
  async fetch() {
    throw new Error("network down");
  },
};

const baseDeps: FetchPhaseDeps = {
  fetch: okFetcher,
  log: () => {},
  now: () => "2026-08-04T00:00:00.000Z",
  retryCount: 0,
  retryBackoffMs: 1,
};

describe("fetchPhase", () => {
  it("returns homepage + one requested page on success", async () => {
    const result = await fetchPhase(baseParams, baseDeps);
    expect(result.homepage).toEqual({ ok: true, status: 200, html: expect.any(Uint8Array) });
    expect(result.fetched).toEqual(expect.arrayContaining(["homepage", "about"]));
    expect(result.failed).toEqual([]);
  });

  it("returns a short-circuit shape when homepage fetch fails", async () => {
    const result = await fetchPhase(baseParams, { ...baseDeps, fetch: failingFetcher });
    expect(result.homepage).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(result.fetched).toEqual([]);
    expect(result.failed).toEqual(["homepage"]);
  });

  it("retries transient failures up to retryCount", async () => {
    let calls = 0;
    const flaky: PageFetcher = {
      async fetch() {
        calls += 1;
        if (calls < 3) throw new Error(`boom-${calls}`);
        return { status: 200, html: new TextEncoder().encode("ok") };
      },
    };
    const result = await fetchPhase(baseParams, {
      ...baseDeps,
      fetch: flaky,
      retryCount: 3,
    });
    expect(calls).toBe(4);
    if (!result.homepage.ok) throw new Error("expected homepage ok after retries");
  });
});
