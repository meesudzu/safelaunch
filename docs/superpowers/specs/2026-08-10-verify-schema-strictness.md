# Verifier schema strictness — design

> Authored 2026-08-10 in response to a production bug surfaced after the
> model swap (PR #38). The model now responds again, but for sites
> whose "about" page is unreachable the draft it returns contains empty
> citation arrays. The verifier's `EvaluationDraftSchema` requires
> `min(1)` on every citation array, so the draft is rejected; the
> workflow catch block then leaks the technical message
> `"Verifier schema violation: draft does not match EvaluationDraftSchema"`
> to the user-visible report.

## Problem (precise)

Three layered defects:

1. **Schema too strict.** `EvaluationDraftSchema` (in
   `packages/compliance-core/src/verify.ts`) enforces `min(1)` on
   `evidenceIds`, `provisionIds`, and `legalQuotes`. For
   `severity: "review"` and `severity: "pass"`, an empty array is the
   correct representation — there is no citation-grounded finding to
   produce. The schema conflates "high requires citation evidence"
   with "every draft requires citation evidence".

2. **Fallback is a type lie.** `fallbackReviewDraft` in
   `packages/ai/src/evaluate.ts:75` returns an `EvaluationDraft` with
   all three arrays empty. Its return type claims to satisfy the
   schema, but it cannot — `min(1)` rejects it. The downstream
   `verifyFinding` then throws `SchemaViolationError` on it.

3. **Technical error leaks to UI.** `apps/workers/src/workflows/scan-workflow.ts:1322`
   embeds `cause.message` verbatim in the user-facing rationale, so
   the report shows:
   > "Không thể xác minh tự động (Verifier schema violation: draft
   > does not match EvaluationDraftSchema). {rule.rationale}"
   > …instead of a clean "Không đủ bằng chứng để xác minh tự động".

## Affected surfaces

| Path                                          | What changes                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/compliance-core/src/verify.ts`      | `EvaluationDraftSchema` — replace `min(1)` on arrays with a `superRefine` that enforces `min(1)` only when `severity === "high"`. Update `verifyFinding` so the second-pass evidence/provision/quote checks are no-ops when the draft is empty and severity is `review`/`pass`.                                                                                     |
| `packages/compliance-core/src/verify.test.ts` | Add tests: (a) `severity: "review"` with empty arrays is accepted; (b) `severity: "high"` with empty arrays is still rejected; (c) `severity: "pass"` with empty arrays is accepted.                                                                                                                                                                                |
| `packages/ai/src/evaluate.ts`                 | `fallbackReviewDraft` now takes `EvidenceItem` and includes `evidence.id` in the fallback so the draft is at least evidence-grounded. Empty `provisionIds`/`legalQuotes` are now schema-legal under the loosened schema.                                                                                                                                            |
| `packages/ai/src/evaluate.test.ts`            | Add tests asserting (a) the fallback produced for an invalid provider output contains the input `evidence.id`, (b) the fallback has `severity: "review"`, (c) the fallback round-trips through the schema.                                                                                                                                                          |
| `apps/workers/src/workflows/scan-workflow.ts` | In the catch block, replace `cause.message` with a curated user-facing message keyed by error class: `SchemaViolationError` → "Không đủ bằng chứng để xác minh tự động"; `CitationVerificationError` → "Trích dẫn pháp lý không khớp với văn bản được duyệt"; unknown → "Lỗi kỹ thuật khi xác minh". The technical error remains in the workflow log for operators. |

## Compliance review (per `safelaunch-compliance`)

- [x] Citation contract preserved for `severity: "high"` (still
      requires ≥1 evidenceId, ≥1 provisionId, ≥1 legalQuote).
- [x] Multi-jurisdiction unaffected.
- [x] Severity scoring still explainable — the `high`→`review`
      downgrade path is unchanged; we only relax the _ungrounded_
      `review`/`pass` shape.
- [x] Privacy by design — no new data collection.
- [x] AI-assisted copy still visually marked as AI-assisted downstream.
- [x] New behavior encoded as tests (`verify.test.ts`,
      `evaluate.test.ts`) so future regressions are caught.
- [x] No rubric version bump needed — this is a contract
      clarification, not a rule change. Mention in the next release
      notes for traceability.

## Verification plan

1. New failing tests in `verify.test.ts`:
   - "review with empty arrays passes schema and verifier".
   - "pass with empty arrays passes schema and verifier".
   - "high with empty arrays still throws `SchemaViolationError`".
2. New failing tests in `evaluate.test.ts`:
   - "fallback contains the input evidence id".
   - "fallback severity is review".
   - "fallback round-trips through `EvaluationDraftSchema.safeParse`".
3. Updated scan-workflow catch test (or new one) asserting the
   user-facing message does not contain "Verifier schema violation".
4. `pnpm -r typecheck` — clean.
5. `pnpm -r test` — all 411 tests still pass plus the new ones.

## Out of scope

- Prompting the model to always return a citation. The 70B model
  returns empty arrays precisely when there is no citation-grounded
  finding — that is correct model behavior, not a bug.
- Restructuring the catch block to retry on verifier errors. The
  current "fall back to manual review" flow is the right safety net.
- Migration of historical reports. New scans will produce
  well-shaped findings; old reports with the technical-jargon
  rationale remain in D1 until the retention cron purges them.
