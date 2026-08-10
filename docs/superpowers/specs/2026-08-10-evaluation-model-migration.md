# Evaluation model migration — design

> Authored 2026-08-10 in response to a Cloudflare AI Gateway 410 from
> staging: `@cf/meta/llama-3.1-8b-instruct` was deprecated on
> 2026-05-30. The operator's error message included the fragment
> `infire-llama-3.1-8b-instruct`; that prefix is not a Cloudflare model
> id — the real id is the bare `llama-3.1-8b-instruct` used in
> `packages/ai/src/provider.ts`.

## Problem

`packages/ai/src/provider.ts` hard-codes the evaluation model as
`@cf/meta/llama-3.1-8b-instruct`. Cloudflare retired that id on
2026-05-30, so every call routed through the AI Gateway now returns
HTTP 410 with `AiError { internalCode: 5028 }`. Downstream effect:

- The `ScanWorkflow`'s LLM-backed evaluation step (`scan-workflow.ts`
  line 1253) throws.
- `evaluateEvidenceProvisionPair` (`evaluate.ts`) catches the throw and
  downgrades the draft to a `review` fallback. Defensible for safety,
  but it tanks the `highRiskPrecision` gate in
  `packages/ai/src/eval-runner.ts` and surfaces a
  "Yêu cầu chuyên gia xem xét thủ công." even when the answer was
  derivable. UX regression and release blocker.

## Affected surfaces

| Path                          | What changes       |
| ----------------------------- | ------------------ |
| `packages/ai/src/provider.ts` | Default model id   |
| `packages/ai/src/index.ts`    | Re-export constant |
| `README.md`, `README.vi.md`   | Doc references     |
| `docs/remaining.md`           | Operational todo   |
| `apps/workers/dist/index.js`  | Regenerated bundle |

`apps/workers/dist/index.js` is a build artifact (rebuilt by
`wrangler deploy` / `pnpm -C apps/workers build`). We do not hand-edit
dist files.

## Choice of replacement model

| Candidate                                  | Verdict                                                                                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cf/meta/llama-3.2-3b-instruct`           | Cheap, drop-in family — but the failing gate is a quality problem, not a cost problem.                                                                                                                         |
| `@cf/meta/llama-3.2-1b-instruct`           | Too small for legal-text comprehension.                                                                                                                                                                        |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | **Selected.** 70B params for citation grounding; fp8-fast variant for low latency; listed in Cloudflare catalog (`worker-configuration.d.ts` line 10815); Llama 3.3 generation with strong Vietnamese support. |
| `@cf/meta/llama-4-scout-17b-16e-instruct`  | Newer, smaller, less proven for Vietnamese legal text.                                                                                                                                                         |

Decision: **`@cf/meta/llama-3.3-70b-instruct-fp8-fast`** as the
default. Consumers (workflow, future eval harness) can still override
via `createEvaluationProvider({ model })`.

## Compliance review (per `safelaunch-compliance`)

- [x] Every compliance claim still cites a source — provider contract
      unchanged; only model id swapped.
- [x] Multi-jurisdiction — unaffected.
- [x] Severity scoring explainable — unchanged (`evaluate.ts` keeps the
      same rationale/quote downgrade).
- [x] Privacy by design — no new data collection; same AI Gateway path.
- [x] AI-generated legal text still visually marked as AI-assisted
      downstream — UI marker unchanged.

## Verification plan

1. New unit test in `packages/ai/src/provider.test.ts`:
   - assert `DEFAULT_EVALUATION_MODEL` matches the documented catalog id
     and is not in a known-deprecated set.
2. `pnpm -r typecheck` — must succeed.
3. `pnpm -r test` — full vitest suite must stay green.
4. (Post-deploy) `wrangler tail` on staging — confirm `ai.run` no
   longer returns 410.
5. (Post-deploy) re-run the 60-case eval benchmark to confirm
   `highRiskPrecision >= 0.9` is still met with the new model.

## Out of scope

- Re-prompting `SYSTEM_RULES`. Prompt stays as-is.
- Changing the embedding model (`@cf/baai/bge-base-en-v1.5`) — confirmed
  still in catalog.
- Migration of older scan reports.
