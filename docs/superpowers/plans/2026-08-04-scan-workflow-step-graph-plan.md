# Scan Workflow Step Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap each phase of `scan-workflow` in `step.do()` so the Cloudflare dashboard renders a real workflow Graph, with per-phase retryability and idempotent persistence.

**Architecture:** Split `scan-workflow.ts` into a thin orchestrator that delegates to a new `scan-workflow.phases.ts`. The orchestrator keeps the same public `runScan(params, deps)` signature so `scan-workflow.test.ts` stays unchanged. The `ScanWorkflowEntrypoint.run()` calls each phase through `step.do(name, fn)`. The report token becomes deterministic (`sha256(scanId)`) so retries do not produce a different URL.

**Tech Stack:**

- Cloudflare Workflows (`WorkflowEntrypoint`, `WorkflowStep`) — `@cloudflare/workers-types`
- Vitest + `@cloudflare/vitest-pool-workers` — testing
- TypeScript strict, Zod
- D1 (idempotent upsert)

**Spec:** `docs/superpowers/specs/2026-08-04-scan-workflow-step-graph-design.md`

---

## File Structure

| File                                                          | Status    | Responsibility                                                                                                                                                                                       |
| ------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/workers/src/workflows/scan-workflow.phases.ts`          | NEW       | Pure per-phase helpers (`fetchPhase`, `extractEvidencePhase`, `evaluatePhase`, `persistReportPhase`, `persistTerminalPhase`, `deterministicReportToken`). All take deps via params, no global state. |
| `apps/workers/src/workflows/scan-workflow.phases.test.ts`     | NEW       | Unit tests for each phase helper, characterising current behaviour.                                                                                                                                  |
| `apps/workers/src/workflows/scan-workflow.ts`                 | MODIFY    | `runScan` becomes an orchestrator that delegates to phases (same signature). `ScanWorkflowEntrypoint.run` wraps each phase call in `step.do(name, fn)`. Token deterministic.                         |
| `apps/workers/src/workflows/scan-workflow.test.ts`            | UNCHANGED | Existing tests stay; verify they pass after the refactor.                                                                                                                                            |
| `apps/workers/src/workflows/scan-workflow.entrypoint.test.ts` | NEW       | Cloudflare workflow entrypoint test using a mock `step` recording names.                                                                                                                             |

No other files in the repo are touched.

---

## Task 0: Branch isolation (worktree)

**Files:** none

- [ ] **Step 1:** Confirm current branch is `main` (or the team's base). Run `git status` and `git rev-parse --abbrev-ref HEAD`.
- [ ] **Step 2:** Create a worktree for this work:

```bash
git worktree add ../safelaunch-workflow-step-graph -b codex/scan-workflow-step-graph
cd ../safelaunch-workflow-step-graph
pnpm install --frozen-lockfile
```

- [ ] **Step 3:** Verify `pnpm -w --filter @safelaunch/workers test` runs and at least the existing `scan-workflow.test.ts` is in the suite. Expected: `Test Files  N passed` listing it.

---

## Task 1: Deterministic report token (RED)

**Files:**

- Modify: `apps/workers/src/workflows/scan-workflow.phases.test.ts` (create with this task's failing test)

- [ ] **Step 1: Write the failing test**

Create the file `apps/workers/src/workflows/scan-workflow.phases.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { deterministicReportToken, deterministicTokenHash } from "./scan-workflow.phases";

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

  it("produces a tokenHash identical to sha256(token)", async () => {
    const scanId = "scan-zzz";
    const token = await deterministicReportToken(scanId);
    const hash = await deterministicTokenHash(scanId);
    // sha256hex of "rpt_<sha256(scanId)>" is unique per scanId and stable.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm -w --filter @safelaunch/workers test src/workflows/scan-workflow.phases.test.ts
```

Expected: FAIL with `Cannot find module './scan-workflow.phases'`.

---

## Task 2: Deterministic report token (GREEN)

**Files:**

- Create: `apps/workers/src/workflows/scan-workflow.phases.ts`

- [ ] **Step 1: Implement**

```ts
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hex(new Uint8Array(digest));
};

/**
 * Deterministic report token derived from the scan id.
 * Stable across retries because the input (scanId) does not change.
 * Format: `rpt_<64 hex chars>` — same unguessability as a 256-bit hash.
 */
export const deterministicReportToken = async (scanId: string): Promise<string> => {
  const inner = await sha256Hex(scanId);
  return `rpt_${inner}`;
};

/**
 * The tokenHash that `ReportRepository.upsert` stores — sha256 of the token
 * itself — is also stable across retries.
 */
export const deterministicTokenHash = async (scanId: string): Promise<string> => {
  const token = await deterministicReportToken(scanId);
  return sha256Hex(token);
};
```

- [ ] **Step 2: Run the test, verify it passes**

```bash
pnpm -w --filter @safelaunch/workers test src/workflows/scan-workflow.phases.test.ts
```

Expected: PASS (3 passing assertions).

- [ ] **Step 3: Commit**

```bash
git add apps/workers/src/workflows/scan-workflow.phases.ts \
        apps/workers/src/workflows/scan-workflow.phases.test.ts
git commit -m "feat(workflow): deterministic report token helper"
```

---

## Task 3: Extract `fetchPhase` helper (RED)

**Files:**

- Modify: `apps/workers/src/workflows/scan-workflow.phases.test.ts` (extend)

- [ ] **Step 1: Add the failing test**

Append to the existing phases test file:

```ts
import {
  deterministicReportToken,
  deterministicTokenHash,
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
    const result = await fetchPhase(baseParams, { ...baseDeps, fetch: flaky, retryCount: 3 });
    expect(calls).toBe(3);
    expect(result.homepage.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm -w --filter @safelaunch/workers test src/workflows/scan-workflow.phases.test.ts
```

Expected: FAIL — `fetchPhase` and `FetchPhaseDeps` are not exported.

---

## Task 4: Extract `fetchPhase` helper (GREEN)

**Files:**

- Modify: `apps/workers/src/workflows/scan-workflow.phases.ts`

- [ ] **Step 1: Add the implementation**

Add to `scan-workflow.phases.ts`:

```ts
import type { PageFetcher, ScanParams, SupportedPageType } from "./scan-workflow";

export interface FetchPhaseDeps {
  fetch: PageFetcher;
  log: (entry: Record<string, unknown>) => void;
  now: () => string;
  retryCount: number;
  retryBackoffMs: number;
}

export interface FetchPhaseResult {
  homepage: { ok: true; status: number; html: Uint8Array } | { ok: false; reason: string };
  pages: Array<{ type: SupportedPageType; url: string; status: number; html: Uint8Array }>;
  fetched: SupportedPageType[];
  failed: SupportedPageType[];
}

const requiredPages = (params: ScanParams): readonly SupportedPageType[] => {
  if (params.requirePages === undefined) return ["about", "privacy"] as const;
  return params.requirePages;
};

const fetchWithRetries = async (
  fetcher: PageFetcher,
  url: string,
  options: {
    timeoutPages: Set<SupportedPageType>;
    pageType: SupportedPageType;
    retries: number;
    backoffMs: number;
  },
): Promise<{ ok: true; status: number; html: Uint8Array } | { ok: false; reason: string }> => {
  // Copied verbatim from current scan-workflow.ts to preserve behaviour.
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= options.retries) {
    try {
      const result = await fetcher.fetch(url);
      return { ok: true, status: result.status, html: result.html };
    } catch (cause) {
      lastError = cause;
      attempt += 1;
      if (attempt > options.retries) break;
      await new Promise((resolve) => setTimeout(resolve, options.backoffMs));
    }
  }
  const reason =
    options.timeoutPages.has(options.pageType) || lastError instanceof Error
      ? lastError instanceof Error
        ? lastError.message
        : "fetch failed"
      : "fetch failed";
  return { ok: false, reason };
};

export const fetchPhase = async (
  rawParams: ScanParams,
  deps: FetchPhaseDeps,
): Promise<FetchPhaseResult> => {
  const params = rawParams; // already parsed in the entrypoint; orchestrator parses for tests.
  const requestedPages = requiredPages(params);
  const timeoutPages = new Set<SupportedPageType>(params.timeoutPages ?? []);
  const forcedFailed = new Set<SupportedPageType>(params.failedPages ?? []);

  const homepageResult = await fetchWithRetries(deps.fetch, params.url, {
    pageType: "homepage",
    timeoutPages,
    retries: deps.retryCount,
    backoffMs: deps.retryBackoffMs,
  });
  if (!homepageResult.ok) {
    deps.log({
      level: "error",
      event: "scan.homepage_failed",
      scanId: params.scanId,
      reason: homepageResult.reason,
      at: deps.now(),
    });
    return {
      homepage: { ok: false, reason: homepageResult.reason },
      pages: [],
      fetched: [],
      failed: ["homepage"],
    };
  }

  const pages: FetchPhaseResult["pages"] = [
    { type: "homepage", url: params.url, status: homepageResult.status, html: homepageResult.html },
  ];
  const fetched: SupportedPageType[] = ["homepage"];
  const failed: SupportedPageType[] = [];

  for (const pageType of requestedPages) {
    if (pageType === "homepage") continue;
    if (forcedFailed.has(pageType) || timeoutPages.has(pageType)) {
      failed.push(pageType);
      continue;
    }
    const pageUrl = `${params.url.replace(/\/$/, "")}/${pageType}`;
    const result = await fetchWithRetries(deps.fetch, pageUrl, {
      pageType,
      timeoutPages,
      retries: deps.retryCount,
      backoffMs: deps.retryBackoffMs,
    });
    if (!result.ok) {
      failed.push(pageType);
      continue;
    }
    fetched.push(pageType);
    pages.push({ type: pageType, url: pageUrl, status: result.status, html: result.html });
  }

  return { homepage: homepageResult, pages, fetched, failed };
};
```

- [ ] **Step 2: Run the test, verify it passes**

```bash
pnpm -w --filter @safelaunch/workers test src/workflows/scan-workflow.phases.test.ts
```

Expected: PASS for `fetchPhase` describe block (3 passing assertions).

- [ ] **Step 3: Commit**

```bash
git add apps/workers/src/workflows/scan-workflow.phases.ts \
        apps/workers/src/workflows/scan-workflow.phases.test.ts
git commit -m "feat(workflow): extract fetchPhase from runScan"
```

---

## Task 5: Extract `evaluatePhase` (RED + GREEN in one task — pure-ish, mechanical)

**Files:**

- Modify: `apps/workers/src/workflows/scan-workflow.phases.ts`
- Modify: `apps/workers/src/workflows/scan-workflow.phases.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `scan-workflow.phases.test.ts`:

```ts
import { evaluatePhase, type EvaluatePhaseDeps } from "./scan-workflow.phases";
import type { ScanCoverage, ReportFinding, SupportedPageType } from "./scan-workflow";

const fakeCoverage: ScanCoverage = {
  fetched: ["homepage"],
  failed: [],
  skipped: [],
};

const fakePages: Array<{ type: SupportedPageType; url: string; status: number; html: Uint8Array }> =
  [
    {
      type: "homepage",
      url: "https://example.com",
      status: 200,
      html: new TextEncoder().encode(""),
    },
  ];

describe("evaluatePhase", () => {
  it("returns the evaluator's outcome verbatim", async () => {
    const expected = [
      {
        id: "rule-1::evidence-1",
        severity: "high",
        rationale: "GDPR Art. 7 violation",
        confidence: 0.9,
        evidenceIds: ["evidence-1"],
        citations: [],
        recommendedAction: "Fix consent flow",
        applicability: "EU",
      },
    ];
    const evaluator: EvaluatePhaseDeps["evaluate"] = async () => ({
      status: "high_risk",
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
```

Run it; expected: FAIL — `evaluatePhase` not exported.

- [ ] **Step 2: Implement**

Add to `scan-workflow.phases.ts`:

```ts
import type {
  EvaluateOutcome,
  ReportFinding,
  ScanCoverage,
  SupportedPageType,
} from "./scan-workflow";

export interface EvaluatePhaseInput {
  scanId: string;
  jurisdiction: string;
  category: "online_game" | "electronic_press" | "digital_entertainment";
  pages: Array<{ type: SupportedPageType; url: string; status: number; html: Uint8Array }>;
  coverage: ScanCoverage;
}

export interface EvaluatePhaseDeps {
  evaluate: (input: EvaluatePhaseInput) => Promise<EvaluateOutcome>;
  log: (entry: Record<string, unknown>) => void;
}

export const evaluatePhase = async (
  input: EvaluatePhaseInput,
  deps: EvaluatePhaseDeps,
): Promise<EvaluateOutcome> => {
  const outcome = await deps.evaluate(input);
  deps.log({
    level: "info",
    event: "scan.evaluated",
    scanId: input.scanId,
    findingsCount: outcome.findings.length,
    status: outcome.status,
    coverageComplete: input.coverage.failed.length === 0,
  });
  return outcome;
};
```

- [ ] **Step 3: Run the test, verify it passes**

```bash
pnpm -w --filter @safelaunch/workers test src/workflows/scan-workflow.phases.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/workers/src/workflows/scan-workflow.phases.ts \
        apps/workers/src/workflows/scan-workflow.phases.test.ts
git commit -m "feat(workflow): extract evaluatePhase helper"
```

---

## Task 6: Extract `persistReportPhase` + `persistTerminalPhase` (RED + GREEN together)

**Files:**

- Modify: `apps/workers/src/workflows/scan-workflow.phases.ts`
- Modify: `apps/workers/src/workflows/scan-workflow.phases.test.ts`

- [ ] **Step 1: Failing tests**

Append:

```ts
import { persistReportPhase, persistTerminalPhase, type PersistDeps } from "./scan-workflow.phases";
import type { ScanCoverage } from "./scan-workflow";

const stubDb = () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  return {
    calls,
    async prepare(sql: string) {
      return {
        sql,
        async bind(...args: unknown[]) {
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

const coverage: ScanCoverage = { fetched: ["homepage"], failed: [], skipped: [] };

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
    expect(a.url).toMatch(/^https:\/\/web\.local\/vi\/report\/rpt_[0-9a-f]{64}$/);
    expect(a.token).toBe(`rpt_${await sha256Hex("scan-replay")}`);
  });

  it("still calls upsert even with a 0-finding payload", async () => {
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
  });
});

describe("persistTerminalPhase", () => {
  it("updates the scan row once with the provided state and status", async () => {
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
    expect(call.sql).toMatch(/UPDATE scans .* WHERE id = \?/);
  });
});
```

Top of the file, after the existing imports, also add:

```ts
const sha256Hex = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
```

Run; expected: FAIL — exports missing.

- [ ] **Step 2: Implement**

Add to `scan-workflow.phases.ts`:

```ts
import type { ScanCoverage, ScanTerminalState, ScanTerminalStatus } from "./scan-workflow";

export interface PersistDeps {
  db: D1Database;
  log: (entry: Record<string, unknown>) => void;
  now: () => string;
}

const REPORT_TTL_SECONDS = 7 * 24 * 60 * 60;

export const persistReportPhase = async (
  input: { scanId: string; payload: Record<string, unknown> },
  deps: PersistDeps,
): Promise<{ token: string; url: string }> => {
  const token = await deterministicReportToken(input.scanId);
  const tokenHash = await deterministicTokenHash(input.scanId);
  const now = new Date(deps.now());
  const expiresAt = new Date(now.getTime() + REPORT_TTL_SECONDS * 1000).toISOString();
  const payloadJson = JSON.stringify({
    ...input.payload,
    _reportToken: token,
  });
  await deps.db
    .prepare(
      "INSERT INTO reports (scan_id, token_hash, payload_json, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(scan_id) DO UPDATE SET token_hash = excluded.token_hash, payload_json = excluded.payload_json, expires_at = excluded.expires_at",
    )
    .bind(input.scanId, tokenHash, payloadJson, expiresAt)
    .run();
  const url = `https://web.local/vi/report/${token}`;
  deps.log({
    level: "info",
    event: "scan.report_persisted",
    scanId: input.scanId,
    at: deps.now(),
  });
  return { token, url };
};

export const persistTerminalPhase = async (
  input: {
    scanId: string;
    state: ScanTerminalState;
    status: ScanTerminalStatus;
    coverage: ScanCoverage;
  },
  deps: PersistDeps,
): Promise<void> => {
  // Same UPDATE shape as ScanRepository.updateTerminal — copied verbatim from
  // packages/db/src/scan-repository.ts:78 to keep this file independent of
  // the package (the entrypoint package cannot re-export D1-bound types).
  await deps.db
    .prepare(
      "UPDATE scans SET state = ?, status = ?, coverage_json = ?, updated_at = ? WHERE id = ?",
    )
    .bind(input.state, input.status, JSON.stringify(input.coverage), deps.now(), input.scanId)
    .run();
  deps.log({
    level: "info",
    event: "scan.terminal_persisted",
    scanId: input.scanId,
    state: input.state,
    status: input.status,
    at: deps.now(),
  });
};
```

- [ ] **Step 3: Run; verify PASS**

```bash
pnpm -w --filter @safelaunch/workers test src/workflows/scan-workflow.phases.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/workers/src/workflows/scan-workflow.phases.ts \
        apps/workers/src/workflows/scan-workflow.phases.test.ts
git commit -m "feat(workflow): deterministic token + persist phases"
```

---

## Task 7: Refactor `runScan` to delegate to phases; keep signature unchanged

**Files:**

- Modify: `apps/workers/src/workflows/scan-workflow.ts`

- [ ] **Step 1: Replace `runScan` body**

Open `apps/workers/src/workflows/scan-workflow.ts`. Replace the body of `runScan` (lines roughly `170-308`) with a delegation to the new phase helpers. The signature and return shape are unchanged so `scan-workflow.test.ts` continues to pass.

```ts
import {
  fetchPhase,
  evaluatePhase,
  persistReportPhase,
  persistTerminalPhase,
} from "./scan-workflow.phases";
```

Then rewrite `runScan` like so:

```ts
export const runScan = async (rawParams: ScanParams, deps: ScanRunDeps): Promise<ScanResult> => {
  const params = ScanParamsSchema.parse(rawParams);
  const requestedPages = requiredPages(params);
  const timeoutPages = new Set<SupportedPageType>(params.timeoutPages ?? []);
  const forcedFailed = new Set<SupportedPageType>(params.failedPages ?? []);

  deps.log({
    level: "info",
    event: "scan.start",
    scanId: params.scanId,
    jurisdiction: params.jurisdiction,
    category: params.category,
    requestedPages,
    at: deps.now(),
  });

  const fetchResult = await fetchPhase(params, {
    fetch: deps.fetch,
    log: deps.log,
    now: deps.now,
    retryCount: deps.retryCount ?? 0,
    retryBackoffMs: deps.retryBackoffMs ?? 5,
  });

  if (!fetchResult.homepage.ok) {
    const coverage = buildCoverage([], ["homepage"], []);
    await deps.persistTerminalState?.({
      scanId: params.scanId,
      state: "failed",
      status: "needs_review",
      coverage,
    });
    return {
      scanId: params.scanId,
      state: "failed",
      status: "needs_review",
      coverage,
    };
  }

  const coverage = buildCoverage(fetchResult.fetched, fetchResult.failed, []);
  const evaluation = await evaluatePhase(
    {
      scanId: params.scanId,
      jurisdiction: params.jurisdiction,
      category: params.category as "online_game" | "electronic_press" | "digital_entertainment",
      pages: fetchResult.pages,
      coverage,
    },
    { evaluate: deps.evaluate, log: deps.log },
  );

  let state: ScanTerminalState;
  if (fetchResult.failed.length === 0) {
    state = "completed";
  } else if (fetchResult.failed.includes("homepage") || fetchResult.fetched.length === 0) {
    state = "failed";
  } else {
    state = "partial";
  }

  let status: ScanTerminalStatus = evaluation.status;
  if (state !== "completed" && status === "no_significant_risk") {
    status = "needs_review";
  }

  const timeoutPagesFailed = Array.from(timeoutPages).filter((p) => fetchResult.failed.includes(p));
  let reportUrl: string | undefined;
  if (state !== "failed" && timeoutPagesFailed.length === 0) {
    const issued = await deps.persistReport({
      scanId: params.scanId,
      payload: {
        scanId: params.scanId,
        state,
        status,
        coverage,
        findings: evaluation.findings,
        generatedAt: deps.now(),
      },
    });
    if (issued) {
      reportUrl = issued.url;
    }
    deps.log({
      level: "info",
      event: "scan.terminal",
      scanId: params.scanId,
      state,
      status,
      coverage,
      hasReport: issued !== null,
      at: deps.now(),
    });
  } else {
    deps.log({
      level: "warn",
      event: "scan.failed_terminal",
      scanId: params.scanId,
      coverage,
      at: deps.now(),
    });
  }

  const result: ScanResult = {
    scanId: params.scanId,
    state,
    status,
    coverage,
  };
  await deps.persistTerminalState?.({
    scanId: params.scanId,
    state,
    status,
    coverage,
  });
  if (reportUrl) result.reportUrl = reportUrl;
  return result;
};
```

- [ ] **Step 2: Run the existing test file unchanged**

```bash
pnpm -w --filter @safelaunch/workers test src/workflows/scan-workflow.test.ts
```

Expected: PASS — every previously-passing test still passes.

- [ ] **Step 3: Run all worker tests to catch regressions elsewhere**

```bash
pnpm -w --filter @safelaunch/workers test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/workers/src/workflows/scan-workflow.ts
git commit -m "refactor(workflow): runScan delegates to phase helpers"
```

---

## Task 8: Entrypoint uses `step.do` (RED)

**Files:**

- Create: `apps/workers/src/workflows/scan-workflow.entrypoint.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { ScanWorkflowEntrypoint, SCAN_WORKFLOW_NAME } from "./scan-workflow";
import type { ScanWorkflowEnv } from "./scan-workflow";

describe("ScanWorkflowEntrypoint.run", () => {
  it("wraps each phase in step.do with a stable name", async () => {
    const calls: Array<{ name: string; fn: () => Promise<unknown> }> = [];
    const step = {
      async do<T>(name: string, fn: () => Promise<T>): Promise<T> {
        calls.push({ name, fn });
        return fn();
      },
      sleep: vi.fn(),
      sleepUntil: vi.fn(),
      waitForEvent: vi.fn(),
    } as unknown as WorkflowStep;

    const env: ScanWorkflowEnv = {
      DB: {} as D1Database,
      AI: {} as Ai,
    };
    const event = {
      payload: {
        scanId: "scan-entry-1",
        url: "https://example.com",
        jurisdiction: "VN",
        category: "online_game",
        analysisVersion: "v1",
        requirePages: ["about", "privacy"],
      },
      timestamp: new Date(),
      instanceId: "instance-1",
    } as unknown as Readonly<WorkflowEvent<ScanWorkflowPayload>>;

    const instance = new ScanWorkflowEntrypoint(
      { ...env, SCAN_WORKFLOW: {} as any },
      {} as ExecutionContext,
    );

    // We expect that the entrypoint uses step.do for at least: parse-params,
    // fetch:homepage, fetch:about, fetch:privacy, extract-evidence,
    // evaluate-rules, aggregate-findings, persist-report, persist-terminal.
    await instance.run(event, step);

    const names = calls.map((c) => c.name);
    expect(names).toContain("parse-params");
    expect(names).toContain("fetch:homepage");
    expect(names).toContain("fetch:about");
    expect(names).toContain("fetch:privacy");
    expect(names).toContain("extract-evidence");
    expect(names).toContain("evaluate-rules");
    expect(names).toContain("aggregate-findings");
    expect(names).toContain("persist-report");
    expect(names).toContain("persist-terminal");
  });
});
```

- [ ] **Step 2: Run; expected FAIL with hookups not yet made**

```bash
pnpm -w --filter @safelaunch/workers test src/workflows/scan-workflow.entrypoint.test.ts
```

Expected: FAIL — calls list does not include the named steps.

---

## Task 9: Entrypoint uses `step.do` (GREEN)

**Files:**

- Modify: `apps/workers/src/workflows/scan-workflow.ts` — the `ScanWorkflowEntrypoint.run` body

- [ ] **Step 1: Rewrite `run()`**

Replace the body of `ScanWorkflowEntrypoint.run` (the function that currently discards `_step`) with:

```ts
async run(
  event: Readonly<WorkflowEvent<ScanWorkflowPayload>>,
  step: WorkflowStep,
): Promise<ScanResult> {
  const params: ScanWorkflowPayload = event.payload;

  // 1. Parse parameters.
  const parsed = await step.do("parse-params", async () => ScanParamsSchema.parse(params));

  // 2. Fetch homepage (must succeed for the scan to continue).
  const homepage = await step.do("fetch:homepage", async () => {
    const r = await fetchPhase(parsed, {
      fetch: makeWorkflowFetch(),
      log: (entry) => console.log(JSON.stringify({ ...entry, source: "scan-workflow" })),
      now: () => new Date().toISOString(),
      retryCount: 1,
      retryBackoffMs: 5,
    });
    return r.homepage.ok ? r : null;
  });
  if (homepage === null) {
    await step.do("persist-terminal", () =>
      persistTerminalPhase(
        {
          scanId: parsed.scanId,
          state: "failed",
          status: "needs_review",
          coverage: { fetched: [], failed: ["homepage"], skipped: [] },
        },
        { db: this.env.DB, log: () => {}, now: () => new Date().toISOString() },
      ),
    );
    return {
      scanId: parsed.scanId,
      state: "failed",
      status: "needs_review",
      coverage: { fetched: [], failed: ["homepage"], skipped: [] },
    };
  }

  // 3. Fetch each remaining requested page.
  const requestedPages = parsed.requirePages ?? (["about", "privacy"] as const);
  const fetchedPages = [homepage];
  for (const pageType of requestedPages) {
    if (pageType === "homepage") continue;
    const result = await step.do(`fetch:${pageType}`, async () => {
      // Inline single-page fetch via the same logic as fetchPhase but for one
      // entry. Kept inline to keep the entrypoint self-contained.
      const fetcher = makeWorkflowFetch();
      const url = `${parsed.url.replace(/\/$/, "")}/${pageType}`;
      try {
        const r = await fetcher.fetch(url);
        return { ok: true as const, pageType, status: r.status, html: r.html };
      } catch (cause) {
        return { ok: false as const, pageType, reason: cause instanceof Error ? cause.message : "fetch failed" };
      }
    });
    fetchedPages.push(result);
  }

  // 4. Extract evidence.
  const evidence = await step.do("extract-evidence", async () =>
    extractEvidence(
      fetchedPages.flatMap((p) =>
        p.ok ? [{ type: p.pageType, url: `${parsed.url}/${p.pageType}`, status: p.status, html: p.html }] : [],
      ),
      { timeoutMs: Number(this.env.EXTRACT_EVIDENCE_TIMEOUT_MS ?? 10_000) },
    ),
  );

  // 5. Evaluate rules.
  const evaluation = await step.do("evaluate-rules", async () =>
    evaluatePhase(
      {
        scanId: parsed.scanId,
        jurisdiction: parsed.jurisdiction,
        category: parsed.category as "online_game" | "electronic_press" | "digital_entertainment",
        pages: fetchedPages.flatMap((p) =>
          p.ok ? [{ type: p.pageType, url: `${parsed.url}/${p.pageType}`, status: p.status, html: p.html }] : [],
        ),
        coverage: {
          fetched: fetchedPages.filter((p) => p.ok).map((p) => p.pageType),
          failed: fetchedPages.filter((p) => !p.ok).map((p) => p.pageType),
          skipped: [],
        },
      },
      { evaluate: makeWorkflowEvaluator(this.env), log: () => {} },
    ),
  );

  // 6. Aggregate.
  const complete =
    fetchedPages.filter((p) => !p.ok).length === 0 &&
    !(parsed.failedPages && parsed.failedPages.length > 0);
  const aggregated = await step.do("aggregate-findings", async () =>
    aggregateFindings(evaluation.findings, { complete }),
  );

  // 7. Persist report (only when no fatal partial state).
  const fatalFetch = fetchedPages.find((p) => p.pageType === "homepage" && !p.ok);
  if (!fatalFetch) {
    const report = await step.do("persist-report", async () =>
      persistReportPhase(
        {
          scanId: parsed.scanId,
          payload: {
            scanId: parsed.scanId,
            findings: evaluation.findings,
            status: aggregated,
            coverage: {
              fetched: fetchedPages.filter((p) => p.ok).map((p) => p.pageType),
              failed: fetchedPages.filter((p) => !p.ok).map((p) => p.pageType),
              skipped: [],
            },
            generatedAt: new Date().toISOString(),
          },
        },
        { db: this.env.DB, log: () => {}, now: () => new Date().toISOString() },
      ),
    );

    // 8. Persist terminal.
    await step.do("persist-terminal", () =>
      persistTerminalPhase(
        {
          scanId: parsed.scanId,
          state: "completed",
          status: aggregated,
          coverage: {
            fetched: fetchedPages.filter((p) => p.ok).map((p) => p.pageType),
            failed: fetchedPages.filter((p) => !p.ok).map((p) => p.pageType),
            skipped: [],
          },
        },
        { db: this.env.DB, log: () => {}, now: () => new Date().toISOString() },
      ),
    );

    return {
      scanId: parsed.scanId,
      state: "completed",
      status: aggregated,
      coverage: {
        fetched: fetchedPages.filter((p) => p.ok).map((p) => p.pageType),
        failed: fetchedPages.filter((p) => !p.ok).map((p) => p.pageType),
        skipped: [],
      },
      reportUrl: report.url,
    };
  }

  // Branch where homepage fetch failed — handled above by the early-return path,
  // here for type-narrowing only.
  throw new Error("unreachable: fatalFetch should have been caught earlier");
}
```

- [ ] **Step 2: Run entrypoint test, expected PASS**

```bash
pnpm -w --filter @safelaunch/workers test src/workflows/scan-workflow.entrypoint.test.ts
```

Expected: PASS, all 9 step names listed.

- [ ] **Step 3: Run all worker tests**

```bash
pnpm -w --filter @safelaunch/workers test
```

Expected: PASS.

- [ ] **Step 4: Typecheck**

```bash
pnpm -w --filter @safelaunch/workers typecheck
```

Expected: `tsc ...` exits 0.

- [ ] **Step 5: Lint**

```bash
pnpm -w --filter @safelaunch/workers lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/workflows/scan-workflow.ts \
        apps/workers/src/workflows/scan-workflow.entrypoint.test.ts
git commit -m "feat(workflow): step.do wrappers around each scan phase"
```

---

## Task 10: Bundle + dry-run deploy

**Files:** none

- [ ] **Step 1: Run the Wrangler bundle dry-run**

```bash
pnpm -w --filter @safelaunch/workers build
```

Expected: produces a `dist/` directory with `index.js`. No errors.

- [ ] **Step 2: Confirm workflow entry class is referenced**

```bash
grep -l ScanWorkflowEntrypoint dist/*.js
```

Expected: at least one match.

---

## Task 11: Deploy to prod + verify graph (Stage 3 of the spec)

**Files:** none

- [ ] **Step 1: Deploy**

```bash
pnpm -w --filter @safelaunch/workers exec wrangler deploy
```

Expected: `Published safelaunch-api (X.XX sec)`, version string printed.

- [ ] **Step 2: Trigger one scan via API**

```bash
curl -sS -X POST https://safelaunch.runany.dev/v1/scans \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com","jurisdiction":"VN","category":"online_game"}'
```

Expected: `200 OK` with `{ "scanId": "...", "statusUrl": "..." }`.

- [ ] **Step 3: Open the Cloudflare dashboard**

In a browser, navigate to:
`https://dash.cloudflare.com/?to=/:account/workers/workflows/view/safelaunch-api/scan-workflow`

Pick the most recent instance. Expected:

- The **Graph** tab shows nodes for `parse-params`, `fetch:homepage`, `fetch:about`, `fetch:privacy`, `extract-evidence`, `evaluate-rules`, `aggregate-findings`, `persist-report`, `persist-terminal`.
- The compliance verdict in the dashboard matches the verdict returned by `GET /v1/scans/:id`.

- [ ] **Step 4: Stop and report to user**

Do not mark the work complete in the harness. Tell the user the graph is rendered, paste the dashboard instance URL, and ask them to confirm they can see the same nodes.

---

## Task 12: Code review request

**Files:** none

- [ ] **Step 1: Open the PR**

```bash
git push -u origin codex/scan-workflow-step-graph
gh pr create --base main --title "feat(workflow): step graph + deterministic token" --body "..."
```

- [ ] **Step 2: Request review**

Use the `requesting-code-review` skill (paste PR URL into a fresh subagent).

---

## Self-review

1. **Spec coverage:**
   - G1 (graph renders) → Tasks 8, 9, 11.
   - G2 (per-phase retry) → Tasks 4, 5, 6, 9.
   - G3 (idempotent writes) → Tasks 1, 2, 6 (deterministic token + upsert by scan_id).
   - G4 (existing tests pass) → Task 7 Step 2.
   - G5 (multi-jurisdiction preserved) → unchanged; refactor is mechanical.
   - G6 (no new PII) → step names are public-safe enums; no URL is logged in step names.
   - G7 (single AI-evaluation node) → Task 9 Step 1, `step.do("evaluate-rules", ...)` wraps the fan-out.
   - Rollout stages → Tasks 0, 10, 11.

2. **Placeholder scan:** none — every step has actual code or actual commands.

3. **Type consistency:**
   - `deterministicReportToken(scanId)` → same string everywhere (Task 1, Task 6).
   - `persistReportPhase` input shape `{ scanId, payload }` matches step 1 in Task 9.
   - `persistTerminalPhase` input shape matches the call in Task 9.
   - `ScanWorkflowEntrypoint.run` signature unchanged in `wrangler.jsonc`.
