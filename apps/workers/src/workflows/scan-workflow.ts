import { z } from "zod";
import type {
  FontInventory,
  DigitalAsset,
  EvidenceItem,
  LicenseCheck,
  ReportFinding,
  ScanStatus,
  ServiceSignal,
} from "@safelaunch/contracts";
import type { WorkflowStepConfig } from "cloudflare:workers";
import { extractEvidence } from "../services/evidence";
import {
  collectDigitalAssets,
  pageHasAssetCandidates,
  type AssetFetcher,
  type AssetFinding,
  type AssetReference,
  type DigitalAssetCollection,
} from "../services/digital-assets";
import { groupAssetsIntoFamilies } from "../services/font-grouping";
import { detectServiceSignals } from "../services/service-signals";
import {
  evaluatePhase,
  fetchPhase,
  fetchSinglePagePhase,
  persistProgressPhase,
  persistReportPhase,
  persistTerminalPhase,
  extractEvidencePhase,
  extractServiceSignalsPhase,
  collectAssetReferencesPhase,
  classifyAssetRightsPhase,
  evaluateLicenseRequirementsPhase,
  type EvidenceExtractionResult,
} from "./scan-workflow.phases";
import { LegalRepository } from "@safelaunch/db";
import { DEFAULT_SCAN_STEP_CONFIG, EMPTY_DIGITAL_ASSET_COLLECTION } from "./scan-workflow.steps";
import { discoverPageUrls, type PageUrlMap } from "../services/page-url-discovery";
import {
  runRules,
  verifyFinding,
  aggregateFindings,
  RUBRIC_VERSION,
  evaluateLicenseRequirements,
  InMemoryLicenseRegistry,
} from "@safelaunch/compliance-core";
import {
  retrieveLegalContext,
  evaluateEvidenceProvisionPair,
  createEvaluationProvider,
  embedText as embedTextAi,
  type RetrievalDeps,
} from "@safelaunch/ai";

export const SUPPORTED_PAGE_TYPES = ["homepage", "about", "terms", "privacy", "contact"] as const;

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

export const ScanTerminalStatus = z.enum(["high_risk", "needs_review", "no_significant_risk"]);
export type ScanTerminalStatus = z.infer<typeof ScanTerminalStatus>;

export const ScanTerminalState = z.enum(["completed", "partial", "failed"]);
export type ScanTerminalState = z.infer<typeof ScanTerminalState>;

export const ScanCoverageSchema = z.object({
  fetched: z.array(z.enum(SUPPORTED_PAGE_TYPES)),
  failed: z.array(z.enum(SUPPORTED_PAGE_TYPES)),
  skipped: z.array(z.enum(SUPPORTED_PAGE_TYPES)),
  /**
   * Phases that produced no signal because the step exhausted its retries
   * (typically a Worker CPU time limit or a step timeout). Surfaced on the
   * scan report so operators and end users can tell a clean "completed"
   * scan from one where, e.g., digital-rights classification was skipped.
   * Backward-compatible: old payloads that omit this field are normalized
   * to an empty array in the routes layer.
   */
  degradedPhases: z.array(z.string()),
});
export type ScanCoverage = z.infer<typeof ScanCoverageSchema>;

export interface PageFetcher {
  fetch(url: string): Promise<{ status: number; html: Uint8Array }>;
}

/**
 * The evaluator emits the public `ReportFinding` shape directly so the
 * workflow orchestrator can persist findings without any further mapping.
 */
export interface EvaluateOutcome {
  status: ScanTerminalStatus;
  findings: ReportFinding[];
  serviceSignals?: ServiceSignal[];
  licenseChecks?: LicenseCheck[];
  assetInventory?: {
    assets: DigitalAsset[];
    findings: AssetFinding[];
    summary: { total: number; byKind: Record<string, number>; flagged: number };
    fontInventory: FontInventory;
  };
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
    jurisdiction: string;
    category: "online_game" | "electronic_press" | "digital_entertainment";
    pages: Array<{ type: SupportedPageType; url: string; status: number; html: Uint8Array }>;
    coverage: ScanCoverage;
  }) => Promise<EvaluateOutcome>;
  persistReport: (input: {
    scanId: string;
    payload: Record<string, unknown>;
  }) => Promise<{ token: string; url: string } | null>;
  persistTerminalState?: (input: {
    scanId: string;
    state: ScanTerminalState;
    status: ScanTerminalStatus;
    coverage: ScanCoverage;
  }) => Promise<void>;
  /**
   * Optional in-flight progress callback. Called with non-terminal
   * `ScanState` values ("extracting", "evaluating", ...) so the route
   * layer can surface live progress to polling clients. Mirrors the
   * contract of {@link persistTerminalState}. Best-effort: a failure
   * here must not abort the scan; the entrypoint wraps the actual DB
   * write in an inline try/catch (see the comment block at the top
   * of ScanWorkflowEntrypoint.run for the visualizer rationale).
   */
  persistProgressState?: (input: { scanId: string; state: ScanStatus }) => Promise<void>;
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
  degradedPhases: readonly string[] = [],
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
    degradedPhases: Array.from(new Set(degradedPhases)),
  };
};

