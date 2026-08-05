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
  homepage: { ok: true; status: number; html: Uint8Array } | { ok: false; reason: string };
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
const WEB_REPORT_BASE = "https://safelaunch.runany.dev/vi/report";

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

/**
 * Persists an in-flight progress state for the scan row.
 *
 * Mirrors {@link persistTerminalPhase} but writes **only** the `state`
 * column so the terminal phase's `coverage_json` snapshot is not
 * disturbed. The route layer reads `state` to surface live progress to
 * the polling client (`apps/web/src/components/scan-progress.tsx`).
 *
 * Why this exists: prior to this helper the only DB write happened at
 * `phase-10:persist-terminal`, so the API returned `state: "queued"`
 * for the entire duration of the scan and the stepper UI was stuck on
 * step 1 even though the workflow was moving forward.
 *
 * Errors are logged and re-thrown so the caller (the workflow
 * entrypoint) can decide whether to retry. The entrypoint wraps the
 * call in `runStepWithFallback` so a transient D1 cold-start does not
 * abort the entire scan.
 */
export const persistProgressPhase = async (
  input: { scanId: string; state: ScanStatus },
  deps: PersistDeps,
): Promise<void> => {
  await deps.db
    .prepare("UPDATE scans SET state = ? WHERE id = ?")
    .bind(input.state, input.scanId)
    .run();
  deps.log({
    level: "info",
    event: "scan.progress_persisted",
    scanId: input.scanId,
    state: input.state,
    at: deps.now(),
  });
};

import type { ServiceSignal, ScanStatus } from "@safelaunch/contracts";
import type {
  AssetFetcher,
  AssetReference,
  DigitalAssetCollection,
} from "../services/digital-assets";
import { detectServiceSignals } from "../services/service-signals";
import {
  collectAssetReferences,
  collectStylesheetReferences,
  classifyAssetRights,
} from "../services/digital-assets";
import {
  evaluateLicenseRequirements,
  type LicenseClaim,
  type LicenseRegistryResult,
} from "@safelaunch/compliance-core";
import type { EvidenceItem, ReportFinding } from "@safelaunch/contracts";
import { extractEvidence } from "../services/evidence";

/**
 * Phase A: decode the fetched pages and extract text evidence. Pure and
 * deterministic; no network access. Returns both the text evidence and the
 * decoded HTML for downstream phases (signals + asset discovery).
 */
export interface EvidenceExtractionPage {
  readonly type: SupportedPageType;
  readonly url: string;
  readonly status: number;
}

export interface EvidenceExtractionResult {
  readonly evidence: readonly EvidenceItem[];
  readonly pages: ReadonlyArray<{ url: string; html: string; type: SupportedPageType }>;
}

export const extractEvidencePhase = (
  pages: readonly EvidenceExtractionPage[],
  rawHtml: ReadonlyMap<string, Uint8Array>,
): EvidenceExtractionResult => {
  const evidence: EvidenceItem[] = [];
  const decoded: { url: string; html: string; type: SupportedPageType }[] = [];
  for (const page of pages) {
    if (page.status < 200 || page.status >= 300) continue;
    const bytes = rawHtml.get(page.url);
    if (!bytes) continue;
    const html = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes);
    decoded.push({ url: page.url, html, type: page.type });
    evidence.push(...extractEvidence({ sourceUrl: page.url, html }));
  }
  return { evidence, pages: decoded };
};

/**
 * Phase B: detect deterministic service signals (login, UGC, profile, feed,
 * follow, comment, share, editorial publishing) from already-decoded page HTML.
 */
export const extractServiceSignalsPhase = (
  pages: ReadonlyArray<{ url: string; html: string; type: SupportedPageType }>,
): ServiceSignal[] => {
  const out: ServiceSignal[] = [];
  for (const page of pages) {
    out.push(...detectServiceSignals({ sourceUrl: page.url, html: page.html }));
  }
  return out;
};

/**
 * Phase C: collect asset references (image, audio, video, font) from a page's
 * HTML and any directly referenced external stylesheet. Network fetches are
 * scoped to a single stylesheet per page and short-circuit on private hosts.
 */
export const collectAssetReferencesPhase = async (
  baseUrl: string,
  pages: ReadonlyArray<{ url: string; html: string }>,
  fetcher: AssetFetcher,
): Promise<AssetReference[]> => {
  const refs: AssetReference[] = [];
  for (const page of pages) {
    refs.push(...collectAssetReferences(page.url, page.html));
  }
  for (const page of pages) {
    const stylesheets = collectStylesheetLinksFromHtml(page.html, page.url);
    for (const stylesheet of stylesheets.slice(0, 10)) {
      const additional = await collectStylesheetReferences(baseUrl, stylesheet, fetcher);
      refs.push(...additional);
    }
  }
  const seen = new Set<string>();
  return refs
    .filter((ref) => {
      const key = `${ref.kind}:${ref.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
};

const collectStylesheetLinksFromHtml = (html: string, sourceUrl: string): string[] => {
  const values: string[] = [];
  const pattern =
    /<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/giu;
  const reversePattern =
    /<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*>/giu;
  for (const match of html.matchAll(pattern)) if (match[1]) values.push(match[1]);
  for (const match of html.matchAll(reversePattern)) if (match[1]) values.push(match[1]);
  void sourceUrl;
  return values;
};

/**
 * Phase D: turn the deduplicated asset references into a DigitalAsset
 * inventory with license evidence classification. Uses a single network
 * fetch per reference and falls back to `inaccessible` for failures.
 */
export const classifyAssetRightsPhase = (
  references: readonly AssetReference[],
  fetcher: AssetFetcher,
  contextHtml: string,
): Promise<DigitalAssetCollection> => classifyAssetRights(references, fetcher, contextHtml);

/**
 * Phase E: evaluate Vietnam license requirements. Combines service signals,
 * declared license claims, and the configured registry result.
 */
export const evaluateLicenseRequirementsPhase = (input: {
  jurisdiction: string;
  category: "online_game" | "electronic_press" | "digital_entertainment";
  signals: readonly ServiceSignal[];
  licenseClaims: readonly LicenseClaim[];
  registry: LicenseRegistryResult | undefined;
  on: string;
}): ReportFinding[] => {
  const checks = evaluateLicenseRequirements(input);
  return checks.map((check) => ({
    id: check.id,
    severity: check.severity,
    rationale: check.rationale,
    confidence: check.confidence,
    evidenceIds: check.evidenceIds.length > 0 ? [...check.evidenceIds] : [`${check.id}::missing`],
    citations: [...check.citations],
    recommendedAction: check.recommendedAction,
    applicability: "current",
    domain: "license",
    evidenceExcerpt:
      check.evidenceIds.length > 0
        ? (input.licenseClaims.find((c) => c.evidenceId === check.evidenceIds[0])?.value ?? "")
        : "Chưa tìm thấy bằng chứng giấy phép.",
  }));
};
