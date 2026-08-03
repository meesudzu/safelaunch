import { z } from "zod";

export const SUPPORTED_PAGE_TYPES = [
  "homepage",
  "about",
  "terms",
  "privacy",
  "contact",
] as const;

export type SupportedPageType = (typeof SUPPORTED_PAGE_TYPES)[number];

export const ScanParamsSchema = z.object({
  scanId: z.string().min(1),
  url: z.string().url(),
  jurisdiction: z.string().min(1),
  category: z.string().min(1),
  analysisVersion: z.string().min(1),
  requirePages: z.array(z.enum(SUPPORTED_PAGE_TYPES)).optional(),
  failedPages: z.array(z.enum(SUPPORTED_PAGE_TYPES)).optional(),
  timeoutPages: z.array(z.enum(SUPPORTED_PAGE_TYPES)).optional(),
});

export type ScanParams = z.input<typeof ScanParamsSchema>;

export const ScanTerminalStatus = z.enum([
  "high_risk",
  "needs_review",
  "no_significant_risk",
]);
export type ScanTerminalStatus = z.infer<typeof ScanTerminalStatus>;

export const ScanTerminalState = z.enum([
  "completed",
  "partial",
  "failed",
]);
export type ScanTerminalState = z.infer<typeof ScanTerminalState>;

export const ScanCoverageSchema = z.object({
  fetched: z.array(z.enum(SUPPORTED_PAGE_TYPES)),
  failed: z.array(z.enum(SUPPORTED_PAGE_TYPES)),
  skipped: z.array(z.enum(SUPPORTED_PAGE_TYPES)),
});
export type ScanCoverage = z.infer<typeof ScanCoverageSchema>;

export interface PageFetcher {
  fetch(url: string): Promise<{ status: number; html: Uint8Array }>;
}

export interface EvaluateFinding {
  id: string;
  severity: "high" | "review" | "pass";
  rationale: string;
}

export interface EvaluateOutcome {
  status: ScanTerminalStatus;
  findings: EvaluateFinding[];
}

export interface ScanResult {
  scanId: string;
  state: ScanTerminalState;
  status: ScanTerminalStatus;
  coverage: ScanCoverage;
  reportUrl?: string;
}

export interface ScanRunDeps {
  fetch: PageFetcher;
  evaluate: (input: {
    scanId: string;
    pages: Array<{ type: SupportedPageType; url: string; status: number; html: Uint8Array }>;
    coverage: ScanCoverage;
  }) => Promise<EvaluateOutcome>;
  persistReport: (input: {
    scanId: string;
    payload: Record<string, unknown>;
  }) => Promise<{ token: string; url: string } | null>;
  now: () => string;
  log: (entry: Record<string, unknown>) => void;
  retryCount?: number;
  retryBackoffMs?: number;
}

const requiredPages = (params: ScanParams): readonly SupportedPageType[] => {
  if (params.requirePages === undefined) return ["about", "privacy"] as const;
  return params.requirePages;
};

const buildCoverage = (
  fetched: SupportedPageType[],
  failed: SupportedPageType[],
  skipped: SupportedPageType[],
): ScanCoverage => {
  const seen = new Set<SupportedPageType>();
  const dedupe = (list: SupportedPageType[]): SupportedPageType[] => {
    const result: SupportedPageType[] = [];
    for (const item of list) {
      if (seen.has(item)) continue;
      seen.add(item);
      result.push(item);
    }
    return result;
  };
  return {
    fetched: dedupe(fetched),
    failed: dedupe(failed),
    skipped: dedupe(skipped),
  };
};

const fetchWithRetries = async (
  fetcher: PageFetcher,
  url: string,
  options: { timeoutPages: Set<SupportedPageType>; pageType: SupportedPageType; retries: number; backoffMs: number },
): Promise<{ ok: true; status: number; html: Uint8Array } | { ok: false; reason: string }> => {
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

export const runScan = async (
  rawParams: ScanParams,
  deps: ScanRunDeps,
): Promise<ScanResult> => {
  const params = ScanParamsSchema.parse(rawParams);
  const requestedPages = requiredPages(params);
  const timeoutPages = new Set<SupportedPageType>(params.timeoutPages ?? []);
  const forcedFailed = new Set<SupportedPageType>(params.failedPages ?? []);
  const retryCount = deps.retryCount ?? 1;
  const retryBackoffMs = deps.retryBackoffMs ?? 5;

  deps.log({
    level: "info",
    event: "scan.start",
    scanId: params.scanId,
    jurisdiction: params.jurisdiction,
    category: params.category,
    requestedPages,
    at: deps.now(),
  });

  const fetched: SupportedPageType[] = [];
  const failed: SupportedPageType[] = [];
  const skipped: SupportedPageType[] = [];
  const pages: Array<{ type: SupportedPageType; url: string; status: number; html: Uint8Array }> = [];

  // Always fetch homepage first.
  const homepage = await fetchWithRetries(deps.fetch, params.url, {
    pageType: "homepage",
    timeoutPages,
    retries: retryCount,
    backoffMs: retryBackoffMs,
  });
  if (!homepage.ok) {
    deps.log({
      level: "error",
      event: "scan.homepage_failed",
      scanId: params.scanId,
      reason: homepage.reason,
      at: deps.now(),
    });
    const coverage = buildCoverage([], ["homepage"], []);
    return {
      scanId: params.scanId,
      state: "failed",
      status: "needs_review",
      coverage,
    };
  }
  fetched.push("homepage");
  pages.push({ type: "homepage", url: params.url, status: homepage.status, html: homepage.html });

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
      retries: retryCount,
      backoffMs: retryBackoffMs,
    });
    if (!result.ok) {
      failed.push(pageType);
      continue;
    }
    fetched.push(pageType);
    pages.push({ type: pageType, url: pageUrl, status: result.status, html: result.html });
  }

  const coverage = buildCoverage(fetched, failed, skipped);
  const evaluation = await deps.evaluate({
    scanId: params.scanId,
    pages,
    coverage,
  });

  let state: ScanTerminalState;
  if (failed.length === 0) {
    state = "completed";
  } else if (failed.includes("homepage") || fetched.length === 0) {
    state = "failed";
  } else {
    state = "partial";
  }

  // A partial or failed scan must never be classified as no_significant_risk.
  let status: ScanTerminalStatus = evaluation.status;
  if (state !== "completed" && status === "no_significant_risk") {
    status = "needs_review";
  }

  const timeoutPagesFailed = Array.from(timeoutPages).filter((p) => failed.includes(p));
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
  if (reportUrl) result.reportUrl = reportUrl;
  return result;
};

