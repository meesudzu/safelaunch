import type { RetrievableProvision } from "@safelaunch/db";
import type { RetrievalMeta } from "@safelaunch/compliance-core";

/**
 * Bounded hybrid retrieval for legal provisions.
 *
 * Metadata guards run BEFORE the vector ranking so that:
 *  - only approved provisions are considered;
 *  - only provisions applicable on the requested date are considered;
 *  - only provisions matching the jurisdiction + category are considered.
 *
 * Then we call Vectorize for semantic ranking, intersect with the
 * eligibility set, and cap the result at `limit` (default 6) so the AI
 * evaluator never receives an unbounded context window.
 */

export type SupportedCategory = "online_game" | "electronic_press" | "digital_entertainment";

export interface RetrievalQuery {
  readonly jurisdiction: string;
  readonly category: SupportedCategory;
  /** ISO-8601 timestamp; only provisions applicable on this date are eligible. */
  readonly on: string;
  readonly text: string;
}

export interface VectorMatch {
  readonly id: string;
  readonly score: number;
  readonly metadata?: Record<string, unknown>;
}

export interface RetrievalVectorIndex {
  query(
    vector: readonly number[],
    options: { topK: number; returnMetadata?: "all" | "indexed" | "none" },
  ): Promise<{ matches: readonly VectorMatch[]; count: number }>;
}

export interface RetrievalLegalRepository {
  listRetrievable(input: {
    jurisdiction: string;
    category: string;
    on: string;
  }): Promise<readonly RetrievableProvision[]>;
}

export interface RetrievalDeps {
  readonly legal: RetrievalLegalRepository;
  readonly vector: RetrievalVectorIndex;
  readonly embed: (text: string) => Promise<readonly number[]>;
  /** How many candidates to fetch from Vectorize before filtering. Default: 12. */
  readonly topK?: number;
  /** Hard cap on returned provisions per evidence topic. Default: 6. */
  readonly limit?: number;
}

export type RetrievalResult = RetrievalMeta;

const DEFAULT_TOP_K = 12;
const DEFAULT_LIMIT = 6;

export const retrieveLegalContext = async (
  query: RetrievalQuery,
  deps: RetrievalDeps,
): Promise<readonly RetrievalResult[]> => {
  const topK = deps.topK ?? DEFAULT_TOP_K;
  const limit = deps.limit ?? DEFAULT_LIMIT;

  // 1. Metadata guard — only approved + applicable provisions.
  const eligible = await deps.legal.listRetrievable({
    jurisdiction: query.jurisdiction,
    category: query.category,
    on: query.on,
  });
  if (eligible.length === 0) return [];

  const allowed = new Set<string>(eligible.map((provision) => provision.id));
  const byId = new Map<string, RetrievableProvision>(
    eligible.map((provision) => [provision.id, provision]),
  );

  // 2. Vector ranking — only the eligible set can win.
  const vector = await deps.embed(query.text);
  const response = await deps.vector.query(vector, { topK, returnMetadata: "all" });

  // 3. Filter + cap.
  const filtered: RetrievalResult[] = [];
  for (const match of response.matches) {
    if (!allowed.has(match.id)) continue;
    const provision = byId.get(match.id);
    if (!provision) continue;
    filtered.push({
      provisionId: provision.id,
      documentId: provision.documentId,
      source: provision.sourceUrl,
      title: provision.title,
      effectiveFrom: provision.effectiveFrom,
      effectiveTo: provision.effectiveTo,
      score: match.score,
    });
    if (filtered.length >= limit) break;
  }
  return filtered;
};
