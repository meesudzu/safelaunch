import type { EvidenceItem } from "@safelaunch/contracts";
import { EvaluationDraftSchema, type EvaluationDraft } from "@safelaunch/compliance-core";
import { SYSTEM_RULES, type ProviderInput } from "./provider";
import type { RetrievalResult } from "./retrieval";

/**
 * Evaluate a single evidence + retrieval pair.
 *
 * The orchestrator delegates the AI call to an `EvaluationProvider` so the
 * same orchestration logic can be unit-tested without Cloudflare Workers AI.
 *
 * Prompt-injection safety: website content is wrapped in
 * `<untrusted_website_content>` tags so the model treats it as data, not
 * instructions. Any directive inside the content that tries to override
 * the system rules is ignored.
 */

export interface EvaluationProvider {
  evaluate(input: ProviderInput & { systemRules: string }): Promise<EvaluationDraft>;
}

export interface EvaluateInput {
  readonly evidence: EvidenceItem;
  readonly retrieval: readonly RetrievalResult[];
  readonly category: "online_game" | "electronic_press" | "digital_entertainment";
  readonly provider: EvaluationProvider;
  readonly now?: () => string;
}

const FALLBACK_REVIEW_RATIONALE =
  "Không thể trích xuất đánh giá có cấu trúc (invalid output) từ mô hình; cần chuyên gia xem xét lại.";

export const evaluateEvidenceProvisionPair = async (
  input: EvaluateInput,
): Promise<EvaluationDraft> => {
  const promptInput: ProviderInput = {
    websiteContent: input.evidence.excerpt,
    category: input.category,
  };
  const providerInput = { ...promptInput, systemRules: SYSTEM_RULES };
  let raw: EvaluationDraft;
  try {
    raw = await input.provider.evaluate(providerInput);
  } catch (cause) {
    if (cause instanceof Error) {
      return fallbackReviewDraft(cause.message);
    }
    return fallbackReviewDraft("unknown provider error");
  }
  // Schema validation as a defensive belt-and-suspenders check.
  const parsed = EvaluationDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return fallbackReviewDraft(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  // Belt-and-suspenders: high-severity claims must have at least one legal
  // quote. If the provider slipped one through, downgrade here so the
  // verifier never sees an unsupported high-risk claim.
  if (parsed.data.severity === "high" && parsed.data.legalQuotes.length === 0) {
    return { ...parsed.data, severity: "review" };
  }
  return parsed.data;
};

const fallbackReviewDraft = (reason: string): EvaluationDraft => ({
  severity: "review",
  rationale: `${FALLBACK_REVIEW_RATIONALE} (Lý do: ${reason})`,
  evidenceIds: [],
  provisionIds: [],
  legalQuotes: [],
  confidence: 0,
  recommendedAction: "Yêu cầu chuyên gia xem xét thủ công.",
});

export type { EvaluationDraft } from "@safelaunch/compliance-core";
