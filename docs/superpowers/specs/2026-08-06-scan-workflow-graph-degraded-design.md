---
title: Scan Workflow Graph — Fold Degraded-Detection Heuristic into Phase-4 Step
date: 2026-08-06
status: approved
owner: fullstack
project: SafeLaunch
related:
  - docs/superpowers/specs/2026-08-04-scan-workflow-step-graph-design.md
  - docs/superpowers/specs/2026-08-05-scan-flow-simplification-design.md
  - apps/workers/src/workflows/scan-workflow.ts
  - apps/workers/src/workflows/scan-workflow.steps.ts
  - apps/workers/src/services/digital-assets.ts
  - docs/workflow-steps.en.md
---

# Scan Workflow Graph — Fold Degraded-Detection Heuristic into Phase-4 Step

## 1. Background

The Cloudflare Workflows Graph view (Step Graph tab) for the scan workflow currently renders a misleading condition node labeled `collectAssetReferences(page.url, page.html).length > 0` at the top-left corner of the layout, immediately above the `parse-params` node. Reading the graph left-to-right, top-to-bottom suggests this condition is the first step of the workflow — which is wrong.

The condition comes from `pageHasAssetCandidates` (apps/workers/src/workflows/scan-workflow.ts:193), a helper that calls the pure parser `collectAssetReferences` from `services/digital-assets.ts` and is invoked in the workflow body at line 638 to flag `phase-4:scan-assets-references` as a degraded phase when the loop produced no output despite the page containing font candidates.

Cloudflare Workflows introspects every function call and `if`-statement inside the workflow handler and renders them as graph elements. Because `pageHasAssetCandidates` is called outside any `step.do` / `runStepWithFallback` callback, the introspection logic follows the call into the helper and surfaces the inner `if (... > 0)` as a top-level condition node — positioned by the layout engine independently of execution order.

## 2. Goals (in scope)

- `G1` The Step Graph for the scan workflow shows the nodes in execution order, with `parse-params` as the leftmost/topmost node. No standalone condition node for `collectAssetReferences(...).length > 0` appears in the graph.
- `G2` The degraded-phase detection for `phase-4:scan-assets-references` is preserved — `coverage.degradedPhases` still surfaces scans where the page has font candidates but the loop returned zero refs (a silent failure).
- `G3` No new `step.do` is added. Phase-4 remains a single node in the workflow graph; the degraded-detection logic runs inside that node's callback so it is invisible to the introspection layer.
- `G4` The pure helper `pageHasAssetCandidates` is no longer in the workflow file. It lives next to the parser it depends on (`apps/workers/src/services/digital-assets.ts`) and has its own unit test.
- `G5` Behavior is unchanged: same inputs produce the same `coverage.degradedPhases` array. The `scan.step_fallback` log entry, the `runStepWithFallback` fallback shape (`AssetReference[]`), and the `runScan` return value are all preserved.
- `G6` All changes covered by unit tests (TDD). Existing tests keep passing.
- `G7` No new PII in logs. No compliance findings change.

## 3. Non-goals (out of scope)

- `N1` Rewriting the entire scan workflow into smaller `step.do` calls. This spec touches only the phase-4 degraded-detection pattern.
- `N2` Changing the `AssetReference[]` return type of `collectAssetReferencesPhase`. That function still returns the refs; the wrapping happens in the workflow.
- `N3` Replacing `runStepWithFallback` with a different retry primitive.
- `N4` Changing scoring, prompts, or retrieval layers.
- `N5` DB schema change. `coverage.degradedPhases` is already a column on `scans` (persisted as part of `coverage_json`).
- `N6` Touching the other degraded-phase flags (`phase-2:extract-evidence`, `phase-5:classify-asset-rights`). They follow the same shape but are out of scope for this refactor.

## 4. Architecture

### 4.1 Move `pageHasAssetCandidates` into `services/digital-assets.ts`

The heuristic is a pure function over `evidencePhase.pages` and the parser `collectAssetReferences`. It belongs next to the parser, not in the workflow file.

```
apps/workers/src/services/
├── digital-assets.ts            # + pageHasAssetCandidates(pages) → boolean
└── digital-assets.test.ts       # + unit test for pageHasAssetCandidates
```

`pageHasAssetCandidates` keeps its current comment (rationale: "distinguish 'page really has no assets' from 'the loop died before producing any output'") and signature `(pages: ReadonlyArray<{ url: string; html: string }>) => boolean`.

### 4.2 Fold degraded detection into the phase-4 `runStepWithFallback` callback

In `scan-workflow.ts`, replace:

```ts
const assetRefs = await runStepWithFallback({
  step,
  name: "phase-4:scan-assets-references",
  fallback: [] as AssetReference[],
  config: { retries: { limit: 1, delay: 5_000, backoff: "constant" }, timeout: "2 minutes" },
  log,
  fn: () => collectAssetReferencesPhase(parsed.url, evidencePhase.pages, assetFetcher),
});
if (assetRefs.length === 0 && pageHasAssetCandidates(evidencePhase.pages)) {
  degradedPhases.push("phase-4:scan-assets-references");
}
```