export const runScan = async (rawParams: ScanParams, deps: ScanRunDeps): Promise<ScanResult> => {
  const params = ScanParamsSchema.parse(rawParams);
  const retryCount = deps.retryCount ?? 1;
  const retryBackoffMs = deps.retryBackoffMs ?? 5;

  deps.log({
    level: "info",
    event: "scan.start",
    scanId: params.scanId,
    jurisdiction: params.jurisdiction,
    category: params.category,
    requestedPages: requiredPages(params),
    at: deps.now(),
  });

  const fetchResult = await fetchPhase(params, {
    fetch: deps.fetch,
    log: deps.log,
    now: deps.now,
    retryCount,
    retryBackoffMs,
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
  // Publish "extracting" so the polling client can advance the stepper
  // past "fetching" while the (potentially slow) evidence-extraction
  // loop runs. Best-effort -- a callback throw does not abort the scan.
  await deps.persistProgressState?.({
    scanId: params.scanId,
    state: "extracting",
  });
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

  // A partial or failed scan must never be classified as no_significant_risk.
  let status: ScanTerminalStatus = evaluation.status;
  if (state !== "completed" && status === "no_significant_risk") {
    status = "needs_review";
  }
  // Publish "evaluating" so the polling client can advance to the rule
  // evaluation step. The terminal state still wins once
  // persistTerminalState fires, so the UI flips from "evaluating" to
  // "completed" / "partial" / "failed" on the next poll.
  await deps.persistProgressState?.({
    scanId: params.scanId,
    state: "evaluating",
  });

  const timeoutPages = new Set<SupportedPageType>(params.timeoutPages ?? []);
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
        serviceSignals: evaluation.serviceSignals,
        licenseChecks: evaluation.licenseChecks,
        assetInventory: evaluation.assetInventory
          ? { ...evaluation.assetInventory, fontInventory: evaluation.assetInventory.fontInventory }
          : undefined,
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

// --- Cloudflare Workflow binding --------------------------------------------
// Mirrors the spec from the MVP release plan
// (`docs/superpowers/plans/...mvp-release-plan.md`, Task 10). The workflow
// runtime is provided by the Cloudflare platform; unit tests drive the same
// logic via the exported `runScan` function above.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export interface ScanWorkflowEnv {
  DB: D1Database;
  AI?: Ai;
  LEGAL_INDEX?: VectorizeIndex;
  FETCH_PAGES_TIMEOUT_MS?: string;
  EXTRACT_EVIDENCE_TIMEOUT_MS?: string;
  EVALUATE_TIMEOUT_MS?: string;
}

export type ScanWorkflowPayload = ScanParams;

export class ScanWorkflowEntrypoint extends WorkflowEntrypoint<
  ScanWorkflowEnv,
  ScanWorkflowPayload
> {
  async run(
    event: Readonly<WorkflowEvent<ScanWorkflowPayload>>,
    step: WorkflowStep,
  ): Promise<ScanResult> {
    // Each `step.do(name, fn)` becomes one node on the Cloudflare dashboard
    // Graph (a `StepDo` node per the visualizer AST, see
    // https://developers.cloudflare.com/workflows/build/visualizer/). The
    // runtime retries the closure on transient failure and memoizes its
    // return value so a partial failure does not replay earlier phases.
    //
    // The seven steps that need graceful fallback (discover:page-urls,
    // publish:extracting, phase-2:extract-evidence,
    // phase-4:scan-assets-references, phase-5:classify-asset-rights,
    // publish:evaluating, publish:reporting) are wrapped in inline
    // `try/catch` blocks instead of a module-level helper. Cloudflare's
    // workflow visualizer renders a `.do(...)` call wrapped in a named
    // helper as a generic `FunctionCall` node, hiding the literal step
    // name on the dashboard graph. Inlining the `.do` call inside a
    // `try/catch` block makes the visualizer emit a `TryNode` containing
    // a `StepDo` node with the literal name, so the dashboard shows
    // "publish:extracting" instead of the runStepWithFallback helper.
    //
    // The `runStepWithFallback` helper is still exported from
    // `scan-workflow.steps.ts` and is exercised by the unit tests there
    // and by the entrypoint-level tests that simulate step failures; the
    // module-level helper is preserved for behavior parity, not for graph
    // visibility.
    const params: ScanWorkflowPayload = event.payload;
    const log = (entry: Record<string, unknown>) =>
      console.log(JSON.stringify({ ...entry, scanId: params.scanId, source: "scan-workflow" }));
    const now = () => new Date().toISOString();

    // 1. parse-params: validate and freeze the payload.
    //
    // The callback is intentionally non-async: it returns `ScanWorkflowPayload`
    // wrapped in `Promise.resolve(...)` so the value satisfies WorkflowStep's
    // `() => Promise<T>` contract without triggering
    // `@typescript-eslint/require-await`. The outer `await step.do(...)` is what
    // actually drives the durable step.
    const parsed = await step.do<ScanWorkflowPayload, WorkflowStepConfig>(
      "parse-params",
      DEFAULT_SCAN_STEP_CONFIG,
      () => Promise.resolve(ScanParamsSchema.parse(params)),
    );

    // publish:fetching: inline try/catch so the visualizer renders
    // a `StepDo` node with the literal name. Fires immediately after
    // parse-params so the polling client sees the "fetching" state
    // for the duration of all page fetches. Best-effort: a transient
    // D1 cold-start does not abort the scan.
    try {
      await step.do("publish:fetching", DEFAULT_SCAN_STEP_CONFIG, () =>
        persistProgressPhase(
          { scanId: parsed.scanId, state: "fetching" },
          { db: this.env.DB, log, now },
        ),
      );
    } catch (cause) {
      log({
        level: "warn",
        event: "scan.step_fallback",
        step: "publish:fetching",
        reason: cause instanceof Error ? cause.message : String(cause),
        at: now(),
      });
    }

    // 2. fetch:homepage (must succeed for the scan to continue).
    const homepagePage = await step.do("fetch:homepage", DEFAULT_SCAN_STEP_CONFIG, async () => {
      const fetcher = makeWorkflowFetch();
      try {
        const r = await fetcher.fetch(parsed.url);
        return { ok: true as const, status: r.status, html: r.html };
      } catch (cause) {
        return {
          ok: false as const,
          reason: cause instanceof Error ? cause.message : "fetch failed",
        };
      }
    });

    if (!homepagePage.ok) {
      const failedCoverage: ScanCoverage = {
        fetched: [] as SupportedPageType[],
        failed: ["homepage"] as SupportedPageType[],
        skipped: [] as SupportedPageType[],
        degradedPhases: [],
      };
      await step.do("phase-10:persist-terminal", DEFAULT_SCAN_STEP_CONFIG, async () =>
        persistTerminalPhase(
          {
            scanId: parsed.scanId,
            state: "failed",
            status: "needs_review",
            coverage: failedCoverage,
          },
          { db: this.env.DB, log, now },
        ),
      );
      return {
        scanId: parsed.scanId,
        state: "failed" as ScanTerminalState,
        status: "needs_review" as ScanTerminalStatus,
        coverage: failedCoverage,
      };
    } else {
      // Cloudflare's workflow visualizer emits a discrete IfBranch + ElseBranch
      // for an explicit if (cond) { ... } else { ... } block; without this
      // wrapper, the visualizer treats the success path as the implicit "rest
      // of function" tail and attaches the failure-path phase-10:persist-terminal
      // to the left of homepagePage.ok.
      // 3. fetch:<page> — four inlined literal-named `step.do` calls, one
      //    per non-homepage page type.
      //
      // The previous version wrapped the page fetches in a `fetchOne(pageType)`
      // helper with a 5-case switch. Cloudflare's dashboard graph analyzer
      // renders every call site as a separate `function call` node and
      // expands the full switch body inside each — repeating the same
      // sub-tree 4 times and dropping some steps in the dedupe. Inlining the
      // 4 `step.do` calls removes the helper and gives the analyzer a flat
      // top-level sequence of literal-named steps.
      //
      // Each step name is a *literal* string so the dashboard emits a
      // discrete node per page. Pages absent from `requirePages` short-
      // circuit the closure to a benign placeholder so the graph shows the
      // full picture without spending HTTP budget on pages the consumer did
      // not ask for.
      const requiredPages = new Set<SupportedPageType>(parsed.requirePages ?? ["about", "privacy"]);
      const timeoutPages = new Set<SupportedPageType>(parsed.timeoutPages ?? []);
      const forcedFailed = new Set<SupportedPageType>(parsed.failedPages ?? []);

      type PageResult =
        | { ok: true; pageType: SupportedPageType; status: number; html: Uint8Array }
        | { ok: false; pageType: SupportedPageType; reason: string };
      const perPageResults: PageResult[] = [];

      // F2: parse the homepage footer to discover the actual URLs of the
      // about / privacy / terms / contact pages. Most sites use non-English
      // slugs (e.g. /gioi-thieu, /chinh-sach-bao-mat) so the legacy
      // `${baseUrl}/${pageType}` URL pattern 404s. We expose a new
      // `discover:page-urls` step so the dashboard shows the discovery
      // and so a malformed homepage HTML falls back to the legacy URLs
      // (via the inline `try/catch` below; the helper is no longer
      // called here so the visualizer renders a `StepDo` node with the
      // literal name).
      // discover:page-urls: inline try/catch so the visualizer renders
      // a `StepDo` node with the literal name instead of a generic
      // `FunctionCall` for the helper. The fallback is identical to the
      // historical fallback behavior: runStepWithFallback with fallback {}.
      let pageUrlMap: PageUrlMap = {};
      try {
        pageUrlMap = await step.do<PageUrlMap, WorkflowStepConfig>(
          "discover:page-urls",
          {
            ...DEFAULT_SCAN_STEP_CONFIG,
            retries: { limit: 1, delay: 1_000, backoff: "constant" },
            timeout: "20 seconds",
          },
          () => {
            const html = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(
              homepagePage.html,
            );
            return Promise.resolve(discoverPageUrls(parsed.url, html));
          },
        );
      } catch (cause) {
        log({
          level: "warn",
          event: "scan.step_fallback",
          step: "discover:page-urls",
          reason: cause instanceof Error ? cause.message : String(cause),
          at: now(),
        });
      }
      {
        const discovered = Object.keys(pageUrlMap) as SupportedPageType[];
        const fallback = (["about", "privacy", "terms", "contact"] as const).filter(
          (t) => requiredPages.has(t) && !pageUrlMap[t],
        );
        log({
          level: "info",
          event: "scan.page_urls_discovered",
          discovered,
          fallback,
        });
      }

      const makeBaseDeps = (pageType: SupportedPageType) => ({
        fetcher: makeWorkflowFetch(),
        pageType,
        baseUrl: parsed.url,
        retries: 1,
        backoffMs: 5,
        timeoutPages,
        forcedFailed,
        urlOverrides: pageUrlMap,
      });

      perPageResults.push(
        requiredPages.has("about")
          ? await step.do("fetch:about", DEFAULT_SCAN_STEP_CONFIG, async () =>
              fetchSinglePagePhase(makeBaseDeps("about"), log),
            )
          : { ok: true, pageType: "about", status: 200, html: new Uint8Array() },
      );
      perPageResults.push(
        requiredPages.has("privacy")
          ? await step.do("fetch:privacy", DEFAULT_SCAN_STEP_CONFIG, async () =>
              fetchSinglePagePhase(makeBaseDeps("privacy"), log),
            )
          : { ok: true, pageType: "privacy", status: 200, html: new Uint8Array() },
      );
      perPageResults.push(
        requiredPages.has("contact")
          ? await step.do("fetch:contact", DEFAULT_SCAN_STEP_CONFIG, async () =>
              fetchSinglePagePhase(makeBaseDeps("contact"), log),
            )
          : { ok: true, pageType: "contact", status: 200, html: new Uint8Array() },
      );
      perPageResults.push(
        requiredPages.has("terms")
          ? await step.do("fetch:terms", DEFAULT_SCAN_STEP_CONFIG, async () =>
              fetchSinglePagePhase(makeBaseDeps("terms"), log),
            )
          : { ok: true, pageType: "terms", status: 200, html: new Uint8Array() },
      );

      // 4. evaluate-rules (single fan-out step — see spec §4 assumption G7).
      // extract-evidence is currently performed inside makeWorkflowEvaluator; the
      // step boundary still exists at evaluate-rules. Splitting extraction into a
      // separate step would require reshaping ScanRunDeps.evaluate so runScan
      // tests could supply evidence — that refactor is deferred.
      const homeRow = {
        type: "homepage" as const,
        url: parsed.url,
        status: homepagePage.status,
        html: homepagePage.html,
      };
      const fetchedRows = [
        homeRow,
        ...perPageResults.flatMap((r) =>
          r.ok
            ? [
                {
                  type: r.pageType,
                  url: `${parsed.url}/${r.pageType}`,
                  status: r.status,
                  html: r.html,
                },
              ]
            : [],
        ),
      ];

      const fetcheds = perPageResults.filter((r) => r.ok).map((r) => r.pageType);
      const faileds = perPageResults.filter((r) => !r.ok).map((r) => r.pageType);
      // Phases 4 and 5 do network fetches that can blow past the per-Worker
      // CPU budget; the inline try/catch around each .do() call records any
      // skipped phase into this array so it propagates into the persisted
      // coverage for operator visibility.
      const degradedPhases: string[] = [];
      // Delegate to `buildCoverage` so the dedupe contract is enforced: a page
      // that is already in `fetched` is dropped from `failed` and `skipped`.
      // Previously this branch hard-coded `"homepage"` into the failed list,
      // causing the scan dashboard to render "Đã quét: homepage" AND
      // "Không thể quét: homepage" simultaneously.
      const coverage: ScanCoverage = buildCoverage(
        ["homepage", ...fetcheds],
        faileds,
        [],
        degradedPhases,
      );
      const rawHtml = new Map<string, Uint8Array>();
      for (const row of fetchedRows) rawHtml.set(row.url, row.html);
      // publish:extracting: inline try/catch so the visualizer renders
      // a `StepDo` node with the literal name. The inner step is still
      // wrapped in try/catch so a transient D1 cold-start does not
      // abort the scan (matches the previous `runStepWithFallback`
      // fallback=undefined behavior).
      try {
        await step.do("publish:extracting", DEFAULT_SCAN_STEP_CONFIG, () =>
          persistProgressPhase(
            { scanId: parsed.scanId, state: "extracting" },
            { db: this.env.DB, log, now },
          ),
        );
      } catch (cause) {
        log({
          level: "warn",
          event: "scan.step_fallback",
          step: "publish:extracting",
          reason: cause instanceof Error ? cause.message : String(cause),
          at: now(),
        });
      }
      // phase-2 is CPU-bound (regex loop on every chunk of every page).
      // A large site (e.g. dantri.com.vn) can blow the Worker CPU
      // budget on a single attempt; the inline try/catch below turns a
      // CPU-timeout into a degraded phase instead of stalling the
      // dashboard in "Pending" for ~5 minutes of retries.
      // phase-2:extract-evidence: inline try/catch so the visualizer
      // renders a `StepDo` node with the literal name. The fallback is
      // the previously-documented empty result so phases 3-10 still run
      // when the evidence-extraction loop blows the CPU budget.
      // Use the same shape the published `extractEvidencePhase` returns so
      // downstream code that reads `.html`, `.type`, `.value`, etc. continues
      // to type-check. The fallback is an empty result; the only impact of
      // the fallback path is that the scan proceeds with no extracted
      // evidence.
      // Override html to be empty string so the fallback is well-typed
      // (downstream consumers expect `{ url, html, type }` where html is
      // the decoded string, matching `EvidenceExtractionResult.pages`).
      const emptyEvidenceSafe: {
        evidence: readonly EvidenceItem[];
        pages: { url: string; html: string; type: SupportedPageType }[];
      } = {
        evidence: [],
        pages: fetchedRows.map((r) => ({ url: r.url, type: r.type, html: "" })),
      };
      let evidencePhase: EvidenceExtractionResult = emptyEvidenceSafe;
      try {
        evidencePhase = await step.do<EvidenceExtractionResult, WorkflowStepConfig>(
          "phase-2:extract-evidence",
          {
            ...DEFAULT_SCAN_STEP_CONFIG,
            retries: { limit: 1, delay: 5_000, backoff: "constant" },
            timeout: "1 minute",
          },
          () => {
            const result = extractEvidencePhase(
              fetchedRows.map((r) => ({ type: r.type, url: r.url, status: r.status })),
              rawHtml,
            );
            return Promise.resolve(result);
          },
        );
      } catch (cause) {
        log({
          level: "warn",
          event: "scan.step_fallback",
          step: "phase-2:extract-evidence",
          reason: cause instanceof Error ? cause.message : String(cause),
          at: now(),
        });
      }
      if (evidencePhase.pages.length === 0 && fetchedRows.length > 0) {
        // Empty pages list could be correct (no useful HTML) OR a
        // silent phase-2 failure. Flag degraded only when fetches
        // returned content that should have produced evidence.
        degradedPhases.push("phase-2:extract-evidence");
      }
      const serviceSignals = await step.do(
        "phase-3:extract-signals",
        DEFAULT_SCAN_STEP_CONFIG,
        async () => {
          const result = extractServiceSignalsPhase(evidencePhase.pages);
          return await Promise.resolve(result);
        },
      );
      const assetFetcher = makeWorkflowAssetFetcher();
      // Phases 4 and 5 do network fetches (stylesheet download + per-asset
      // probe). On a busy page the loop can blow past the per-Worker CPU
      // budget even with individual 8s timeouts, so the runtime retries
      // 5 times and still throws — taking 5+ minutes before the user sees
      // a failure. The fallback wrapper turns that into a warning +
      // empty result so phases 6-10 still run. Operators can spot the
      // degraded scans via the `scan.step_fallback` log entries or the
      // new `coverage.degradedPhases` field on the persisted report.
      // phase-4:scan-assets-references: inline try/catch so the
      // visualizer renders a `StepDo` node with the literal name. The
      // fallback deliberately reports `degraded: false` so that a step
      // failure (CPU time limit, network error, exhausted retries) is
      // surfaced only via the `scan.step_fallback` log line - not via
      // `coverage.degradedPhases` (reserved for the case where the step
      // actually ran and the heuristic positively identified asset
      // candidates).
      const emptyPhase4: { refs: readonly AssetReference[]; degraded: boolean } = {
        refs: [],
        degraded: false,
      };
      let phase4: typeof emptyPhase4 = emptyPhase4;
      try {
        phase4 = await step.do<typeof emptyPhase4, WorkflowStepConfig>(
          "phase-4:scan-assets-references",
          {
            ...DEFAULT_SCAN_STEP_CONFIG,
            retries: { limit: 1, delay: 5_000, backoff: "constant" },
            timeout: "2 minutes",
          },
          async () => {
            const refs = await collectAssetReferencesPhase(
              parsed.url,
              evidencePhase.pages,
              assetFetcher,
            );
            const degraded = refs.length === 0 && pageHasAssetCandidates(evidencePhase.pages);
            return { refs, degraded };
          },
        );
      } catch (cause) {
        log({
          level: "warn",
          event: "scan.step_fallback",
          step: "phase-4:scan-assets-references",
          reason: cause instanceof Error ? cause.message : String(cause),
          at: now(),
        });
      }
      const assetRefs = phase4.refs;
      if (phase4.degraded) {
        degradedPhases.push("phase-4:scan-assets-references");
      }
      // phase-5:classify-asset-rights: inline try/catch so the
      // visualizer renders a `StepDo` node with the literal name. The
      // fallback is `EMPTY_DIGITAL_ASSET_COLLECTION` so subsequent
      // phases (license evaluation, rule evaluation, aggregation,
      // report persistence) still complete when this phase exhausts
      // its retries.
      let assetInventory = EMPTY_DIGITAL_ASSET_COLLECTION;
      try {
        assetInventory = await step.do<DigitalAssetCollection, WorkflowStepConfig>(
          "phase-5:classify-asset-rights",
          {
            ...DEFAULT_SCAN_STEP_CONFIG,
            retries: { limit: 2, delay: 5_000, backoff: "constant" },
            timeout: "3 minutes",
          },
          () =>
            classifyAssetRightsPhase(
              assetRefs,
              assetFetcher,
              evidencePhase.pages.map((p) => p.html).join("\n"),
            ),
        );
      } catch (cause) {
        log({
          level: "warn",
          event: "scan.step_fallback",
          step: "phase-5:classify-asset-rights",
          reason: cause instanceof Error ? cause.message : String(cause),
          at: now(),
        });
      }
      if (assetInventory === EMPTY_DIGITAL_ASSET_COLLECTION) {
        degradedPhases.push("phase-5:classify-asset-rights");
      }
      // Publish "evaluating" once the asset-rights classification phase
      // is done so the polling client can advance from "extracting" to
      // "evaluating" before the (potentially slow) RAG evaluation runs.
      // publish:evaluating: inline try/catch so the visualizer renders
      // a `StepDo` node with the literal name. A failure here is
      // best-effort (transient D1 cold-start does not abort the
      // evaluation phase).
      try {
        await step.do("publish:evaluating", DEFAULT_SCAN_STEP_CONFIG, () =>
          persistProgressPhase(
            { scanId: parsed.scanId, state: "evaluating" },
            { db: this.env.DB, log, now },
          ),
        );
      } catch (cause) {
        log({
          level: "warn",
          event: "scan.step_fallback",
          step: "publish:evaluating",
          reason: cause instanceof Error ? cause.message : String(cause),
          at: now(),
        });
      }
      const licenseClaims = evidencePhase.evidence
        .filter((item) => item.type === "license_claim")
        .map((item) => ({ value: item.value, evidenceId: item.id, sourceUrl: item.sourceUrl }));
      const registry = await new InMemoryLicenseRegistry().lookup({
        jurisdiction: parsed.jurisdiction,
        licenseType: "online_game",
      });
      const licenseChecks = await step.do(
        "phase-6:evaluate-license",
        DEFAULT_SCAN_STEP_CONFIG,
        async () => {
          const result = evaluateLicenseRequirementsPhase({
            jurisdiction: parsed.jurisdiction,
            category: parsed.category as
              "online_game" | "electronic_press" | "digital_entertainment",
            signals: serviceSignals,
            licenseClaims,
            registry,
            on: new Date().toISOString().slice(0, 10),
          });
          return await Promise.resolve(result);
        },
      );
      // publish:retrieving: inline try/catch so the visualizer renders
      // a `StepDo` node with the literal name. Fires between phase-6
      // (deterministic license eval) and phase-7 (RAG + AI eval) so
      // the polling client sees the "retrieving" state for the duration
      // of the slowest phase. Best-effort.
      try {
        await step.do("publish:retrieving", DEFAULT_SCAN_STEP_CONFIG, () =>
          persistProgressPhase(
            { scanId: parsed.scanId, state: "retrieving" },
            { db: this.env.DB, log, now },
          ),
        );
      } catch (cause) {
        log({
          level: "warn",
          event: "scan.step_fallback",
          step: "publish:retrieving",
          reason: cause instanceof Error ? cause.message : String(cause),
          at: now(),
        });
      }

      const evaluation = await step.do("phase-7:evaluate-rules", DEFAULT_SCAN_STEP_CONFIG, () =>
        evaluatePhase(
          {
            scanId: parsed.scanId,
            jurisdiction: parsed.jurisdiction,
            category: parsed.category as
              "online_game" | "electronic_press" | "digital_entertainment",
            pages: fetchedRows,
            coverage,
          },
          { evaluate: makeWorkflowEvaluator(this.env), log },
        ),
      );

      // 6. aggregate-findings
      const complete = coverage.failed.length === 0;
      // eslint-disable-next-line @typescript-eslint/require-await
      const aggregated = await step.do("phase-8:aggregate", DEFAULT_SCAN_STEP_CONFIG, async () =>
        aggregateFindings(evaluation.findings, { complete }),
      );

      let state: ScanTerminalState;
      if (coverage.failed.length === 0 && coverage.degradedPhases.length === 0) {
        state = "completed";
      } else if (coverage.fetched.length === 0) {
        state = "failed";
      } else {
        // Either a page failed OR a phase was skipped (e.g. asset
        // classification timed out). Both are surfaced as `partial` so the
        // dashboard flags the scan for human review.
        state = "partial";
      }

      let finalStatus: ScanTerminalStatus = aggregated;
      if (state !== "completed" && finalStatus === "no_significant_risk") {
        finalStatus = "needs_review";
      }

      // Publish "reporting" once aggregation finishes so the polling
      // client can show "reporting" while the report row is upserted.
      // publish:reporting: inline try/catch so the visualizer renders
      // a `StepDo` node with the literal name. A failure here is
      // best-effort (the report row is still upserted by phase-9).
      try {
        await step.do("publish:reporting", DEFAULT_SCAN_STEP_CONFIG, () =>
          persistProgressPhase(
            { scanId: parsed.scanId, state: "reporting" },
            { db: this.env.DB, log, now },
          ),
        );
      } catch (cause) {
        log({
          level: "warn",
          event: "scan.step_fallback",
          step: "publish:reporting",
          reason: cause instanceof Error ? cause.message : String(cause),
          at: now(),
        });
      }

      // 7. persist-report (deterministic token, idempotent upsert)
      const report = await step.do("phase-9:persist-report", DEFAULT_SCAN_STEP_CONFIG, async () =>
        persistReportPhase(
          {
            scanId: parsed.scanId,
            payload: {
              scanId: parsed.scanId,
              state,
              status: finalStatus,
              coverage,
              findings: evaluation.findings,
              serviceSignals,
              licenseChecks,
              assetInventory,
              generatedAt: now(),
            },
          },
          { db: this.env.DB, log, now },
        ),
      );

      // 8. persist-terminal (last; same coverage shape)
      await step.do("phase-10:persist-terminal", DEFAULT_SCAN_STEP_CONFIG, async () =>
        persistTerminalPhase(
          { scanId: parsed.scanId, state, status: finalStatus, coverage },
          { db: this.env.DB, log, now },
        ),
      );

      return {
        scanId: parsed.scanId,
        state,
        status: finalStatus,
        coverage,
        reportUrl: report.url,
      };
    }
  }
}

const makeWorkflowAssetFetcher = (): AssetFetcher => ({
  async fetch(url) {
    const { fetchBoundedResource } = await import("../services/safe-fetch");
    const result = await fetchBoundedResource({ url, resolve: resolvePublicAddresses });
    return {
      status: result.status,
      bytes: result.bytes,
      contentType: result.contentType,
      finalUrl: result.finalUrl,
    };
  },
});

const makeWorkflowFetch = (): PageFetcher => {
  // Lazy import avoids a circular reference when this file is imported from
  // the worker entrypoint and avoids pulling the safe-fetch module into tests
  // that exercise `runScan` directly with a `PageFetcher` fake.
  return {
    async fetch(url) {
      const { fetchBoundedHtml } = await import("../services/safe-fetch");
      const result = await fetchBoundedHtml({ url, resolve: resolvePublicAddresses });
      return { status: result.status, html: result.bytes };
    },
  };
};

/** Resolve both address families without trusting the address returned by the
 * platform fetch. The URL policy still rejects private/loopback answers. */
const resolvePublicAddresses = async (hostname: string): Promise<readonly string[]> => {
  const answers = await Promise.all(
    (["A", "AAAA"] as const).map(async (type) => {
      const endpoint = new URL("https://cloudflare-dns.com/dns-query");
      endpoint.searchParams.set("name", hostname);
      endpoint.searchParams.set("type", type);
      const response = await fetch(endpoint, {
        headers: { accept: "application/dns-json" },
      });
      if (!response.ok) throw new Error(`dns-over-https returned ${response.status}`);
      const body: { Answer?: Array<{ type: number; data: string }> } = await response.json();
      return (body.Answer ?? [])
        .filter((answer) => (type === "A" ? answer.type === 1 : answer.type === 28))
        .map((answer) => answer.data);
    }),
  );
  return answers.flat();
};

const makeWorkflowEvaluator = (env: ScanWorkflowEnv): ScanRunDeps["evaluate"] => {
  const legalRepo = new LegalRepository(env.DB);
  const aiBinding = env.AI;
  const vectorIndex = env.LEGAL_INDEX;

  return async (input): Promise<EvaluateOutcome> => {
    const { scanId, jurisdiction, category, pages, coverage } = input;

    // 1. Extract text evidence and deterministic service signals from every fetched page.
    const evidence: EvidenceItem[] = [];
    const serviceSignals: ServiceSignal[] = [];
    const pageHtml: Array<{ url: string; html: string }> = [];
    for (const page of pages) {
      if (page.status < 200 || page.status >= 300) continue;
      try {
        const html = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(page.html);
        pageHtml.push({ url: page.url, html });
        evidence.push(...extractEvidence({ sourceUrl: page.url, html }));
        serviceSignals.push(...detectServiceSignals({ sourceUrl: page.url, html }));
      } catch (cause) {
        // sanitizePageText may throw SanitizationError; we log and continue.
        console.log(
          JSON.stringify({
            level: "warn",
            event: "evidence.extract_failed",
            scanId,
            pageType: page.type,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    }

    // 2. Inspect referenced assets and resolve license requirements. Registry
    //    adapters are optional; absent adapters deliberately produce a strict
    //    high-risk signal rather than claiming a license was verified.
    const assetFetcher: AssetFetcher = {
      fetch: async (url) => {
        const { fetchBoundedResource } = await import("../services/safe-fetch");
        const result = await fetchBoundedResource({ url, resolve: resolvePublicAddresses });
        return {
          status: result.status,
          bytes: result.bytes,
          contentType: result.contentType,
          finalUrl: result.finalUrl,
        };
      },
    };
    const assetCollections = [];
    for (const page of pageHtml) {
      assetCollections.push(
        await collectDigitalAssets({ sourceUrl: page.url, html: page.html, fetcher: assetFetcher }),
      );
    }
    const assets = assetCollections.flatMap((collection) => collection.assets);
    const assetFindings = assetCollections.flatMap((collection) => collection.findings);
    const assetSeen = new Set<string>();
    const dedupedAssets = assets.filter((asset) => {
      if (assetSeen.has(asset.id)) return false;
      assetSeen.add(asset.id);
      return true;
    });
    const dedupedFindings = assetFindings.filter(
      (finding, index, all) => all.findIndex((candidate) => candidate.id === finding.id) === index,
    );
    const fontInventory = groupAssetsIntoFamilies(dedupedAssets, pageHtml[0]?.html ?? "");
    const assetInventory = {
      assets: dedupedAssets,
      findings: dedupedFindings,
      summary: {
        total: dedupedAssets.length,
        byKind: dedupedAssets.reduce<Record<string, number>>((counts, asset) => {
          counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
          return counts;
        }, {}),
        flagged: dedupedFindings.length,
      },
      fontInventory,
    };
    const licenseClaims = evidence
      .filter((item) => item.type === "license_claim")
      .map((item) => ({ value: item.value, evidenceId: item.id, sourceUrl: item.sourceUrl }));
    const licenseChecks = evaluateLicenseRequirements({
      jurisdiction,
      category,
      signals: serviceSignals,
      licenseClaims,
      registry: await new InMemoryLicenseRegistry().lookup({
        jurisdiction,
        licenseType: "online_game",
      }),
      on: new Date().toISOString().slice(0, 10),
    });

    // 3. Deterministic rubric: filter out rules whose evidence type doesn't
    //    appear at all. runRules already applies coverage semantics
    //    (`present` / `absent` / `unknown`) per the rubric.
    const ruleResults = runRules({
      scanId,
      jurisdiction,
      category,
      coverage,
      evidence,
    });

    // 3. Build the on-date (YYYY-MM-DD) used by retrieval + verifier.
    const on = new Date().toISOString().slice(0, 10);

    // 4. For rules whose outcome is `unknown` (or any rule that needs
    //    RAG-confirmation), call the LLM with retrieved legal provisions.
    //    We only spin up the AI/Vectorize dependencies if we actually need
    //    them — most rule outcomes are already decided by the rubric.
    const findings: ReportFinding[] = [];
    for (const check of licenseChecks) {
      findings.push({
        id: check.id,
        severity: check.severity,
        rationale: check.rationale,
        confidence: check.confidence,
        evidenceIds:
          check.evidenceIds.length > 0 ? [...check.evidenceIds] : [`${check.id}::missing`],
        citations: [...check.citations],
        recommendedAction: check.recommendedAction,
        applicability: "current",
        domain: "license",
        evidenceExcerpt:
          check.evidenceIds.length > 0
            ? (evidence.find((item) => item.id === check.evidenceIds[0])?.excerpt ?? "")
            : "Chưa tìm thấy bằng chứng giấy phép.",
      });
    }
    for (const assetFinding of assetInventory.findings) {
      const asset = assetInventory.assets.find(
        (candidate) => candidate.id === assetFinding.assetId,
      );
      findings.push({
        id: assetFinding.id,
        severity: assetFinding.severity,
        rationale: assetFinding.rationale,
        confidence: assetFinding.confidence,
        evidenceIds: assetFinding.evidenceIds,
        citations: assetFinding.citations,
        recommendedAction: assetFinding.recommendedAction,
        applicability: assetFinding.applicability,
        domain: assetFinding.domain,
        evidenceExcerpt: asset ? `${asset.kind} · ${asset.url} · ${asset.licenseEvidence}` : "",
      });
    }
    const needsRag = ruleResults.some((r) => r.outcome === "unknown");
    const retrievalDeps: RetrievalDeps | null =
      needsRag && aiBinding && vectorIndex
        ? {
            legal: legalRepo,
            vector: vectorIndex as unknown as RetrievalDeps["vector"],
            embed: (text: string) =>
              embedTextAi(text, { ai: aiBinding, gateway: { id: "safelaunch-mvp" } }).then(
                (r) => r.vector,
              ),
          }
        : null;

    for (const rule of ruleResults) {
      // The typed license check above replaces the legacy game-license rule so
      // a scan emits one actionable license result rather than two duplicates.
      if (rule.ruleId === "license-claim-game") continue;
      if (rule.outcome === "present") {
        findings.push({
          id: `${rule.ruleId}::pass`,
          severity: "pass",
          rationale: rule.rationale,
          confidence: 1,
          evidenceIds: [...rule.evidenceIds],
          citations: rule.citations.map(
            (c: { provisionId: string; source: string; url?: string; excerpt: string }) => ({
              provisionId: c.provisionId,
              source: c.source,
              url: c.url ?? c.source,
              retrievedAt: on,
              excerpt: c.excerpt,
            }),
          ),
          recommendedAction: "Đã đáp ứng yêu cầu.",
          applicability: rule.applicability,
        });
        continue;
      }
      if (rule.outcome === "absent") {
        findings.push({
          id: `${rule.ruleId}::absent`,
          severity: "high",
          rationale: rule.rationale,
          confidence: 1,
          evidenceIds: [...rule.evidenceIds],
          citations: rule.citations.map(
            (c: { provisionId: string; source: string; url?: string; excerpt: string }) => ({
              provisionId: c.provisionId,
              source: c.source,
              url: c.url ?? c.source,
              retrievedAt: on,
              excerpt: c.excerpt,
            }),
          ),
          recommendedAction: "Bổ sung trước khi ra mắt.",
          applicability: rule.applicability,
        });
        continue;
      }
      // outcome === "unknown" → RAG
      if (!retrievalDeps || !aiBinding) {
        // No AI/Vectorize bindings configured — fall back to review.
        findings.push({
          id: `${rule.ruleId}::unknown`,
          severity: "review",
          rationale: `Bằng chứng chưa đủ để kết luận: ${rule.rationale}`,
          confidence: 0,
          evidenceIds: [...rule.evidenceIds],
          citations: [],
          recommendedAction: "Yêu cầu chuyên gia xem xét thủ công.",
          applicability: rule.applicability,
        });
        continue;
      }

      // Pick the evidence item(s) most relevant to this rule. If the rule
      // produced no evidence ids (because pages failed to load), we use
      // any privacy/contact evidence we have as a fallback anchor.
      const candidates =
        rule.evidenceIds.length > 0
          ? evidence.filter((e) => rule.evidenceIds.includes(e.id))
          : evidence;

      for (const ev of candidates.length > 0 ? candidates : evidence.slice(0, 1)) {
        try {
          const retrieval = await retrieveLegalContext(
            { jurisdiction, category, on, text: ev.excerpt },
            retrievalDeps,
          );

          const provider = createEvaluationProvider({
            ai: aiBinding,
            gateway: { id: "safelaunch-mvp" },
          });

          const draft = await evaluateEvidenceProvisionPair({
            evidence: ev,
            retrieval,
            category,
            provider: {
              evaluate: async (pi: {
                websiteContent: string;
                category: string;
                systemRules?: string;
              }) => {
                const result = await provider(pi);
                return result.draft;
              },
            },
          });

          // Build the provision-text map so verifyFinding can confirm
          // each legalQuote is a substring of the cited provision.
          const retrievalText = new Map<string, string>();
          for (const r of retrieval as readonly {
            provisionId: string;
            documentId: string;
            source: string;
            title: string;
            effectiveFrom: string | null;
            effectiveTo: string | null;
            score: number;
          }[]) {
            // We need the full provision text; the retrieval metadata only
            // carries ids. Re-query the repository for each provision id.
            const provision = await legalRepo
              .listRetrievable({ jurisdiction, category, on })
              .then((all) => all.find((p) => p.id === r.provisionId));
            if (provision) retrievalText.set(r.provisionId, provision.text);
          }

          const verified = verifyFinding(
            draft,
            {
              jurisdiction,
              category,
              rubricVersion: RUBRIC_VERSION,
              highRiskConfidenceThreshold: 0.7,
              evidence: [ev],
              retrieval,
              retrievalText,
            },
            on,
          );

          findings.push({
            id: `${rule.ruleId}::${ev.id}`,
            severity: verified.severity,
            rationale: verified.rationale,
            confidence: verified.confidence,
            evidenceIds: [...verified.evidenceIds],
            citations: [...verified.citations],
            recommendedAction: verified.recommendedAction,
            applicability: verified.applicability,
          });
        } catch (cause) {
          findings.push({
            id: `${rule.ruleId}::error`,
            severity: "review",
            rationale: `Không thể xác minh tự động (${cause instanceof Error ? cause.message : String(cause)}). ${rule.rationale}`,
            confidence: 0,
            evidenceIds: [...rule.evidenceIds],
            citations: [],
            recommendedAction: "Yêu cầu chuyên gia xem xét thủ công.",
            applicability: rule.applicability,
          });
        }
      }
    }

    // 5. Aggregate: any current "high" → high_risk; any current "review" or
    //    partial coverage → needs_review; otherwise → no_significant_risk.
    const complete = coverage.failed.length === 0;
    const status = aggregateFindings(findings, { complete });

    console.log(
      JSON.stringify({
        level: "info",
        event: "scan.evaluated",
        scanId,
        findingsCount: findings.length,
        status,
        coverageComplete: complete,
      }),
    );

    return { status, findings, serviceSignals, licenseChecks, assetInventory };
  };
};

export const SCAN_WORKFLOW_NAME = "scan-workflow";
