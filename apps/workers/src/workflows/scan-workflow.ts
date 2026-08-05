import { z } from "zod";
import type {
  DigitalAsset,
  EvidenceItem,
  LicenseCheck,
  ReportFinding,
  ServiceSignal,
} from "@safelaunch/contracts";
import { extractEvidence } from "../services/evidence";
import {
  collectDigitalAssets,
  collectAssetReferences,
  type AssetFetcher,
  type AssetFinding,
  type AssetReference,
} from "../services/digital-assets";
import { detectServiceSignals } from "../services/service-signals";
import {
  evaluatePhase,
  fetchPhase,
  fetchSinglePagePhase,
  persistReportPhase,
  persistTerminalPhase,
  extractEvidencePhase,
  extractServiceSignalsPhase,
  collectAssetReferencesPhase,
  classifyAssetRightsPhase,
  evaluateLicenseRequirementsPhase,
} from "./scan-workflow.phases";
import { LegalRepository } from "@safelaunch/db";
import { EMPTY_DIGITAL_ASSET_COLLECTION, runStepWithFallback } from "./scan-workflow.steps";
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
  updateState: (input: {
    scanId: string;
    state: ScanTerminalState;
    coverage: ScanCoverage;
  }) => Promise<void>;
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
  };
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

/**
 * Heuristic: returns true when the evidence pages contain at least one
 * asset reference candidate (font preload, @font-face url, etc.) so we
 * can distinguish "page really has no assets" from "the loop died
 * before producing any output". Used only to flag a degraded phase, not
 * to change compliance findings.
 */
const pageHasAssetCandidates = (pages: ReadonlyArray<{ url: string; html: string }>): boolean => {
  for (const page of pages) {
    if (collectAssetReferences(page.url, page.html).length > 0) return true;
  }
  return false;
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

  const fetched: SupportedPageType[] = [];
  const failed: SupportedPageType[] = [];
  const skipped: SupportedPageType[] = [];
  const pages: Array<{ type: SupportedPageType; url: string; status: number; html: Uint8Array }> =
    [];

  // Always fetch homepage first.
  const homepage = await fetchWithRetries(deps.fetch, params.url, {
    pageType: "homepage",
    timeoutPages,
    retries: retryCount,
    backoffMs: retryBackoffMs,
  });

  if (!fetchResult.homepage.ok) {
    const coverage = buildCoverage([], ["homepage"], []);
    await deps.persistTerminalState?.({
      scanId: params.scanId,
      state: "failed",
      status: "needs_review",
      coverage,
    });
    await deps.updateState({ scanId: params.scanId, state: "failed", coverage });
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

  // A partial or failed scan must never be classified as no_significant_risk.
  let status: ScanTerminalStatus = evaluation.status;
  if (state !== "completed" && status === "no_significant_risk") {
    status = "needs_review";
  }

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
        assetInventory: evaluation.assetInventory,
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

  await deps.updateState({ scanId: params.scanId, state, coverage });

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
    // Graph. The runtime retries the closure on transient failure and memoizes
    // its return value so a partial failure does not replay earlier phases.
    const params: ScanWorkflowPayload = event.payload;
    return runScan(params, {
      fetch: makeWorkflowFetch(),
      evaluate: makeWorkflowEvaluator(this.env),
      persistReport: makeWorkflowPersistReport(this.env),
      now: () => new Date().toISOString(),
      log: (entry) =>
        console.log(JSON.stringify({ ...entry, scanId: params.scanId, source: "scan-workflow" })),
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
      const { resolveViaDoH } = await import("../services/dns-resolver");
      const result = await fetchBoundedHtml({ url, resolve: resolveViaDoH });
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
    const assetInventory = {
      assets: dedupedAssets,
      findings: assetFindings.filter(
        (finding, index, all) =>
          all.findIndex((candidate) => candidate.id === finding.id) === index,
      ),
      summary: {
        total: dedupedAssets.length,
        byKind: dedupedAssets.reduce<Record<string, number>>((counts, asset) => {
          counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
          return counts;
        }, {}),
        flagged: assetFindings.filter(
          (finding, index, all) =>
            all.findIndex((candidate) => candidate.id === finding.id) === index,
        ).length,
      },
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

    return { status, findings };
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

const makeWorkflowPersistReport = (env: ScanWorkflowEnv): ScanRunDeps["persistReport"] => {
  return async (input): Promise<{ token: string; url: string } | null> => {
    const tokenBytes = new Uint8Array(24);
    crypto.getRandomValues(tokenBytes);
    const token = `rpt_${Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
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

const makeWorkflowUpdateState = (env: ScanWorkflowEnv): ScanRunDeps["updateState"] => {
  return async (input): Promise<void> => {
    const { ScanRepository } = await import("@safelaunch/db");
    const repo = new ScanRepository(env.DB);
    await repo.updateState({
      id: input.scanId,
      state: input.state,
      coverage: input.coverage,
    });
  };
};

export const SCAN_WORKFLOW_NAME = "scan-workflow";