with:

```ts
type Phase4Result = { refs: AssetReference[]; degraded: boolean };
const phase4 = await runStepWithFallback<Phase4Result>({
  step,
  name: "phase-4:scan-assets-references",
  fallback: { refs: [], degraded: false },
  config: { retries: { limit: 1, delay: 5_000, backoff: "constant" }, timeout: "2 minutes" },
  log,
  fn: async () => {
    const refs = await collectAssetReferencesPhase(parsed.url, evidencePhase.pages, assetFetcher);
    const degraded = refs.length === 0 && pageHasAssetCandidates(evidencePhase.pages);
    return { refs, degraded };
  },
});
const assetRefs = phase4.refs;
if (phase4.degraded) {
  degradedPhases.push("phase-4:scan-assets-references");
}
```

Why the fallback shape is `{ refs: [], degraded: false }` and not `{ refs: [], degraded: pageHasAssetCandidates(evidencePhase.pages) }`: the `scan.step_fallback` log entry already signals "this phase returned no signal." Adding `degraded: true` to the fallback would double-flag the same phase. Keeping `degraded: false` on the fallback means the phase is in `coverage.degradedPhases` only when the parser actually ran and the heuristic positively identified the page had candidates. When the step itself failed, the log line is the operator's signal — same contract as `phase-5:classify-asset-rights` today.

### 4.3 Caller sites

Only `apps/workers/src/workflows/scan-workflow.ts` consumes the phase-4 result. Phase-5 (`classifyAssetRightsPhase`) keeps receiving `assetRefs` (the inner `refs` field). No other file in `apps/workers/src/workflows/scan-workflow.phases.ts` or anywhere else is affected.

### 4.4 Files touched

```
apps/workers/src/
├── services/
│   ├── digital-assets.ts          # + pageHasAssetCandidates(pages)
│   └── digital-assets.test.ts     # + 2 unit tests for the helper
└── workflows/
    ├── scan-workflow.ts           # import pageHasAssetCandidates from services,
    │                              # remove local helper, fold detection into phase-4
    └── scan-workflow.test.ts      # + 1 test: degraded flag set when refs empty + page has candidates
```

No new file. No docs change beyond updating the workflow-steps doc if the user later asks for a graph screenshot refresh (deferred).

## 5. Test plan

| File                                               | New / Update | Case                                                                                       |
| -------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `apps/workers/src/services/digital-assets.test.ts` | NEW          | `pageHasAssetCandidates` returns true when at least one page contains a font reference     |
| same                                               | NEW          | `pageHasAssetCandidates` returns false when no page contains any font reference            |
| `apps/workers/src/workflows/scan-workflow.test.ts` | NEW          | phase-4 result with empty refs + page with font candidates marks `degradedPhases`          |
| same                                               | NEW          | phase-4 result with non-empty refs does NOT mark `degradedPhases`                           |
| same                                               | NEW          | phase-4 fallback path (step fails) does NOT mark `degradedPhases` (relies on `scan.step_fallback` log instead) |
| same                                               | NEW          | phase-4 result with empty refs + page with NO font candidates does NOT mark `degradedPhases` |
| `apps/workers/src/workflows/scan-workflow.test.ts` | existing     | unchanged — full happy-path scan still completes with `degradedPhases: []`                 |
| `apps/workers/scripts/check-step-graph.mjs`        | existing     | unchanged — `phase-4:scan-assets-references` still in the expected-step list               |

## 6. Compliance checklist (per safelaunch-compliance skill)

- [x] Compliance findings unchanged (degraded flag is operational metadata, not a rule).
- [x] Affected jurisdictions unchanged.
- [x] No scoring rubric change in `packages/compliance-core/`.
- [x] No new PII in logs.
- [x] AI-assisted copy unchanged.
- [x] Tests cover: helper true/false, degraded-flag-set, degraded-flag-absent, fallback path.
- [x] `coverage.degradedPhases` contract preserved (still `string[]`, still surfaced through `ScanCoverageSchema`).
- [x] `scan.step_fallback` log entry shape unchanged.

## 7. Rollout

- Merge to `main` via PR. No feature flag needed (refactor only; semantics preserved).
- After merge: open the Step Graph tab for one running scan in the Cloudflare dashboard and confirm `parse-params` is now the leftmost/topmost node and the `collectAssetReferences(...).length > 0` condition node is gone.

## 8. Future work (out of scope here)

- Apply the same fold-degraded-detection-into-step pattern to `phase-2:extract-evidence` and `phase-5:classify-asset-rights` so the entire degraded-flagging logic is encapsulated inside its phase's `runStepWithFallback` callback. Each phase would then return `{ ..., degraded }` and the workflow body would have no `if (... === EMPTY) degradedPhases.push(...)` lines.
- Refresh the workflow-steps screenshot in `docs/workflow-steps.en.md` / `docs/workflow-steps.vi.md` once the graph is visually clean.
