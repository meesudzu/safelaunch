---
title: Scan Workflow Graph — Inline step.do + UI Stepper Alignment
date: 2026-08-06
status: draft
owner: fullstack
project: SafeLaunch
related:
  - docs/superpowers/specs/2026-08-04-scan-workflow-step-graph-design.md
  - docs/superpowers/specs/2026-08-05-scan-flow-simplification-design.md
  - docs/superpowers/specs/2026-08-06-scan-workflow-graph-degraded-design.md
  - apps/workers/src/workflows/scan-workflow.ts
  - apps/workers/src/workflows/scan-workflow.phases.ts
  - apps/workers/src/workflows/scan-workflow.steps.ts
  - apps/web/src/components/scan-stepper.tsx
  - apps/web/src/components/scan-progress.tsx
---

# Scan Workflow Graph — Inline step.do + UI Stepper Alignment

## 1. Background

Two related defects in the scan-workflow surface (Cloudflare Workflows Step Graph + the public `<ScanStepper>` UI):

### 1.1 Dashboard graph shows generic helper names instead of step names

User-supplied evidence (screenshot, 2026-08-06) of the Step Graph shows the seven steps that need graceful fallback rendering as a generic `function call: runStepWithFallback()` node. The literal step names (`discover:page-urls`, `publish:extracting`, `phase-2:extract-evidence`, `phase-4:scan-assets-references`, `phase-5:classify-asset-rights`, `publish:evaluating`, `publish:reporting`) are invisible on the dashboard.

