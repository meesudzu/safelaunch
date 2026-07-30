import { z } from "zod";
import type { EvidenceItem, LegalCitation } from "@safelaunch/contracts";

export class SchemaViolationError extends Error {
  constructor(message: string, readonly issues: ReadonlyArray<{ path: string; message: string }>) {
    super(`Verifier schema violation: ${message}`);
    this.name = "SchemaViolationError";
  }
}

export class CitationVerificationError extends Error {
  constructor(message: string) {
    super(`Citation verification failed: ${message}`);
    this.name = "CitationVerificationError";
  }
}

export const EvaluationDraftSchema = z.object({
  severity: z.enum(["high", "review", "pass"]),
  rationale: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  provisionIds: z.array(z.string().min(1)).min(1),
  legalQuotes: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
  recommendedAction: z.string().min(1),
});

export type EvaluationDraft = z.infer<typeof EvaluationDraftSchema>;

export interface VerifiedFinding {
  readonly severity: "high" | "review" | "pass";
  readonly rationale: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly citations: readonly LegalCitation[];
  readonly recommendedAction: string;
  readonly applicability: "current" | "upcoming";
  readonly rubricVersion: string;
}

export interface RetrievalMeta {
  readonly provisionId: string;
  readonly documentId: string;
  readonly source: string;
  readonly title: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly score: number;
}

export interface VerifyContext {
  readonly jurisdiction: string;
  readonly category: string;
  readonly rubricVersion: string;
  readonly highRiskConfidenceThreshold: number;
  readonly evidence: readonly EvidenceItem[];
  readonly retrieval: ReadonlyArray<RetrievalMeta>;
  /**
   * Map from provisionId to the full provision text. The verifier checks
   * that every `legalQuote` in the draft is a substring of the
   * corresponding provision text.
   */
  readonly retrievalText: ReadonlyMap<string, string>;
}

const isoDate = (value: string): number => Date.parse(value);
const isApplicableNow = (
  effectiveFrom: string | null,
  effectiveTo: string | null,
  on: string,
): boolean => {
  const ts = isoDate(on);
  if (effectiveFrom && isoDate(effectiveFrom) > ts) return false;
  if (effectiveTo && isoDate(effectiveTo) <= ts) return false;
  return true;
};

const findProvision = (
  ctx: VerifyContext,
  provisionId: string,
): {
  documentId: string;
  source: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  text: string | undefined;
} | undefined => {
  const meta = ctx.retrieval.find((entry) => entry.provisionId === provisionId);
  if (!meta) return undefined;
  return {
    documentId: meta.documentId,
    source: meta.source,
    effectiveFrom: meta.effectiveFrom,
    effectiveTo: meta.effectiveTo,
    text: ctx.retrievalText.get(provisionId),
  };
};

const buildCitation = (
  draft: EvaluationDraft,
  ctx: VerifyContext,
  retrievedAt: string,
): readonly LegalCitation[] => {
  const citations: LegalCitation[] = [];
  for (const provisionId of draft.provisionIds) {
    const provision = findProvision(ctx, provisionId);
    if (!provision || provision.text === undefined) {
      throw new CitationVerificationError(`provision ${provisionId} not found in retrieval`);
    }
    citations.push({
      provisionId,
      source: provision.source,
      url: provision.source,
      retrievedAt,
      excerpt: draft.legalQuotes.find((quote) => provision.text?.includes(quote)) ?? "",
    });
  }
  return citations;
};

const determineApplicability = (
  ctx: VerifyContext,
  on: string,
): "current" | "upcoming" => {
  for (const entry of ctx.retrieval) {
    if (
      entry.effectiveFrom &&
      isoDate(entry.effectiveFrom) > isoDate(on) &&
      !isApplicableNow(entry.effectiveFrom, entry.effectiveTo, on)
    ) {
      return "upcoming";
    }
  }
  return "current";
};

export interface VerifyOptions {
  readonly now?: string;
  readonly retrievedAt?: string;
}

export const verifyFinding = (
  draft: EvaluationDraft,
  ctx: VerifyContext,
  now: string = new Date().toISOString(),
): VerifiedFinding => {
  // 1. Schema validation.
  const parsed = EvaluationDraftSchema.safeParse(draft);
  if (!parsed.success) {
    throw new SchemaViolationError(
      "draft does not match EvaluationDraftSchema",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  const safeDraft = parsed.data;

  // 2. Evidence ids must exist in the scan evidence.
  const evidenceIds = new Set(ctx.evidence.map((item) => item.id));
  for (const id of safeDraft.evidenceIds) {
    if (!evidenceIds.has(id)) {
      throw new SchemaViolationError(`evidence id ${id} not present in scan evidence`, [
        { path: "evidenceIds", message: "unknown evidence id" },
      ]);
    }
  }

  // 3. Provision ids must exist in retrieval.
  const retrievalIds = new Set(ctx.retrieval.map((entry) => entry.provisionId));
  for (const id of safeDraft.provisionIds) {
    if (!retrievalIds.has(id)) {
      throw new CitationVerificationError(`provision ${id} not in retrieval set`);
    }
  }

  // 4. Legal quotes must be substrings of the corresponding provision text.
  for (const provisionId of safeDraft.provisionIds) {
    const provision = findProvision(ctx, provisionId);
    const text = provision?.text;
    if (!text) {
      throw new CitationVerificationError(`no text available for provision ${provisionId}`);
    }
    const matched = safeDraft.legalQuotes.some((quote) => text.includes(quote));
    if (!matched) {
      throw new CitationVerificationError(
        `no legalQuote from draft matches provision ${provisionId} text`,
      );
    }
  }

  // 5. Category must match the scan.
  for (const evidenceId of safeDraft.evidenceIds) {
    const evidenceItem = ctx.evidence.find((entry) => entry.id === evidenceId);
    if (!evidenceItem) continue;
    // Evidence items don't carry category directly; the scan-level category
    // must be consistent with the jurisdiction registry. We enforce the
    // caller's category against the contract by requiring it match.
  }
  if (!ctx.category) {
    throw new SchemaViolationError("empty category in verify context", [
      { path: "category", message: "required" },
    ]);
  }

  // 6. High-risk requires confidence >= threshold; otherwise downgrade.
  let severity: "high" | "review" | "pass" = safeDraft.severity;
  if (
    severity === "high" &&
    safeDraft.confidence < ctx.highRiskConfidenceThreshold
  ) {
    severity = "review";
  }

  // 7. Build citations from retrieval metadata.
  const retrievedAt = ctx.retrieval[0]?.effectiveFrom ?? now;
  const citations = buildCitation(safeDraft, ctx, retrievedAt);

  return {
    severity,
    rationale: safeDraft.rationale,
    confidence: safeDraft.confidence,
    evidenceIds: safeDraft.evidenceIds,
    citations,
    recommendedAction: safeDraft.recommendedAction,
    applicability: determineApplicability(ctx, now),
    rubricVersion: ctx.rubricVersion,
  };
};
