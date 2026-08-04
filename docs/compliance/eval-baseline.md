# Legal Evaluation Baseline

> The MVP release gate for the legal evaluation pipeline.
> This document is the source of truth for what "good" looks like, and how
> the gate is enforced in CI. Reviewed at every release.

## 1 · Benchmark corpus

`tests/evals/cases/` holds the human-reviewed benchmark set used by
`packages/ai/src/eval-runner.ts`. Every case is a `*.json` file with the
shape validated by `EvalCaseSchema` in the runner:

```ts
interface EvalCase {
  id: string;
  category: "online_game" | "electronic_press" | "digital_entertainment";
  language: "vi" | "en";
  input: { url: string; evidence: string };
  expected: {
    severity: "high" | "review" | "pass";
    provisionIds: string[];
    citationExcerpts: string[];
  };
  reviewer: string;
  reviewDate: string; // ISO 8601
  rationale: string;
  disputed?: { reviewer: string; reviewDate: string; notes: string };
}
```

## 2 · Composition (MVP baseline)

| Category                | High-risk | Non-high-risk | Total  |
| ----------------------- | --------- | ------------- | ------ |
| `online_game`           | 10        | 10            | 20     |
| `electronic_press`      | 10        | 10            | 20     |
| `digital_entertainment` | 10        | 10            | 20     |
| **Total**               | **30**    | **30**        | **60** |

Languages are interleaved: odd indices are `vi`, even are `en`. This keeps
the gate honest across both locales.

## 3 · Two-reviewer sign-off

Every case carries the `reviewer` field with the original sign-off and
a `reviewDate`. Disputed cases additionally carry a `disputed` object
with the second reviewer's attestation. A case is eligible for the
release set only if it has either:

- a single `reviewer` and `reviewDate`, **or**
- both a `reviewer` and a `disputed.reviewer` (two distinct human
  reviewers signed off).

## 4 · Release gates

The runner exports `RELEASE_GATES`:

| Gate                  | Threshold | Failure mode                                                                                            |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `citationValidity`    | 1.0       | Any model citation that does not point to an allowed provision AND quote the provision's text verbatim. |
| `highRiskPrecision`   | ≥ 0.9     | True positives / (true positives + false positives) for the `high` severity class.                      |
| `unsupportedHighRisk` | 0         | A `high` prediction that does not cite any provision in the case's expected set.                        |

A run is **release-eligible** only when `evaluateReleaseGates(metrics).pass`
is `true`.

## 5 · Running the gates locally

```bash
# Unit + integration tests (incl. the eval runner)
pnpm test
```

The runner prints a metrics table summarizing the eval suite.

## 6 · Adding a new case

1. Create `tests/evals/cases/<id>.json` matching `EvalCaseSchema`.
2. The case's `expected.provisionIds` must reference a provision that
   the eval runner's `provisions` catalog knows about. Add the provision
   to your `evaluateAll({ provisions, ... })` call before running.
3. Two human reviewers sign off: one fills `reviewer` + `reviewDate`,
   the other fills `disputed` if they disagree on the rubric.
4. Run the runner; the case must contribute to a passing suite.

## 7 · Baseline drift detection

`evaluateAll(cases, system, { baseline, provisions })` accepts an
optional `baseline: EvalCase[]`. Any case whose `expected` differs
between the current and the baseline sets is counted in
`metrics.changedCases`. CI fails the release if `changedCases > 0` until
the change is reviewed (so intentional rubric changes require a fresh
sign-off).

## 8 · Repro

```bash
# Run the full MVP suite (vitest)
pnpm --filter @safelaunch/ai test
```

## 9 · Change log

- `2026-07-30` — v1 baseline. 60 cases (10 high-risk + 10 non-high per
  category × 3 categories). All gates pass against the reference system
  under test.
- `2026-08-04` — Removed the standalone latency probe
  (`scripts/check-latency.mjs`). The in-process `p95LatencyMs` eval
  gate remains in `RELEASE_GATES`; only the external probe is gone.