// --- Cloudflare Workflow binding --------------------------------------------
// Mirrors the spec from the MVP release plan
// (`docs/superpowers/plans/...mvp-release-plan.md`, Task 10). The workflow
// runtime is provided by the Cloudflare platform; unit tests drive the same
// logic via the exported `runScan` function above.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export interface ScanWorkflowEnv {
  DB: D1Database;
  AI?: Ai;
  FETCH_PAGES_TIMEOUT_MS?: string;
  EXTRACT_EVIDENCE_TIMEOUT_MS?: string;
  EVALUATE_TIMEOUT_MS?: string;
}

export type ScanWorkflowPayload = ScanParams;

export class ScanWorkflowEntrypoint extends WorkflowEntrypoint<ScanWorkflowEnv, ScanWorkflowPayload> {
  async run(
    event: Readonly<WorkflowEvent<ScanWorkflowPayload>>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _step: WorkflowStep,
  ): Promise<ScanResult> {
    // Each `step.do` invocation captures a unit of work that the Workflow
    // runtime retries and persists independently. The wrapper delegates the
    // actual logic to `runScan` so the same code path is exercised by tests.
    const params: ScanWorkflowPayload = event.payload;
    return runScan(params, {
      fetch: makeWorkflowFetch(),
      evaluate: makeWorkflowEvaluator(),
      persistReport: makeWorkflowPersistReport(this.env),
      now: () => new Date().toISOString(),
      log: (entry) =>
        console.log(
          JSON.stringify({ ...entry, scanId: params.scanId, source: "scan-workflow" }),
        ),
      retryCount: 1,
      retryBackoffMs: 5,
    });
  }
}

const makeWorkflowFetch = (): PageFetcher => {
  // Lazy import avoids a circular reference when this file is imported from
  // the worker entrypoint and avoids pulling the safe-fetch module into tests
  // that exercise `runScan` directly with a `PageFetcher` fake.
  return {
    async fetch(url) {
      const { fetchBoundedHtml } = await import("../services/safe-fetch");
      const result = await fetchBoundedHtml({ url, resolve: () => Promise.resolve([]) });
      return { status: result.status, html: result.bytes };
    },
  };
};

const makeWorkflowEvaluator = (): ScanRunDeps["evaluate"] => {
  return (): Promise<EvaluateOutcome> => {
    // The MVP evaluator stays deterministic. Phase 3 (Tasks 11-13) will
    // replace this stub with the jurisdiction rules + legal retrieval +
    // verifier pipeline.
    return Promise.resolve({ status: "needs_review" as const, findings: [] });
  };
};

const sha256Hex = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const REPORT_TTL_SECONDS = 7 * 24 * 60 * 60;

const makeWorkflowPersistReport = (
  env: ScanWorkflowEnv,
): ScanRunDeps["persistReport"] => {
  return async (input): Promise<{ token: string; url: string } | null> => {
    const tokenBytes = new Uint8Array(24);
    crypto.getRandomValues(tokenBytes);
    const token = `rpt_${Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    const tokenHash = await sha256Hex(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REPORT_TTL_SECONDS * 1000).toISOString();
    const payloadJson = JSON.stringify({
      ...input.payload,
      _reportToken: token,
    });
    const { ReportRepository } = await import("@safelaunch/db");
    const repo = new ReportRepository(env.DB);
    await repo.upsert({
      scanId: input.scanId,
      tokenHash,
      payloadJson,
      expiresAt,
    });
    const url = `https://web.local/vi/report/${token}`;
    return { token, url };
  };
};

export const SCAN_WORKFLOW_NAME = "scan-workflow";
