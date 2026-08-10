---
title: Scan API Progress Visibility
date: 2026-08-05
status: approved
owner: fullstack
project: SafeLaunch
related:
  - docs/superpowers/specs/2026-08-04-scan-workflow-step-graph-design.md
  - docs/superpowers/specs/2026-08-05-scan-flow-simplification-design.md
  - apps/workers/src/routes/scans.ts
  - apps/workers/src/workflows/scan-workflow.ts
  - apps/workers/src/workflows/scan-workflow.phases.ts
  - apps/web/src/components/scan-progress.tsx
  - apps/web/src/components/scan-stepper.tsx
  - apps/web/src/lib/api-client.ts
  - packages/contracts/src/scan.ts
---

# Scan API Progress Visibility

## 1. Background

User report (2026-08-05, screenshots at `~/Desktop/Screenshot 2026-08-05 at 15.09.24.png` and
`~/Library/.../NSIRD_screencaptureui_LQHmA2/Screenshot 2026-08-05 at 15.09.41.png`):

- The Cloudflare dashboard for instance `945586a0-4020-4cb4-b45f-0cff086fd951` shows the
  `scan-workflow` with 4 steps completed (`parse-params-1`, `fetch:homepage-1`, `fetch:about-1`,
  `fetch:privacy-1`) and the next step (`phase-2:extract-evidence-1`) marked `Pending`.
- The companion `GET /v1/scans/<id>` API call returns
  `{ state: "queued", coverage: { fetched: [], failed: [], skipped: [] } }` even though the
  workflow has visibly progressed past the queued state.
- The web client polls the API and uses the returned `state` to drive the `ScanStepper` UI;
  because the API keeps saying `queued`, the stepper UI stays pinned to step 1 (`queued`)
  for the entire run, so the user sees no progress indication despite the workflow moving
  along.

Two related root causes:

1. **The `scans` table only stores `state = 'queued'` at insert time and is updated to a
   terminal state (`completed`/`partial`/`failed`) only inside `phase-10:persist-terminal`.
   No intermediate write happens.** Result: until the workflow reaches `phase-10`, the API
   always reads `state = 'queued'` and `coverage_json = '{}'`.

2. **`phase-2:extract-evidence` has no retry/timeout configuration.** On a large HTML page
   (e.g. dantri.com.vn, which routinely exceeds 300 KB after sanitization) the
   `extractEvidence` loop is CPU-bound and can blow the Worker CPU budget. The default
   retry policy retries 5 times with exponential backoff (~31 s of delays + each attempt's
   own budget), so the step sits in `Pending` for several minutes before either retrying
   or failing the whole scan. The dashboard's "Pending" pill for phase-2 in the screenshot
   matches this state.

## 2. Goals (in scope)

- `G1` `GET /v1/scans/:id` returns the workflow's **current** `state`, including the
  intermediate values defined in `ScanState` (`queued`, `fetching`, `extracting`,
  `evaluating`, `reporting`).
- `G2` The workflow persists the new `state` at three boundaries so the polling UI can
  render step-level progress:
  - after all `fetch:*` step boundaries -> `extracting`
  - after `phase-5:classify-asset-rights` -> `evaluating`
  - after `phase-8:aggregate` -> `reporting`
- `G3` A CPU-budget or step-timeout failure on `phase-2:extract-evidence` does **not**
  stall the workflow. The step is wrapped with the same `runStepWithFallback` helper
  used for `phase-4` and `phase-5`, with a sensible fallback (empty evidence + empty
  pages) and `degradedPhases` flagged.
