# Scan-workflow graph refactor — 2026-08-06

## Problem (user-reported)

The Cloudflare Workflow dashboard graph for `scan-workflow` shows the steps
in the wrong visual order:

1. Every `runStepWithFallback()` call is rendered as a generic
   `function call` node, hiding the actual step names
   (`publish:extracting`, `phase-2:extract-evidence`, `phase-4:scan-assets-references`,
   `phase-5:classify-asset-rights`, `publish:evaluating`, `publish:reporting`,
   `discover:page-urls`).
2. The `homepagePage.ok` else branch incorrectly shows a
   `runStepWithFallback()` box that does not exist in the failure code path.
3. The `discover:page-urls` step is missing from the graph.
4. The order of `phase-2:extract-evidence → phase-3:extract-signals` is
   preserved only in code, not visible on the dashboard.

The runtime order is correct (existing tests for `runScan` happy-path,
partial, and failed scenarios all pass). The issue is purely the
**visualizer's AST view** of the workflow.

## Root cause

The Cloudflare Workflow visualizer (currently in beta, see
<https://developers.cloudflare.com/workflows/build/visualizer/>) parses the
workflow's `run()` method as an AST and emits these node types:

| Node         | Source                                                |
| ------------ | ----------------------------------------------------- |
| `StepDo`     | A literal `step.do("name", ...)` call site.           |
| `FunctionCall` | A call to a module-level/named helper (e.g. `runStepWithFallback(...)`). |
| `TryNode`    | A `try { ... } catch { ... }` block.                  |
| `IfNode`     | An `if/else` branch.                                   |
| `IfBranch`   | `if` body.                                            |
| `ElseBranch` | `else` body.                                          |

`runStepWithFallback` is exported from `scan-workflow.steps.ts` and called
from `ScanWorkflowEntrypoint.run()`. The visualizer walks the AST, sees
the helper call, and emits a `FunctionCall` node. The literal `step.do`
inside the helper is invisible at the top level — the dashboard shows
"runStepWithFallback()" seven times instead of the seven distinct step
names.

## Design

The visualizer renders `step.do("literal-name", ...)` directly as a
`StepDo` node with the literal name. The cleanest way to fix the graph
without losing the fallback behavior is to inline the `step.do` calls
inside `try/catch` blocks — the visualizer renders that as a `TryNode`
containing a `StepDo` node with the actual name.

Trade-off:
- **Before**: 7 `runStepWithFallback(...)` calls → 7 `FunctionCall` nodes with
  generic labels.
- **After**: 7 inline `try { await step.do(...) } catch (...)` blocks → 7
  `TryNode`s each containing a `StepDo` with the actual name
  (`publish:extracting`, etc.). The dashboard now shows the real execution
  sequence.

The module-level `runStepWithFallback` helper stays in
`scan-workflow.steps.ts` because:
- The unit tests in `scan-workflow.steps.test.ts` lock the contract of the
  helper (returns fallback on throw, logs warning, propagates config).
- The entrypoint-level tests in `scan-workflow.entrypoint.test.ts` use it
  to simulate step failures (phase-5 CPU timeout, phase-2 timeout) without
  having to mock the workflow runtime.
- Removing it would erode test coverage and force the tests to re-implement
  the fallback logic.

The new pattern in `run()` is therefore:

```ts
try {
  result = await step.do("publish:extracting", config, fn);
} catch (cause) {
  log({ level: "warn", event: "scan.step_fallback", step: "publish:extracting", reason, at });
  result = fallback;
}
```

…and the dashboard now shows `StepDo(publish:extracting)` inside a
`TryNode`, with the actual name visible.

## Plan

### Step 1 — Inline `step.do` calls in `run()`

Replace each `runStepWithFallback({ step, name, fallback, config, log, fn })`
call in `ScanWorkflowEntrypoint.run()` with an inline `try/catch` that
calls `step.do(name, ...)` directly. Keep the same fallback values, the
same config, and the same `scan.step_fallback` log shape.

Affected steps:
1. `discover:page-urls` — fallback `{}`, timeout 20s
2. `publish:extracting` — fallback `undefined`
3. `phase-2:extract-evidence` — fallback `{ evidence: [], pages: [] }`, 1 min
4. `phase-4:scan-assets-references` — fallback `{ refs: [], degraded: false }`, 2 min
5. `phase-5:classify-asset-rights` — fallback `EMPTY_DIGITAL_ASSET_COLLECTION`, 3 min
6. `publish:evaluating` — fallback `undefined`
7. `publish:reporting` — fallback `undefined`

### Step 2 — Fix the failure-branch graph

The current code uses an early-return when `homepagePage.ok` is false. The
visualizer then attaches the `(discover:page-urls)` step to the
`ElseBranch` because the early return looks like the rest of the function
is "the else branch's continuation". The fix is to wrap the success-path
work inside an `if (homepagePage.ok)` block so the visualizer sees it as
an `IfBranch` and the failure branch becomes a discrete `ElseBranch`.

### Step 3 — Update tests

The existing tests for `runStepWithFallback` (the module-level helper)
stay unchanged. New tests in `scan-workflow.entrypoint.test.ts` lock the
**visible step names** in the order the dashboard should render them:

```ts
const EXPECTED_STEP_NAMES = [
  "parse-params",
  "fetch:homepage",
  "discover:page-urls",
  "fetch:about", "fetch:privacy", "fetch:contact", "fetch:terms",
  "publish:extracting",
  "phase-2:extract-evidence",
  "phase-3:extract-signals",
  "phase-4:scan-assets-references",
  "phase-5:classify-asset-rights",
  "publish:evaluating",
  "phase-6:evaluate-license",
  "phase-7:evaluate-rules",
  "phase-8:aggregate",
  "publish:reporting",
  "phase-9:persist-report",
  "phase-10:persist-terminal",
];
```

A new behavioral test records the sequence of `step.do` calls and asserts
it matches `EXPECTED_STEP_NAMES` (only the success path; the failure path
asserts `phase-10:persist-terminal` is the only step after the early
return).

### Step 4 — Verify

- `pnpm -w test` must pass without changing the existing test assertions
  for `runScan` (happy-path, partial, failed, progress publishing).
- `pnpm -w build` must pass.
- `pnpm -w typecheck` must pass.
- The `runStepWithFallback` unit tests must still pass (the helper is
  still exported and still works).

### Step 5 — Document

- Update the comment block at the top of `run()` explaining why the
  inline `try/catch` pattern is used (visualizer needs `StepDo` nodes to
  render the graph correctly).
- Reference the official docs:
  <https://developers.cloudflare.com/workflows/build/visualizer/>

## Out of scope

- Switching to a DAG / declarative workflow (Python SDK only — TS does not
  support it yet).
- Rewriting the visualizer (out of our control).
- Changing the step names — they already encode the phase and are easy to
  grep for in dashboard filters.
