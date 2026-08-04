/**
 * Pure per-phase helpers extracted from `scan-workflow.runScan`.
 *
 * Each helper takes its dependencies as parameters (no global state) so it is
 * unit-testable in isolation. The Cloudflare Workflow entrypoint calls these
 * helpers inside `step.do(name, fn)` boundaries so the dashboard can render a
 * step-level Graph and the durable runtime can retry individual phases.
 */

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
 * Stable across retries because the input (scanId) does not change between
 * attempts. Format: `rpt_<64 hex chars>` — 256 bits of entropy.
 */
export const deterministicReportToken = async (scanId: string): Promise<string> => {
  const inner = await sha256Hex(scanId);
  return `rpt_${inner}`;
};

/**
 * Token hash that `ReportRepository.upsert` persists, derived from the
 * deterministic token. Stable across retries, so a replay of `step.do(...)`
 * rewrites the same row instead of producing a duplicate.
 */
export const deterministicTokenHash = async (scanId: string): Promise<string> => {
  const token = await deterministicReportToken(scanId);
  return sha256Hex(token);
};

import type { PageFetcher, ScanParams, SupportedPageType } from "./scan-workflow";

export interface FetchPhaseDeps {
  fetch: PageFetcher;
  log: (entry: Record<string, unknown>) => void;
  now: () => string;
  retryCount: number;
  retryBackoffMs: number;
}

export interface FetchPhasePage {
  type: SupportedPageType;
  url: string;
  status: number;
  html: Uint8Array;
}

export type FetchPhaseResult =
  | {
      homepage: { ok: true; status: number; html: Uint8Array };
      pages: FetchPhasePage[];
      fetched: SupportedPageType[];
      failed: SupportedPageType[];
    }
  | {
      homepage: { ok: false; reason: string };
      pages: [];
      fetched: [];
      failed: ["homepage"];
    };

const requiredPagesOf = (params: ScanParams): readonly SupportedPageType[] => {
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
  params: ScanParams,
  deps: FetchPhaseDeps,
): Promise<FetchPhaseResult> => {
  const requestedPages = requiredPagesOf(params);
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

  const pages: FetchPhasePage[] = [
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

import type {
  EvaluateOutcome,
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
