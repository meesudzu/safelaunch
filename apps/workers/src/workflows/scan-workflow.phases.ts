import type {
  EvaluateOutcome,
  PageFetcher,
  ScanCoverage,
  ScanParams,
  ScanTerminalState,
  ScanTerminalStatus,
  SupportedPageType,
} from "./scan-workflow";


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

export type FetchPhaseResult = {
  homepage:
    | { ok: true; status: number; html: Uint8Array }
    | { ok: false; reason: string };
  pages: FetchPhasePage[];
  fetched: SupportedPageType[];
  failed: SupportedPageType[];
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
      failed: ["homepage" satisfies SupportedPageType],
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


export interface FetchSinglePageDeps {
  fetcher: PageFetcher;
  pageType: SupportedPageType;
  baseUrl: string;
  retries: number;
  backoffMs: number;
  timeoutPages: Set<SupportedPageType>;
  forcedFailed: Set<SupportedPageType>;
}

/**
 * Fetches a single page. Used by the Workflow entrypoint to give each page
 * fetch its own `step.do` boundary so the dashboard can show one node per
 * page and the runtime retries only the failing page.
 */
export const fetchSinglePagePhase = async (
  deps: FetchSinglePageDeps,
  log: (entry: Record<string, unknown>) => void,
): Promise<
  | { ok: true; pageType: SupportedPageType; status: number; html: Uint8Array }
  | { ok: false; pageType: SupportedPageType; reason: string }
> => {
  if (deps.forcedFailed.has(deps.pageType) || deps.timeoutPages.has(deps.pageType)) {
    return { ok: false, pageType: deps.pageType, reason: "skipped" };
  }
  const url = `${deps.baseUrl.replace(/\/$/, "")}/${deps.pageType}`;
  const result = await fetchWithRetries(deps.fetcher, url, {
    pageType: deps.pageType,
    timeoutPages: deps.timeoutPages,
    retries: deps.retries,
    backoffMs: deps.backoffMs,
  });
  if (!result.ok) {
    log({
      level: "warn",
      event: "scan.page_fetch_failed",
      pageType: deps.pageType,
      reason: result.reason,
    });
    return { ok: false, pageType: deps.pageType, reason: result.reason };
  }
  return { ok: true, pageType: deps.pageType, status: result.status, html: result.html };
};


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


export interface PersistDeps {
  db: D1Database;
  log: (entry: Record<string, unknown>) => void;
  now: () => string;
}

const REPORT_TTL_SECONDS = 7 * 24 * 60 * 60;
const WEB_REPORT_BASE = "https://web.local/vi/report";

/**
 * Persists the report payload idempotently. Uses the deterministic token
 * derived from `scanId`, so a replay of this phase overwrites the same row in
 * the `reports` table and the report URL stays stable.
 */
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
  const url = `${WEB_REPORT_BASE}/${token}`;
  deps.log({
    level: "info",
    event: "scan.report_persisted",
    scanId: input.scanId,
    at: deps.now(),
  });
  return { token, url };
};

/**
 * Updates the scan row's terminal state. Mirrors `ScanRepository.updateTerminal`
 * exactly so this helper does not diverge from the package's contract.
 *
 * `status` is accepted (forward-compatible) but NOT persisted — current schema
 * stores the compliance verdict inside the report payload, not the scan row.
 */
export const persistTerminalPhase = async (
  input: {
    scanId: string;
    state: ScanTerminalState;
    status: ScanTerminalStatus;
    coverage: ScanCoverage;
  },
  deps: PersistDeps,
): Promise<void> => {
  void input.status; // accepted for API symmetry; see function doc.
  await deps.db
    .prepare("UPDATE scans SET state = ?, coverage_json = ? WHERE id = ?")
    .bind(input.state, JSON.stringify(input.coverage), input.scanId)
    .run();
  deps.log({
    level: "info",
    event: "scan.terminal_persisted",
    scanId: input.scanId,
    state: input.state,
    at: deps.now(),
  });
};