Root cause (already proven by PR #30 which folded the phase-4 degraded-detection heuristic into the `step.do` callback): Cloudflare Workflows visualizer parses `ScanWorkflowEntrypoint.run()` as an AST and emits these node types:

| Node          | Source                                                   |
| ------------- | -------------------------------------------------------- |
| `StepDo`      | A literal `step.do("name", ...)` call site.              |
| `FunctionCall`| A call to a module-level/named helper (e.g. `runStepWithFallback(...)`). |
| `TryNode`     | A `try { ... } catch { ... }` block.                     |
| `IfNode`      | An `if/else` branch.                                     |

`runStepWithFallback` is exported from `apps/workers/src/workflows/scan-workflow.steps.ts` and called from `ScanWorkflowEntrypoint.run()`. The visualizer walks the AST, sees the helper call, and emits a `FunctionCall` node — the literal `step.do` inside the helper is invisible at the top level.

### 1.2 Failure-branch graph is inverted

The current code uses an early-return when `homepagePage.ok` is false:

```ts
if (!homepagePage.ok) {
  // persist-terminal (failure path)
  return { ... failed coverage ... };
}
// success path continues here — discover, fetch, extract, ...
```

The visualizer treats the success path as "the rest of the function" (not as a discrete `IfBranch`), so the layout engine positions `phase-10:persist-terminal` to the left of the `homepagePage.ok` decision node — suggesting it runs when `homepagePage.ok === true`. This is the opposite of runtime behaviour.

### 1.3 UI stepper declares 6 states but workflow emits only 4

`apps/web/src/components/scan-stepper.tsx` declares `SCAN_PIPELINE = ["queued", "fetching", "extracting", "retrieving", "evaluating", "reporting"]` (6 rows). `apps/web/src/messages/progress-{vi,en}.json` provide translations for all six.

The workflow currently emits only 4 of those states to D1:

| State       | Emitted by                            |
| ----------- | ------------------------------------- |
| `queued`    | Initial row created in `scans` table. |
| `extracting`| `publish:extracting` step.            |
| `evaluating`| `publish:evaluating` step.            |
| `reporting` | `publish:reporting` step.             |

`fetching` and `retrieving` are never written to D1. The corresponding rows in `<ScanStepper>` never light up — users see the stepper jump from "queued" straight to "extracting" and skip two rows.

## 2. Goals (in scope)

- `G1` Dashboard Step Graph shows the 21 steps in execution order with literal names. No `function call: runStepWithFallback()` nodes remain.
- `G2` `homepagePage.ok` decision node renders with the success path as a discrete `IfBranch` (not the implicit "rest of function" tail).
- `G3` Workflow emits all six SCAN_PIPELINE states to D1: `queued`, `fetching`, `extracting`, `evaluating`, `retrieving`, `reporting`. UI stepper rows light up in order.
- `G4` UI SCAN_PIPELINE list order matches DB transition order so no row "jumps" while lighting up.
- `G5` Each emitted state semantically maps to actual work: `fetching` runs while pages are fetched, `evaluating` runs while phase-6 (license eval) runs, `retrieving` runs while phase-7 (RAG + AI eval) runs.
- `G6` All changes covered by tests (TDD). Existing tests for `runScan` (happy-path, partial, failed), `runStepWithFallback`, and the stepper component all keep passing.
- `G7` No new PII in logs. No compliance findings change.

## 3. Non-goals (out of scope)

- `N1` Switching to a DAG / declarative workflow (Cloudflare's Python SDK only — TS does not support it yet).
- `N2` Changing the Cloudflare Workflows visualizer (out of our control).
- `N3` Changing step names that already encode the phase (e.g. `phase-3:extract-signals`) — they are easy to grep for in dashboard filters.
- `N4` Adding a new step that splits `phase-7:evaluate-rules` into separate RAG + AI steps. We publish `retrieving` before the existing `phase-7:evaluate-rules` step instead of splitting it.
- `N5` Changing the scoring rubric, prompts, retrieval layer, or DB schema.
- `N6` Touching the other degraded-phase flags (`phase-2:extract-evidence`, `phase-5:classify-asset-rights`). They follow the inline try/catch pattern but the degraded-flagging logic is preserved as-is.

## 4. Architecture

### 4.1 Inline try/catch around every step that needs fallback

Replace every `runStepWithFallback({ step, name, fallback, config, log, fn })` call in `ScanWorkflowEntrypoint.run()` with an inline `try { step.do(...) } catch (...) { log(...) }` block. The visualizer renders that as `TryNode` containing `StepDo` with the literal name.

Affected step names (current count: 7 → after spec: 9 with the two new `publish:*` steps):

| Step name                          | Fallback value                                  | Timeout          |
| ---------------------------------- | ----------------------------------------------- | ---------------- |
| `discover:page-urls`               | `{}`                                            | 20 seconds       |
| `publish:fetching` (NEW)           | `undefined`                                     | (default 5 min)  |
| `publish:extracting`               | `undefined`                                     | (default 5 min)  |
| `phase-2:extract-evidence`         | `{ evidence: [], pages: [] }`                   | 1 minute         |
| `phase-4:scan-assets-references`   | `{ refs: [], degraded: false }`                 | 2 minutes        |
| `phase-5:classify-asset-rights`    | `EMPTY_DIGITAL_ASSET_COLLECTION`                | 3 minutes        |
| `publish:evaluating`               | `undefined`                                     | (default 5 min)  |
| `publish:retrieving` (NEW)         | `undefined`                                     | (default 5 min)  |
| `publish:reporting`                | `undefined`                                     | (default 5 min)  |

The module-level `runStepWithFallback` helper stays in `scan-workflow.steps.ts` because the existing unit tests in `scan-workflow.steps.test.ts` lock its contract (returns fallback on throw, logs warning, propagates config). Removing it would force tests to re-implement the fallback logic and erode coverage.

### 4.2 Fix the failure-branch graph

Wrap the success-path work inside an explicit `if (homepagePage.ok) { ... }` block:

```ts
if (!homepagePage.ok) {
  await step.do("phase-10:persist-terminal", ..., async () =>
    persistTerminalPhase({ scanId: parsed.scanId, state: "failed", ... }, ...),
  );
  return { scanId: parsed.scanId, state: "failed", ... };
}

if (homepagePage.ok) {
  // ... full success path: discover, fetch:*, extract, publish:*, etc.
}
```

The visualizer renders the `if (homepagePage.ok)` as a discrete `IfNode` with an `IfBranch` (success) and an `ElseBranch` (failure). The success-path nodes appear in execution order to the right of the decision node; the failure-path `phase-10:persist-terminal` appears to the left in a dedicated branch.

The runtime behaviour is unchanged: when `homepagePage.ok` is false, the early-return path still executes and the function exits before entering the new `if (homepagePage.ok)` block.

### 4.3 Add `publish:fetching` and `publish:retrieving` steps

```ts
// Right after parse-params, before fetch:homepage
try {
  await step.do("publish:fetching", DEFAULT_SCAN_STEP_CONFIG, () =>
    persistProgressPhase({ scanId: parsed.scanId, state: "fetching" }, { db: this.env.DB, log, now }),
  );
} catch (cause) { log({ level: "warn", event: "scan.step_fallback", step: "publish:fetching", reason, at }); }
```

```ts
// Between phase-6:evaluate-license and phase-7:evaluate-rules
try {
  await step.do("publish:retrieving", DEFAULT_SCAN_STEP_CONFIG, () =>
    persistProgressPhase({ scanId: parsed.scanId, state: "retrieving" }, { db: this.env.DB, log, now }),
  );
} catch (cause) { log({ level: "warn", event: "scan.step_fallback", step: "publish:retrieving", reason, at }); }
```

Final workflow step order:

```
1.  parse-params
2.  publish:fetching                (NEW)
3.  fetch:homepage
4.  [if !homepagePage.ok → phase-10:persist-terminal + return]
5.  [if homepagePage.ok]
6.    discover:page-urls
7.    fetch:about
8.    fetch:privacy
9.    fetch:contact
10.   fetch:terms
11.   publish:extracting
12.   phase-2:extract-evidence
13.   phase-3:extract-signals
14.   phase-4:scan-assets-references
15.   phase-5:classify-asset-rights
16.   publish:evaluating
17.   phase-6:evaluate-license
18.   publish:retrieving              (NEW)
19.   phase-7:evaluate-rules
20.   phase-8:aggregate
21.   publish:reporting
22.   phase-9:persist-report
23.   phase-10:persist-terminal
```

DB transitions: `queued → fetching → extracting → evaluating → retrieving → reporting → (completed | partial | failed)`.

### 4.4 Swap SCAN_PIPELINE order to match workflow

`apps/web/src/components/scan-stepper.tsx` currently declares:

```ts
export const SCAN_PIPELINE = [
  "queued",
  "fetching",
  "extracting",
  "retrieving",
  "evaluating",
  "reporting",
] as const;
```

Change to:

```ts
export const SCAN_PIPELINE = [
  "queued",
  "fetching",
  "extracting",
  "evaluating",
  "retrieving",
  "reporting",
] as const;
```

i18n keys (`state.fetching`, `state.evaluating`, `state.retrieving`, etc.) are name-based and stay unchanged. The translation strings for `step.retrieving.label` / `step.retrieving.description` stay accurate: phase-7 is when the RAG retrieval happens.

### 4.5 Files touched

```
apps/workers/src/
├── workflows/
│   ├── scan-workflow.ts              # inline 9 try/catch blocks, add publish:fetching + publish:retrieving, wrap success-path in if(homepagePage.ok)
│   ├── scan-workflow.entrypoint.test.ts   # + new test locking visible step name sequence
│   └── scan-workflow.phases.test.ts       # unchanged (runScan behaviour preserved)
├── services/
│   ├── digital-assets.ts             # unchanged
│   └── digital-assets.test.ts        # unchanged

apps/web/src/
├── components/
│   ├── scan-stepper.tsx              # swap SCAN_PIPELINE order (evaluating / retrieving)
│   ├── scan-stepper.test.tsx         # update the "renders exactly the six pipeline steps in the canonical order" assertion
│   ├── scan-stepper.snapshot.test.tsx  # snapshot needs re-baseline (or skip via toMatchSnapshot update)
│   ├── scan-progress.tsx             # unchanged (reads from SCAN_PIPELINE)
│   └── scan-progress.test.tsx        # unchanged
└── messages/
    ├── progress-vi.json              # unchanged (keys are name-based)
    └── progress-en.json              # unchanged

docs/
└── superpowers/
    ├── specs/
    │   └── 2026-08-06-scan-workflow-graph-refactor-design.md   # (this file)
    └── plans/
        └── 2026-08-06-scan-workflow-graph-refactor-plan.md     # existing file at ...-refactor.md is renamed in-place to follow the -plan.md convention, expanded with scope B
```

## 5. Test plan

### 5.1 Backend tests

| File                                              | New / Update | Case                                                                                                                          |
| ------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/workers/src/workflows/scan-workflow.entrypoint.test.ts` | NEW          | Recording step asserts visible step names in order: `[parse-params, publish:fetching, fetch:homepage, discover:page-urls, fetch:about, fetch:privacy, fetch:contact, fetch:terms, publish:extracting, phase-2:extract-evidence, phase-3:extract-signals, phase-4:scan-assets-references, phase-5:classify-asset-rights, publish:evaluating, phase-6:evaluate-license, publish:retrieving, phase-7:evaluate-rules, phase-8:aggregate, publish:reporting, phase-9:persist-report, phase-10:persist-terminal]` |
| same                                              | NEW          | Failure path: when `homepagePage.ok` is false, only `phase-10:persist-terminal` runs after `publish:fetching` + `fetch:homepage` |
| same                                              | NEW          | `publish:fetching` step fires (recording step sees it) before `fetch:homepage` and is not retried on subsequent failure                                                |
| same                                              | NEW          | `publish:retrieving` step fires between phase-6 and phase-7; failure path skips it (still falls through to phase-7 / phase-8 / persist) |
| `apps/workers/src/workflows/scan-workflow.steps.test.ts` | existing | unchanged — `runStepWithFallback` contract still holds (returned value, fallback, log entry)                                  |
| `apps/workers/src/workflows/scan-workflow.test.ts` (runScan) | existing | unchanged — happy-path / partial / failed scenarios all still pass                                                            |
| `apps/workers/src/workflows/scan-workflow.phases.test.ts` | existing | unchanged                                                                                                                     |
| `apps/workers/scripts/check-step-graph.mjs` (if present) | existing | update `EXPECTED_STEP_NAMES` array to include `publish:fetching` + `publish:retrieving` and the swapped order for evaluating / retrieving if the script asserts on workflow order |

### 5.2 Frontend tests

| File                                              | New / Update | Case                                                                                                                          |
| ------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/scan-stepper.test.tsx`   | UPDATE       | "renders exactly the six pipeline steps in the canonical order" assertion now expects `[queued, fetching, extracting, evaluating, retrieving, reporting]` |
| `apps/web/src/components/scan-stepper.test.tsx`   | no change    | the `it.each` parameter list iterates all 6 states; the per-state assertion is independent of pipeline order, so no change needed |
| `apps/web/src/components/scan-stepper.snapshot.test.tsx` | UPDATE | re-baseline snapshot (or accept new snapshot once tests run)                                                                |
| `apps/web/src/components/scan-progress.test.tsx`  | existing     | unchanged — uses `SCAN_PIPELINE` by reference                                                                                 |

### 5.3 Manual verification

- After deployment, run one scan in the Cloudflare dashboard. Open the Step Graph tab. Confirm:
  1. Top-to-bottom order matches §4.3.
  2. No `function call: runStepWithFallback()` nodes remain.
  3. `homepagePage.ok` decision node has the failure-path `phase-10:persist-terminal` on the left (in a dedicated branch) and the success-path nodes on the right.
- Poll the scan-progress page during one live scan. Confirm:
  1. Stepper rows light up in order: queued → fetching → extracting → evaluating → retrieving → reporting.
  2. No row "jumps" (no row activates before its predecessor in the list has been marked completed).

## 6. Compliance checklist (per safelaunch-compliance skill)

- [x] Compliance findings unchanged — this refactor touches operational graph rendering, not rule evaluation.
- [x] Affected jurisdictions unchanged.
- [x] No scoring rubric change in `packages/compliance-core/`.
- [x] No new PII in logs. The two new `scan.step_fallback` log entries mirror the existing shape (`{ level, event, step, reason, at }`).
- [x] AI-assisted copy unchanged — no UI text changes (i18n keys preserved).
- [x] Tests cover: visible step name sequence (success + failure paths), new publish steps fire in the right slots, stepper SCAN_PIPELINE order assertion.
- [x] No DB schema change. `coverage.degradedPhases` and the persisted progress state strings (`queued`, `fetching`, `extracting`, `evaluating`, `retrieving`, `reporting`) are already supported by the existing `ScanCoverageSchema` and the `scans.state` column.
- [x] `scan.step_fallback` log entry shape unchanged.

## 7. Rollout

- Merge to `main` via PR. No feature flag needed (refactor only; runtime semantics preserved for the success path, and the two new publish steps are best-effort with the same fallback contract as the existing `publish:*` steps).
- After merge:
  1. Deploy to staging. Trigger one scan via the UI and confirm the Step Graph matches the order in §5.3.
  2. Confirm polling client lights up all six stepper rows in order.
  3. Deploy to production. Repeat on one production scan.

## 8. Future work (out of scope here)

- Apply the same fold-degraded-detection-into-step pattern to `phase-2:extract-evidence` and `phase-5:classify-asset-rights` so the entire degraded-flagging logic is encapsulated inside its phase's `try/catch` callback (mirrors what was done for phase-4 in PR #30).
- Refresh the workflow-steps screenshot in `docs/workflow-steps.{en,vi}.md` once the dashboard graph is visually clean.
- Add a CI script (`apps/workers/scripts/check-step-graph.mjs` already exists per PR #30) that asserts the workflow file contains the literal `step.do("publish:*", ...)` calls in the right slots — protects against future regressions where someone reintroduces `runStepWithFallback` wrappers.