- `G4` No DB schema change. No coverage shape change. The new `state` writes only touch
  the existing `state` column; `coverage_json` stays as the persisted snapshot from the
  terminal phase (so the API's coverage contract is unchanged).
- `G5` The `Coverage` returned by the API continues to be the canonical
  `{ fetched, failed, skipped }` shape; `degradedPhases` is not surfaced through the
  public API (it lives only on the persisted report payload).
- `G6` TDD: each new behavior is covered by a unit or behavioral test. Existing tests
  keep passing.
- `G7` No PII or compliance claim enters the new log entries.
- `G8` No scoring rubric, prompt, or retrieval change. `packages/compliance-core/` and
  `packages/ai/` are untouched.

## 3. Non-goals (out of scope)

- `N1` Switching the API to query the Cloudflare Workflow binding directly
  (`SCAN_WORKFLOW.get(scanId).status()`) and infer `state` from that. Deferred -- would
  couple the route handler to a runtime-only binding and require passing the scan id as
  the workflow instance id.
- `N2` Surfacing `degradedPhases` through the public `ScanCoverage` contract.
  `degradedPhases` stays in the persisted report payload (visible to the report page)
  and in workflow logs (visible to operators); the public API remains compatible with
  older clients.
- `N3` Adding a new `ScanState` value for "degraded" or "partial-extract". Existing
  `ScanState` enum values cover the user-facing steps; partial status is communicated
  through the terminal `state: "partial"` after the workflow completes.
- `N4` Replacing the per-step retry policy with a global workflow-level timeout. The
  per-step policy is already the runtime's recommended pattern.

## 4. Architecture

### 4.1 Backend (`apps/workers`)

```
src/workflows/
  - scan-workflow.phases.ts        # +persistProgressPhase
  - scan-workflow.ts               # call sites at phase boundaries; wrap phase-2
src/routes/
  - scans.ts                       # unchanged: still reads scans.state and
                                   # normalizeCoverage(stored.coverage)
```

- New helper `persistProgressPhase` in `scan-workflow.phases.ts`. Mirrors the existing
  `persistTerminalPhase` but writes **only** the `state` column so the in-flight
  `coverage_json` snapshot is preserved (the terminal phase owns the final coverage).
  Type-safe `state` is the existing `ScanState` enum from
  `packages/contracts/src/scan.ts`.

- `scan-workflow.ts` (WorkflowEntrypoint) calls `persistProgressPhase` at three new
  boundaries:
  - After the `perPageResults` are computed and the consolidated `coverage` is built
    but before `phase-2:extract-evidence` runs -> state `"extracting"`.
  - After `phase-5:classify-asset-rights` (and any `degradedPhases` push) but before
    `phase-6:evaluate-license` -> state `"evaluating"`.
  - After `phase-8:aggregate` but before `phase-9:persist-report` -> state `"reporting"`.

  Each call is wrapped in its own `step.do("phase-N:publish-progress", ...)` so the
  dashboard Graph renders the publish step as a discrete node. Publishing is best-effort:
  a transient D1 failure does **not** abort the workflow (the runStepWithFallback helper
  is reused with an empty fallback).

- `phase-2:extract-evidence` is wrapped with `runStepWithFallback`:
  ```
  fallback: { evidence: [], pages: [] },
  config: { retries: { limit: 1, delay: 5_000, backoff: "constant" }, timeout: "1 minute" },
  ```
  The fallback returns the empty `EvidenceExtractionResult` so downstream phases can
  proceed. The `degradedPhases` flag is set so operators can spot the scan in
  observability.

### 4.2 No DB / no migrations

The `scans` table already has the `state TEXT NOT NULL DEFAULT 'queued'` column. The
progress writes use the existing column. `coverage_json` is left alone (still owned by
the terminal phase).

### 4.3 Frontend (no changes required)

- `apps/web/src/components/scan-progress.tsx` already polls `/v1/scans/:id` and renders
  the returned `state` through the `ScanStepper`. The new intermediate states
  (`extracting`, `evaluating`, `reporting`) are already in the `ScanStepKey` union
  (`"queued" | "fetching" | "extracting" | "evaluating" | "reporting"`) -- the
  `SCAN_PIPELINE` constant -- and the per-state labels (`state.extracting`,
  `state.evaluating`, `state.reporting`) already exist in the locale message bundles.
  No frontend code change is required for `G1`/`G2`.
- `apps/web/src/lib/api-client.ts`'s `ScanProgress.state` is already typed as `string`,
  so non-terminal states pass through.

## 5. Data flow

```
POST /v1/scans
  -> DB row created with state='queued', coverage_json='{}'
  -> workflow.create({ params })

workflow:
  parse-params                (state stays 'queued' -- DB not touched)
  fetch:*                     (state stays 'queued' -- DB not touched)
  publish-progress(state=extracting)
  phase-2:extract-evidence    (wrapped with fallback)
  phase-3..phase-5
  publish-progress(state=evaluating)
  phase-6..phase-8
  publish-progress(state=reporting)
  phase-9:persist-report
  phase-10:persist-terminal   (state -> completed|partial|failed, coverage_json final)

GET /v1/scans/:id              (every poll)
  -> reads scans.state          -> returns whatever the workflow last published
  -> reads scans.coverage_json  -> returns the canonical { fetched, failed, skipped }
```

## 6. Error handling

- Progress write fails transiently (D1 cold start): the `runStepWithFallback` wrapper
  converts it to an empty result and a `scan.step_fallback` log line. The workflow
  continues. Worst case: the API still returns the previous state; the scan completes
  successfully when phase-10 writes the terminal state. No user impact.
- Progress write fails non-transiently (column missing, etc.): the wrapper still
  converts it. The workflow continues. Operators see `scan.step_fallback` in logs.
- Phase-2 CPU timeout: fallback returns empty evidence. The scan reaches phase-10 and
  is marked `partial` with `degradedPhases: ["phase-2:extract-evidence"]` in the
  report payload. The user sees a partial report explaining no evidence was extracted.

## 7. Test plan

| File                                                    | New / Update | Case                                                                 |
| ------------------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| apps/workers/src/workflows/scan-workflow.phases.test.ts | NEW          | persistProgressPhase updates state without touching coverage_json    |
| apps/workers/src/workflows/scan-workflow.phases.test.ts | NEW          | persistProgressPhase logs scan.progress_persisted with the new state |
| apps/workers/src/workflows/scan-workflow.test.ts        | NEW          | runScan publishes intermediate progress at phase boundaries          |
| apps/workers/src/workflows/scan-workflow.test.ts        | NEW          | runScan tolerates a phase-2 CPU-timeout via the fallback helper      |
| apps/workers/src/routes/scans.test.ts                   | NEW          | GET /v1/scans/:id surfaces the live in-progress state from the DB    |

## 8. Compliance checklist (per safelaunch-compliance)

- [x] No compliance claim or scoring rubric change.
- [x] No new PII in logs (the new event name scan.progress_persisted carries only
      scanId and state, both already in existing log lines).
- [x] Affected jurisdictions unchanged (VN only).
- [x] Tests cover the helper and the workflow emit at every boundary.

## 9. Rollout

- Merge to main via PR. No feature flag (the new state values are already in the
  public ScanState enum and the UI's SCAN_PIPELINE; the route just starts emitting
  them).
- Watch for any scan.step_fallback log entries during the first day to detect
  progress-write transient failures on real workloads.

## 10. Future work

- Consider lifting the runStepWithFallback usage to also wrap the per-step
  publish-progress calls inside the existing fallback helper rather than introducing
  a new wrapper. Deferred until we have more than two failure classes.
- Add a ScanState-level "live progress" API that joins the Cloudflare Workflow
  binding status with the DB row (deferred per N1).
