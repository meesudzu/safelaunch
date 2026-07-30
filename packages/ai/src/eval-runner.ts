/**
 * Legal-evaluation release gates.
 *
 * The MVP ships a fixed benchmark set under `tests/evals/cases/*.json`.
 * Each case describes a Vietnamese website with a known expected
 * severity, the provision IDs the model is allowed to cite, and the
 * exact excerpt the citation should contain. Two human reviewers sign
 * off every case before it lands in the set.
 *
 * `evaluateAll(cases, systemUnderTest)` runs the suite and produces:
 *  - `citationValidity`: fraction of model citations that point to an
 *    allowed provision AND whose quote is a substring of that provision's
 *    text.
 *  - `highRiskPrecision`: precision of the `high` severity class
 *    (true_positive / (true_positive + false_positive)).
 *  - `unsupportedHighRisk`: count of `high` predictions that cite zero
 *    allowed provision IDs.
 *  - `confusionMatrix`: {tp, fp, tn, fn} for the high class.
 *  - `byCategory`: precision per category.
 *  - `byLanguage`: precision per language.
 *  - `changedCases`: count of cases whose expected differs from the
 *    baseline file (if provided).
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["online_game", "electronic_press", "digital_entertainment"]),
  language: z.enum(["vi", "en"]),
  input: z.object({
    url: z.string().url(),
    evidence: z.string().min(1),
  }),
  expected: z.object({
    severity: z.enum(["high", "review", "pass"]),
    provisionIds: z.array(z.string().min(1)),
    citationExcerpts: z.array(z.string().min(1)),
  }),
  reviewer: z.string().min(1),
  reviewDate: z.string().min(1),
  rationale: z.string().min(1),
  disputed: z
    .object({
      reviewer: z.string().min(1),
      reviewDate: z.string().min(1),
      notes: z.string().min(1),
    })
    .optional(),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalDraftSchema = z.object({
  severity: z.enum(["high", "review", "pass"]),
  rationale: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  provisionIds: z.array(z.string().min(1)),
  legalQuotes: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  recommendedAction: z.string().min(1),
});

export type EvalDraft = z.infer<typeof EvalDraftSchema>;

export interface EvalProvision {
  readonly id: string;
  readonly text: string;
}

export interface SystemUnderTest {
  evaluate(input: { url: string; evidence: string; caseId: string }): Promise<EvalDraft>;
}

export interface ConfusionMatrix {
  readonly tp: number;
  readonly fp: number;
  readonly tn: number;
  readonly fn: number;
}

export interface EvalMetrics {
  readonly totalCases: number;
  readonly confusionMatrix: ConfusionMatrix;
  readonly citationValidity: number;
  readonly highRiskPrecision: number;
  readonly unsupportedHighRisk: number;
  readonly byCategory: Record<string, { total: number; correct: number; precision: number }>;
  readonly byLanguage: Record<string, { total: number; correct: number; precision: number }>;
  readonly changedCases: number;
}

export const RELEASE_GATES = {
  citationValidity: 1.0,
  highRiskPrecision: 0.9,
  unsupportedHighRisk: 0,
  p95LatencyMs: 60_000,
} as const;

export interface ReleaseGateResult {
  readonly pass: boolean;
  readonly failures: readonly string[];
}

export const evaluateReleaseGates = (metrics: EvalMetrics): ReleaseGateResult => {
  const failures: string[] = [];
  if (metrics.citationValidity < RELEASE_GATES.citationValidity) {
    failures.push(
      `citationValidity ${metrics.citationValidity.toFixed(3)} < ${RELEASE_GATES.citationValidity}`,
    );
  }
  if (metrics.highRiskPrecision < RELEASE_GATES.highRiskPrecision) {
    failures.push(
      `highRiskPrecision ${metrics.highRiskPrecision.toFixed(3)} < ${RELEASE_GATES.highRiskPrecision}`,
    );
  }
  if (metrics.unsupportedHighRisk > RELEASE_GATES.unsupportedHighRisk) {
    failures.push(
      `unsupportedHighRisk ${metrics.unsupportedHighRisk} > ${RELEASE_GATES.unsupportedHighRisk}`,
    );
  }
  return { pass: failures.length === 0, failures };
};

const isCitationValid = (
  draft: EvalDraft,
  expected: EvalCase["expected"],
  provisions: readonly EvalProvision[],
): boolean => {
  if (draft.provisionIds.length === 0) return false;
  for (const id of draft.provisionIds) {
    if (!expected.provisionIds.includes(id)) return false;
    const provision = provisions.find((p) => p.id === id);
    if (!provision) return false;
    const matched = draft.legalQuotes.some((quote) => provision.text.includes(quote));
    if (!matched) return false;
  }
  return true;
};

export const loadCases = async (dir: string): Promise<readonly EvalCase[]> => {
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
  const files = await readdir(dir);
  const cases: EvalCase[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const raw = await readFile(join(dir, file), "utf8");
    const parsed = EvalCaseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Invalid eval case ${file}: ${parsed.error.message}`);
    }
    cases.push(parsed.data);
  }
  return cases;
};

export interface EvaluateAllOptions {
  readonly provisions: readonly EvalProvision[];
  readonly baseline?: readonly EvalCase[];
}

export const evaluateAll = async (
  cases: readonly EvalCase[],
  system: SystemUnderTest,
  options: EvaluateAllOptions,
): Promise<EvalMetrics> => {
  const matrix: ConfusionMatrix = { tp: 0, fp: 0, tn: 0, fn: 0 };
  let citationValidCount = 0;
  let unsupported = 0;
  const byCategory = new Map<string, { total: number; correct: number }>();
  const byLanguage = new Map<string, { total: number; correct: number }>();
  let changed = 0;

  for (const c of cases) {
    const draft = await system.evaluate({
      url: c.input.url,
      evidence: c.input.evidence,
      caseId: c.id,
    });
    if (isCitationValid(draft, c.expected, options.provisions)) {
      citationValidCount += 1;
    }
    const predictedHigh = draft.severity === "high";
    const expectedHigh = c.expected.severity === "high";
    if (predictedHigh && expectedHigh) matrix.tp += 1;
    else if (predictedHigh && !expectedHigh) matrix.fp += 1;
    else if (!predictedHigh && expectedHigh) matrix.fn += 1;
    else matrix.tn += 1;
    if (predictedHigh) {
      const citesExpected = c.expected.provisionIds.some((id) => draft.provisionIds.includes(id));
      if (!citesExpected) unsupported += 1;
    }

    const catStats = byCategory.get(c.category) ?? { total: 0, correct: 0 };
    catStats.total += 1;
    if (draft.severity === c.expected.severity) catStats.correct += 1;
    byCategory.set(c.category, catStats);

    const langStats = byLanguage.get(c.language) ?? { total: 0, correct: 0 };
    langStats.total += 1;
    if (draft.severity === c.expected.severity) langStats.correct += 1;
    byLanguage.set(c.language, langStats);

    if (options.baseline) {
      const base = options.baseline.find((b) => b.id === c.id);
      if (base && JSON.stringify(base.expected) !== JSON.stringify(c.expected)) {
        changed += 1;
      }
    }
  }

  const total = cases.length;
  const safeRatio = (n: number, d: number): number => (d === 0 ? 1 : n / d);

  return {
    totalCases: total,
    confusionMatrix: matrix,
    citationValidity: safeRatio(citationValidCount, total),
    highRiskPrecision: safeRatio(matrix.tp, matrix.tp + matrix.fp),
    unsupportedHighRisk: unsupported,
    byCategory: Object.fromEntries(
      Array.from(byCategory.entries()).map(([k, v]) => [
        k,
        { total: v.total, correct: v.correct, precision: safeRatio(v.correct, v.total) },
      ]),
    ),
    byLanguage: Object.fromEntries(
      Array.from(byLanguage.entries()).map(([k, v]) => [
        k,
        { total: v.total, correct: v.correct, precision: safeRatio(v.correct, v.total) },
      ]),
    ),
    changedCases: changed,
  };
};
