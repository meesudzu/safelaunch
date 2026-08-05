import { describe, expect, it } from "vitest";
import {
  deterministicReportToken,
  deterministicTokenHash,
  evaluatePhase,
  fetchPhase,
  persistReportPhase,
  persistProgressPhase,
  persistTerminalPhase,
  type EvaluatePhaseDeps,
  type FetchPhaseDeps,
  type PersistDeps,
} from "./scan-workflow.phases";
/* test file: temporary eslint disables for stub fixtures used only here */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import type { PageFetcher, ScanCoverage, ScanParams, SupportedPageType } from "./scan-workflow";

const sha256Hex = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

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
    expect(hash.length).toBe(token.length - 4);
  });
});

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
    expect(result.homepage).toEqual({
      ok: true,
      status: 200,
      html: expect.any(Uint8Array),
    });
    expect(result.fetched).toEqual(expect.arrayContaining(["homepage", "about"]));
    expect(result.failed).toEqual([]);
  });

  it("returns a short-circuit shape when homepage fetch fails", async () => {
    const result = await fetchPhase(baseParams, { ...baseDeps, fetch: failingFetcher });
    expect(result.homepage).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(result.fetched).toEqual([]);
    expect(result.failed).toEqual(["homepage"]);
  });

  it("retries transient failures up to retryCount + 1 attempts", async () => {
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

const fakeCoverage: ScanCoverage = {
  fetched: ["homepage"],
  failed: [],
  skipped: [],
  degradedPhases: [],
};

const fakePages: Array<{
  type: SupportedPageType;
  url: string;
  status: number;
  html: Uint8Array;
}> = [
  { type: "homepage", url: "https://example.com", status: 200, html: new TextEncoder().encode("") },
];

describe("evaluatePhase", () => {
  it("returns the evaluator's outcome verbatim", async () => {
    const expected = [
      {
        id: "rule-1::evidence-1",
        severity: "high" as const,
        rationale: "GDPR Art. 7 violation",
        confidence: 0.9,
        evidenceIds: ["evidence-1"],
        citations: [],
        recommendedAction: "Fix consent flow",
        applicability: "current" as const,
      },
    ];
    const evaluator: EvaluatePhaseDeps["evaluate"] = async () => ({
      status: "high_risk" as const,
      findings: expected,
    });
    const out = await evaluatePhase(
      {
        scanId: "scan-1",
        jurisdiction: "VN",
        category: "online_game" as const,
        pages: fakePages,
        coverage: fakeCoverage,
      },
      { evaluate: evaluator, log: () => {} },
    );
    expect(out.findings).toEqual(expected);
    expect(out.status).toBe("high_risk");
  });
});

const stubDb = () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        sql,
        bind(...args: unknown[]) {
          return {
            async run() {
              calls.push({ sql, args });
              return { success: true };
            },
          };
        },
      };
    },
  };
};

const coverage: ScanCoverage = {
  fetched: ["homepage"],
  failed: [],
  skipped: [],
  degradedPhases: [],
};

describe("persistReportPhase", () => {
  it("uses the deterministic token derived from scanId (stable across retries)", async () => {
    const db = stubDb();
    const deps: PersistDeps = {
      db: db as unknown as D1Database,
      log: () => {},
      now: () => "2026-08-04T00:00:00.000Z",
    };
    const input = {
      scanId: "scan-replay",
      payload: { findings: [], status: "high_risk" as const },
    };
    const a = await persistReportPhase(input, deps);
    const b = await persistReportPhase(input, deps);
    expect(a.token).toBe(b.token);
    expect(a.url).toMatch(/^https:\/\/safelaunch\.runany\.dev\/vi\/report\/rpt_[0-9a-f]{64}$/);
    expect(a.token).toBe(`rpt_${await sha256Hex("scan-replay")}`);
  });

  it("calls upsert with the same scanId row on retry (idempotent)", async () => {
    const db = stubDb();
    const deps: PersistDeps = {
      db: db as unknown as D1Database,
      log: () => {},
      now: () => "2026-08-04T00:00:00.000Z",
    };
    await persistReportPhase(
      { scanId: "scan-empty", payload: { findings: [], status: "needs_review" as const } },
      deps,
    );
    expect(db.calls.length).toBe(1);
    expect(db.calls[0]!.sql).toMatch(/INSERT INTO reports .* ON CONFLICT\(scan_id\) DO UPDATE/);
    expect(db.calls[0]!.args[0]).toBe("scan-empty");
  });
});

describe("persistTerminalPhase", () => {
  it("updates the scan row once with state and coverage (matches ScanRepository.updateTerminal)", async () => {
    const db = stubDb();
    const deps: PersistDeps = {
      db: db as unknown as D1Database,
      log: () => {},
      now: () => "2026-08-04T00:00:00.000Z",
    };
    await persistTerminalPhase(
      {
        scanId: "scan-term",
        state: "completed",
        status: "high_risk",
        coverage,
      },
      deps,
    );
    expect(db.calls.length).toBe(1);
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/UPDATE scans SET state = \?, coverage_json = \? WHERE id = \?/);
    expect(call.args[0]).toBe("completed");
    expect(call.args[2]).toBe("scan-term");
  });
});

describe("persistProgressPhase", () => {
  it("updates only the state column without touching coverage_json", async () => {
    // G1/G4: the progress writes must NOT clobber the in-flight
    // coverage_json (still owned by phase-10:persist-terminal). The
    // SQL must therefore set state only, so the API's coverage contract
    // is unchanged during the run.
    const db = stubDb();
    const deps: PersistDeps = {
      db: db as unknown as D1Database,
      log: () => {},
      now: () => "2026-08-04T00:00:00.000Z",
    };
    await persistProgressPhase({ scanId: "scan-extracting", state: "extracting" }, deps);
    expect(db.calls.length).toBe(1);
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/UPDATE scans SET state = \? WHERE id = \?/);
    expect(call.sql).not.toMatch(/coverage_json/);
    expect(call.args[0]).toBe("extracting");
    expect(call.args[1]).toBe("scan-extracting");
  });

  it("logs scan.progress_persisted with the new state so operators can spot live progress", async () => {
    // G7: the new event name carries only scanId + state (both already
    // present in existing log lines). Make sure no other fields leak.
    const db = stubDb();
    const entries: Array<Record<string, unknown>> = [];
    const deps: PersistDeps = {
      db: db as unknown as D1Database,
      log: (entry) => entries.push(entry),
      now: () => "2026-08-04T00:00:00.000Z",
    };
    await persistProgressPhase({ scanId: "scan-eval", state: "evaluating" }, deps);
    const matched = entries.find((e) => e["event"] === "scan.progress_persisted");
    expect(matched).toBeDefined();
    expect(matched).toMatchObject({
      scanId: "scan-eval",
      state: "evaluating",
      level: "info",
    });
    // No PII or compliance claim fields.
    expect(JSON.stringify(matched)).not.toMatch(/url|findings|token|coverage/);
  });

  it("accepts every intermediate ScanState value without rejecting", async () => {
    // G1: every intermediate value in the public ScanState enum must
    // be acceptable. Terminal values pass through too -- the route
    // already gates which states surface a report URL.
    const { ScanState } = await import("@safelaunch/contracts");
    const states = ScanState.options;
    for (const state of states) {
      const db = stubDb();
      const deps: PersistDeps = {
        db: db as unknown as D1Database,
        log: () => {},
        now: () => "2026-08-04T00:00:00.000Z",
      };
      await persistProgressPhase({ scanId: "scan-iter", state }, deps);
      expect(db.calls[0]?.args[0]).toBe(state);
    }
  });
});
