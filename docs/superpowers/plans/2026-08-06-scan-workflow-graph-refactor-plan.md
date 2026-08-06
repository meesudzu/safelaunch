# Scan Workflow Graph Refactor (Dashboard + UI Alignment) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Cloudflare Workflows Step Graph for `scan-workflow` so every step renders with its literal name (no more `function call: runStepWithFallback()` nodes), fix the inverted failure-branch layout, and align the user-facing `<ScanStepper>` UI with what the workflow actually emits by adding `publish:fetching` and `publish:retrieving` steps.

**Architecture:** (1) Replace every `runStepWithFallback({...})` call in `ScanWorkflowEntrypoint.run()` with an inline `try { await step.do(...) } catch (...) { log(...) }` block — Cloudflare's dashboard visualizer renders those as `TryNode` containing `StepDo` with the literal name. (2) Wrap the success-path in `if (homepagePage.ok) { ... }` so the visualizer sees a discrete `IfBranch` (success) and `ElseBranch` (failure). (3) Add two new `step.do("publish:fetching", ...)` and `step.do("publish:retrieving", ...)` so the workflow emits all six SCAN_PIPELINE states to D1; (4) swap `SCAN_PIPELINE` order to match DB transition order. The module-level `runStepWithFallback` helper stays in `scan-workflow.steps.ts` so existing unit tests in `scan-workflow.steps.test.ts` continue to lock its contract.

**Tech Stack:** TypeScript, Vitest + `@cloudflare/vitest-pool-workers`, Cloudflare Workflows (`@cloudflare/workers-types`).

**Spec:** `docs/superpowers/specs/2026-08-06-scan-workflow-graph-refactor-design.md`

**Supersedes:** the older high-level plan at `docs/superpowers/plans/2026-08-06-scan-workflow-graph-refactor.md` (kept for history; do not delete per AGENTS.md "Never delete files unless the user explicitly asks").

---

## File Structure

| File                                                                | Responsibility                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/workers/src/workflows/scan-workflow.ts`                       | `ScanWorkflowEntrypoint.run()` body: 9 inline try/catch blocks, success-path wrapped in `if(homepagePage.ok)`, two new `publish:*` steps |
| `apps/workers/src/workflows/scan-workflow.steps.ts`                 | unchanged — `runStepWithFallback` helper preserved for behavior parity + unit tests                       |
| `apps/workers/src/workflows/scan-workflow.entrypoint.test.ts`       | NEW structural source-code test asserting visible `step.do` call names + order                            |
| `apps/workers/scripts/check-step-graph.mjs`                         | `EXPECTED_STEP_NAMES` array updated to include `publish:fetching` + `publish:retrieving`                  |
| `apps/web/src/components/scan-stepper.tsx`                          | `SCAN_PIPELINE` array order swapped (evaluating ↔ retrieving)                                              |
| `apps/web/src/components/scan-stepper.test.tsx`                     | "renders exactly the six pipeline steps in the canonical order" assertion updated to match new order     |
| `apps/web/src/components/scan-stepper.snapshot.test.tsx`            | snapshot re-baselined                                                                                    |

No new files. No DB schema change. No i18n key change. No compliance-finding change.

---

## Task 1: Add structural source-code test (RED)

**Files:**
- Modify: `apps/workers/src/workflows/scan-workflow.entrypoint.test.ts` (append a new `describe` block at the end)

- [ ] **Step 1: Append the new describe block**

Open `apps/workers/src/workflows/scan-workflow.entrypoint.test.ts`. Add at the very end of the file (after the existing `describe("phase-4 fallback shape (graph-degraded refactor)", ...)` block):

```ts
/**
 * Structural test: lock the literal `step.do("name", ...)` call names and
 * their order in `ScanWorkflowEntrypoint.run()`. The Cloudflare Workflows
 * visualizer parses the source as an AST and emits one `StepDo` node per
 * literal call site — a `runStepWithFallback(...)` helper call hides the
 * literal name as a generic `FunctionCall` node. This test guards against
 * any future regression where a helper wraps a step.do call.
 *
 * Why structural (not runtime): the dashboard graph is rendered by an AST
 * walk of the source file, not by inspecting the runtime call stack. The
 * runtime order is locked separately by `runScan` and `runStepWithFallback`
 * tests elsewhere. Here we assert what the dashboard sees.
 */
describe("ScanWorkflowEntrypoint step graph structure", () => {
  const EXPECTED_STEP_NAMES = [
    "parse-params",
    "publish:fetching",
    "fetch:homepage",
    "discover:page-urls",
    "fetch:about",
    "fetch:privacy",
    "fetch:contact",
    "fetch:terms",
    "publish:extracting",
    "phase-2:extract-evidence",
    "phase-3:extract-signals",
    "phase-4:scan-assets-references",
    "phase-5:classify-asset-rights",
    "publish:evaluating",
    "phase-6:evaluate-license",
    "publish:retrieving",
    "phase-7:evaluate-rules",
    "phase-8:aggregate",
    "publish:reporting",
    "phase-9:persist-report",
    "phase-10:persist-terminal",
  ] as const;

  it("contains the expected literal step.do() call names in execution order", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");

    const here = url.fileURLToPath(import.meta.url);
    const workflowSrc = await fs.readFile(
      path.resolve(path.dirname(here), "./scan-workflow.ts"),
      "utf8",
    );

    // Match every `step.do("literal-name", ...)` call site in the source.
    // The pattern tolerates whitespace between `step.do(` and the string
    // literal so reformatting does not break the test.
    const matches = [...workflowSrc.matchAll(/step\.do\(\s*["']([^"']+)["']/g)].map(
      (m) => m[1] as string,
    );

    // The source contains one `step.do(...)` call inside `runStepWithFallback`
    // in `scan-workflow.steps.ts` referenced indirectly, plus the step
    // calls inside the workflow itself. Assert the union contains the
    // expected names in the expected order — extras (the helper's own
    // step.do) are tolerated but ordered matches must be exact.
    const ordered = matches.filter((name, index) =>
      EXPECTED_STEP_NAMES.includes(name as (typeof EXPECTED_STEP_NAMES)[number]) &&
      // Take only the first occurrence of each name; later occurrences
      // (e.g. inside `runStepWithFallback`) are ignored.
      matches.indexOf(name) === index,
    );

    expect(ordered).toEqual(EXPECTED_STEP_NAMES);
  });

  it("does not call runStepWithFallback from ScanWorkflowEntrypoint.run()", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");

    const here = url.fileURLToPath(import.meta.url);
    const workflowSrc = await fs.readFile(
      path.resolve(path.dirname(here), "./scan-workflow.ts"),
      "utf8",
    );

    // The helper is allowed in `scan-workflow.steps.ts` (its home) but not
    // from `ScanWorkflowEntrypoint.run()`. We approximate by counting
    // occurrences in the entrypoint source file.
    const helperCalls = (workflowSrc.match(/runStepWithFallback\s*\(/g) ?? []).length;
    expect(helperCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/workers && pnpm test -- scan-workflow.entrypoint.test`

Expected output: FAIL — `ordered` does not equal `EXPECTED_STEP_NAMES`. Currently `discover:page-urls`, `publish:extracting`, `phase-2:extract-evidence`, `phase-4:scan-assets-references`, `phase-5:classify-asset-rights`, `publish:evaluating`, `publish:reporting` are wrapped in `runStepWithFallback(...)` so the literal `step.do` names do not appear in the entrypoint source; also `publish:fetching` and `publish:retrieving` do not exist yet. The second test should also fail: helperCalls > 0.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/workers/src/workflows/scan-workflow.entrypoint.test.ts
git commit -m "test(workflow): add structural test locking visible step.do names"
```

---

## Task 2: Inline try/catch for the 7 existing runStepWithFallback calls

**Files:**
- Modify: `apps/workers/src/workflows/scan-workflow.ts` — replace 7 `runStepWithFallback({...})` blocks with inline `try { step.do(...) } catch { log(...) }`

The seven step names to inline (in their current source order):
1. `discover:page-urls` (around lines 461-490)
2. `publish:extracting` (around lines 596-616)
3. `phase-2:extract-evidence` (around lines 622-665)
4. `phase-4:scan-assets-references` (around lines 689-722)
5. `phase-5:classify-asset-rights` (around lines 730-762)
6. `publish:evaluating` (around lines 769-783)
7. `publish:reporting` (around lines 847-861)

For each, use this template (substituting the actual `name`, `config`, and `fallback`):

```ts
try {
  result = await step.do("NAME", CONFIG, FN);
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "NAME",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
  result = FALLBACK;
}
```

- [ ] **Step 1: Inline `discover:page-urls`**

Replace (in `scan-workflow.ts`, search for `const pageUrlMap: PageUrlMap = await runStepWithFallback({`):

```ts
const pageUrlMap: PageUrlMap = await runStepWithFallback({
  step,
  name: "discover:page-urls",
  fallback: {},
  config: {
    retries: { limit: 1, delay: 1_000, backoff: "constant" },
    timeout: "20 seconds",
  },
  log,
  fn: () => {
    const html = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(
      homepagePage.html,
    );
    return Promise.resolve(discoverPageUrls(parsed.url, html));
  },
});
```

with:

```ts
let pageUrlMap: PageUrlMap = {};
try {
  pageUrlMap = await step.do<PageUrlMap, WorkflowStepConfig>(
    "discover:page-urls",
    {
      ...DEFAULT_SCAN_STEP_CONFIG,
      retries: { limit: 1, delay: 1_000, backoff: "constant" },
      timeout: "20 seconds",
    },
    () => {
      const html = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(
        homepagePage.html,
      );
      return Promise.resolve(discoverPageUrls(parsed.url, html));
    },
  );
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "discover:page-urls",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
}
```

Also update the comment block immediately above (it currently says "via `runStepWithFallback`") to:

```ts
// (via the inline `try/catch` below; the helper is no longer
// called here so the visualizer renders a `StepDo` node with the
// literal name).
```

- [ ] **Step 2: Inline `publish:extracting`**

Search for `await runStepWithFallback({` with `name: "publish:extracting"`. Replace the call with:

```ts
try {
  await step.do("publish:extracting", DEFAULT_SCAN_STEP_CONFIG, () =>
    persistProgressPhase(
      { scanId: parsed.scanId, state: "extracting" },
      { db: this.env.DB, log, now },
    ),
  );
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "publish:extracting",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
}
```

Update the comment above to:

```ts
// publish:extracting: inline try/catch so the visualizer renders
// a `StepDo` node with the literal name. The inner step is still
// wrapped in try/catch so a transient D1 cold-start does not
// abort the scan (matches the previous `runStepWithFallback`
// fallback=undefined behavior).
```

- [ ] **Step 3: Inline `phase-2:extract-evidence`**

Search for `const evidencePhase = await runStepWithFallback({` (or look for `name: "phase-2:extract-evidence"`). The current code has a typed empty fallback. Replace with:

```ts
const emptyEvidence = extractEvidencePhase(
  fetchedRows.map((r) => ({ type: r.type, url: r.url, status: r.status })),
  rawHtml,
);
const emptyEvidenceSafe: { evidence: never[]; pages: { html: Uint8Array; type: string }[] } = {
  evidence: [],
  pages: fetchedRows.map((r) => ({ type: r.type, html: new Uint8Array() })),
};
let evidencePhase: typeof emptyEvidenceSafe = emptyEvidenceSafe;
try {
  evidencePhase = await step.do<typeof emptyEvidenceSafe, WorkflowStepConfig>(
    "phase-2:extract-evidence",
    {
      ...DEFAULT_SCAN_STEP_CONFIG,
      retries: { limit: 1, delay: 5_000, backoff: "constant" },
      timeout: "1 minute",
    },
    () => {
      const result = extractEvidencePhase(
        fetchedRows.map((r) => ({ type: r.type, url: r.url, status: r.status })),
        rawHtml,
      );
      return Promise.resolve(result);
    },
  );
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "phase-2:extract-evidence",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
}
```

Update the comment above to:

```ts
// phase-2:extract-evidence: inline try/catch so the visualizer
// renders a `StepDo` node with the literal name. The fallback is
// the previously-documented empty result so phases 3-10 still run
// when the evidence-extraction loop blows the CPU budget.
// Use the same shape the published `extractEvidencePhase` returns so
// downstream code that reads `.html`, `.type`, `.value`, etc. continues
// to type-check. The fallback is an empty result; the only impact of
// the fallback path is that the scan proceeds with no extracted
// evidence.
```

- [ ] **Step 4: Inline `phase-4:scan-assets-references`**

Search for `const phase4 = await runStepWithFallback({` (or `name: "phase-4:scan-assets-references"`). Replace with:

```ts
const emptyPhase4 = { refs: [] as never[], degraded: false };
let phase4: typeof emptyPhase4 = emptyPhase4;
try {
  phase4 = await step.do<typeof emptyPhase4, WorkflowStepConfig>(
    "phase-4:scan-assets-references",
    {
      ...DEFAULT_SCAN_STEP_CONFIG,
      retries: { limit: 1, delay: 5_000, backoff: "constant" },
      timeout: "2 minutes",
    },
    async () => {
      const refs = await collectAssetReferencesPhase(
        parsed.url,
        evidencePhase.pages,
        assetFetcher,
      );
      const degraded = refs.length === 0 && pageHasAssetCandidates(evidencePhase.pages);
      return { refs, degraded };
    },
  );
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "phase-4:scan-assets-references",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
}
```

Update the comment above to:

```ts
// phase-4:scan-assets-references: inline try/catch so the
// visualizer renders a `StepDo` node with the literal name. The
// fallback deliberately reports `degraded: false` so that a step
// failure (CPU time limit, network error, exhausted retries) is
// surfaced only via the `scan.step_fallback` log line - not via
// `coverage.degradedPhases` (reserved for the case where the step
// actually ran and the heuristic positively identified asset
// candidates).
```

- [ ] **Step 5: Inline `phase-5:classify-asset-rights`**

Search for `const assetInventory = await runStepWithFallback({` (or `name: "phase-5:classify-asset-rights"`). Replace with:

```ts
let assetInventory = EMPTY_DIGITAL_ASSET_COLLECTION;
try {
  assetInventory = await step.do<DigitalAssetCollection, WorkflowStepConfig>(
    "phase-5:classify-asset-rights",
    {
      ...DEFAULT_SCAN_STEP_CONFIG,
      retries: { limit: 2, delay: 5_000, backoff: "constant" },
      timeout: "3 minutes",
    },
    () =>
      classifyAssetRightsPhase(
        assetRefs,
        assetFetcher,
        evidencePhase.pages.map((p) => p.html).join("\n"),
      ),
  );
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "phase-5:classify-asset-rights",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
}
```

Update the comment above to:

```ts
// phase-5:classify-asset-rights: inline try/catch so the
// visualizer renders a `StepDo` node with the literal name. The
// fallback is `EMPTY_DIGITAL_ASSET_COLLECTION` so subsequent
// phases (license evaluation, rule evaluation, aggregation,
// report persistence) still complete when this phase exhausts
// its retries.
```

- [ ] **Step 6: Inline `publish:evaluating`**

Search for `await runStepWithFallback({` with `name: "publish:evaluating"`. Replace with:

```ts
try {
  await step.do("publish:evaluating", DEFAULT_SCAN_STEP_CONFIG, () =>
    persistProgressPhase(
      { scanId: parsed.scanId, state: "evaluating" },
      { db: this.env.DB, log, now },
    ),
  );
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "publish:evaluating",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
}
```

Update the comment above to:

```ts
// publish:evaluating: inline try/catch so the visualizer renders
// a `StepDo` node with the literal name. A failure here is
// best-effort (transient D1 cold-start does not abort the
// evaluation phase).
```

- [ ] **Step 7: Inline `publish:reporting`**

Search for `await runStepWithFallback({` with `name: "publish:reporting"`. Replace with:

```ts
try {
  await step.do("publish:reporting", DEFAULT_SCAN_STEP_CONFIG, () =>
    persistProgressPhase(
      { scanId: parsed.scanId, state: "reporting" },
      { db: this.env.DB, log, now },
    ),
  );
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "publish:reporting",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
}
```

Update the comment above to:

```ts
// publish:reporting: inline try/catch so the visualizer renders
// a `StepDo` node with the literal name. A failure here is
// best-effort (the report row is still upserted by phase-9).
```

- [ ] **Step 8: Update the top-of-`run()` comment block**

At the top of `run()`, replace the existing comment block with:

```ts
// Each `step.do(name, fn)` becomes one node on the Cloudflare dashboard
// Graph (a `StepDo` node per the visualizer AST, see
// <https://developers.cloudflare.com/workflows/build/visualizer/>). The
// runtime retries the closure on transient failure and memoizes its
// return value so a partial failure does not replay earlier phases.
//
// The nine steps that need graceful fallback (discover:page-urls,
// publish:fetching, publish:extracting, phase-2:extract-evidence,
// phase-4:scan-assets-references, phase-5:classify-asset-rights,
// publish:evaluating, publish:retrieving, publish:reporting) are wrapped
// in inline `try/catch` blocks instead of a module-level helper.
// Cloudflare's workflow visualizer renders a `.do(...)` call wrapped in
// a named helper as a generic `FunctionCall` node, hiding the literal
// step name on the dashboard graph. Inlining the `.do` call inside a
// `try/catch` block makes the visualizer emit a `TryNode` containing a
// `StepDo` node with the literal name, so the dashboard shows
// "publish:extracting" instead of "runStepWithFallback()".
//
// The `runStepWithFallback` helper is still exported from
// `scan-workflow.steps.ts` and is exercised by the unit tests there
// and by the entrypoint-level tests that simulate step failures; the
// module-level helper is preserved for behavior parity, not for graph
// visibility.
```

- [ ] **Step 9: Run the structural test to verify partial GREEN**

Run: `cd apps/workers && pnpm test -- scan-workflow.entrypoint.test`

Expected output: PARTIAL pass. The first test (`contains the expected literal step.do() call names in execution order`) now sees the 7 inlined step.do names, but is missing `publish:fetching` and `publish:retrieving` (Tasks 4 and 5). The second test (`does not call runStepWithFallback`) now PASSES (helperCalls === 0).

The first test should fail at the comparison of `ordered` with `EXPECTED_STEP_NAMES` because the array still expects `publish:fetching` and `publish:retrieving` entries that are not yet in the source.

- [ ] **Step 10: Commit the inlined try/catch blocks**

```bash
git add apps/workers/src/workflows/scan-workflow.ts
git commit -m "refactor(workflow): inline try/catch around 7 step.do calls for graph visibility"
```

---

## Task 3: Wrap success-path in `if (homepagePage.ok) { ... }`

**Files:**
- Modify: `apps/workers/src/workflows/scan-workflow.ts` — wrap everything after the `homepagePage.ok` early-return inside an `if (homepagePage.ok) { ... }` block

- [ ] **Step 1: Locate the boundary**

Find the early-return block:

```ts
if (!homepagePage.ok) {
  // ... phase-10:persist-terminal + return ...
}

// 3. fetch:<page> — four inlined literal-named `step.do` calls, one
//    per non-homepage page type.
```

The success-path starts at the `// 3. fetch:<page>` comment and runs to the end of `run()`. Wrap everything from that point through the final `return { ... }` inside `if (homepagePage.ok) { ... }`.

- [ ] **Step 2: Add the wrapper**

Insert `if (homepagePage.ok) {` immediately after the closing `}` of the `if (!homepagePage.ok) { ... }` block, and insert a matching `}` immediately before the final `return { ... }` of `run()`.

The opening of the success-path wrapper should look like:

```ts
if (!homepagePage.ok) {
  // ... existing failure path ...
  return {
    scanId: parsed.scanId,
    state: "failed" as ScanTerminalState,
    status: "needs_review" as ScanTerminalStatus,
    coverage: failedCoverage,
  };
}

// 3. fetch:<page> — four inlined literal-named `step.do` calls, one
//    per non-homepage page type.
//
//    (... existing comment ...)
//
// Cloudflare's workflow visualizer emits a discrete `IfBranch` for an
// explicit `if (cond) { ... }` block; without this wrapper, the visualizer
// treats the success path as the implicit "rest of function" tail and
// attaches the failure-path `phase-10:persist-terminal` to the left of
// `homepagePage.ok`. Wrapping the success path makes the dashboard graph
// render with the failure branch on the left and the success chain on
// the right.
if (homepagePage.ok) {
  // ... existing discover, fetch:*, extract, publish:*, etc. ...
}
```

Add a comment above the `if (homepagePage.ok) {` block explaining the visualizer rationale (see above).

- [ ] **Step 3: Close the wrapper before the final return**

Find the final `return` of `run()`:

```ts
return {
  scanId: parsed.scanId,
  state,
  status: finalStatus,
  coverage,
  reportUrl: report.url,
};
```

Insert a matching `}` just before this `return`. The final `return` stays outside the `if (homepagePage.ok) { ... }` block — it is reached only when `homepagePage.ok` is true (early return handles the false case).

- [ ] **Step 4: Verify indentation**

Run a formatter (`pnpm -F workers format` or whatever the repo uses) to re-indent the wrapped block. Confirm TypeScript compiles.

- [ ] **Step 5: Run tests**

Run: `cd apps/workers && pnpm test -- scan-workflow`

Expected output: all existing tests pass (the wrap is a structural change; runtime behaviour is preserved).

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/workflows/scan-workflow.ts
git commit -m "refactor(workflow): wrap success-path in if(homepagePage.ok) for graph layout"
```

---

## Task 4: Add `publish:fetching` step

**Files:**
- Modify: `apps/workers/src/workflows/scan-workflow.ts` — insert a new `try { step.do("publish:fetching", ...) } catch { log(...) }` block immediately after `parse-params` and before `fetch:homepage`

- [ ] **Step 1: Locate the insertion point**

Find `await step.do("fetch:homepage", ...)` — the first call after `parse-params`. Insert the new block just before it.

- [ ] **Step 2: Insert the publish:fetching block**

```ts
// publish:fetching: inline try/catch so the visualizer renders
// a `StepDo` node with the literal name. Fires immediately after
// parse-params so the polling client sees the "fetching" state
// for the duration of all page fetches. Best-effort: a transient
// D1 cold-start does not abort the scan.
try {
  await step.do("publish:fetching", DEFAULT_SCAN_STEP_CONFIG, () =>
    persistProgressPhase(
      { scanId: parsed.scanId, state: "fetching" },
      { db: this.env.DB, log, now },
    ),
  );
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "publish:fetching",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
}
```

- [ ] **Step 3: Run the structural test**

Run: `cd apps/workers && pnpm test -- scan-workflow.entrypoint.test`

Expected output: PARTIAL pass. The first test now sees 8 of the 9 expected names (still missing `publish:retrieving`). The structural test that checks `ordered` matches `EXPECTED_STEP_NAMES` will fail at `publish:retrieving`.

- [ ] **Step 4: Commit**

```bash
git add apps/workers/src/workflows/scan-workflow.ts
git commit -m "feat(workflow): publish fetching state to D1 before page fetches"
```

---

## Task 5: Add `publish:retrieving` step

**Files:**
- Modify: `apps/workers/src/workflows/scan-workflow.ts` — insert a new `try { step.do("publish:retrieving", ...) } catch { log(...) }` block between `phase-6:evaluate-license` and `phase-7:evaluate-rules`

- [ ] **Step 1: Locate the insertion point**

Find the `phase-6:evaluate-license` step.do call and the `phase-7:evaluate-rules` step.do call. Insert the new block between them.

- [ ] **Step 2: Insert the publish:retrieving block**

```ts
// publish:retrieving: inline try/catch so the visualizer renders
// a `StepDo` node with the literal name. Fires between phase-6
// (deterministic license eval) and phase-7 (RAG + AI eval) so
// the polling client sees the "retrieving" state for the duration
// of the slowest phase. Best-effort.
try {
  await step.do("publish:retrieving", DEFAULT_SCAN_STEP_CONFIG, () =>
    persistProgressPhase(
      { scanId: parsed.scanId, state: "retrieving" },
      { db: this.env.DB, log, now },
    ),
  );
} catch (cause) {
  log({
    level: "warn",
    event: "scan.step_fallback",
    step: "publish:retrieving",
    reason: cause instanceof Error ? cause.message : String(cause),
    at: now(),
  });
}
```

- [ ] **Step 3: Run the structural test to verify GREEN**

Run: `cd apps/workers && pnpm test -- scan-workflow.entrypoint.test`

Expected output: PASS. The first test now sees all 21 step.do() calls in the expected order. The second test (`does not call runStepWithFallback`) also passes.

- [ ] **Step 4: Commit**

```bash
git add apps/workers/src/workflows/scan-workflow.ts
git commit -m "feat(workflow): publish retrieving state to D1 before RAG phase"
```

---

## Task 6: Swap SCAN_PIPELINE order in `scan-stepper.tsx`

**Files:**
- Modify: `apps/web/src/components/scan-stepper.tsx` — change `SCAN_PIPELINE` array order
- Modify: `apps/web/src/components/scan-stepper.test.tsx` — update the "renders exactly the six pipeline steps in the canonical order" assertion
- Modify: `apps/web/src/components/scan-stepper.test.tsx` — update the `it.each` parameter list (cosmetic only — reorders for clarity, not required for correctness)

- [ ] **Step 1: Update SCAN_PIPELINE in scan-stepper.tsx**

Open `apps/web/src/components/scan-stepper.tsx`. Find:

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

Replace with:

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

- [ ] **Step 2: Update the test assertion**

Open `apps/web/src/components/scan-stepper.test.tsx`. Find the "renders exactly the six pipeline steps in the canonical order" test:

```ts
it("renders exactly the six pipeline steps in the canonical order", () => {
  render(<ScanStepper locale="vi" messages={baseMessages} currentState="fetching" />);

  const items = within(getList()).getAllByRole("listitem");
  expect(items).toHaveLength(SCAN_PIPELINE.length);
  expect(SCAN_PIPELINE).toEqual([
    "queued",
    "fetching",
    "extracting",
    "retrieving",
    "evaluating",
    "reporting",
  ]);
});
```

Replace the inner `expect(SCAN_PIPELINE).toEqual([...])` array with the new order:

```ts
  expect(SCAN_PIPELINE).toEqual([
    "queued",
    "fetching",
    "extracting",
    "evaluating",
    "retrieving",
    "reporting",
  ]);
```

- [ ] **Step 3: Update the `it.each` parameter list (cosmetic)**

In the same file, find:

```ts
it.each(["queued", "fetching", "extracting", "retrieving", "evaluating", "reporting"] as const)(
  "marks only the matching step as active for state=%s",
  ...
);
```

Replace the parameter list with:

```ts
it.each(["queued", "fetching", "extracting", "evaluating", "retrieving", "reporting"] as const)(
  "marks only the matching step as active for state=%s",
  ...
);
```

The per-state assertion is independent of pipeline order, so this change is purely cosmetic (test name display order).

- [ ] **Step 4: Run the web tests**

Run: `pnpm -F web test -- scan-stepper.test`

Expected output: PASS. The "canonical order" test now matches the new `SCAN_PIPELINE` order. The `it.each` test runs once per state and asserts independent behaviour.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/scan-stepper.tsx apps/web/src/components/scan-stepper.test.tsx
git commit -m "refactor(web): swap SCAN_PIPELINE order to match DB transitions"
```

---

## Task 7: Re-baseline snapshot test

**Files:**
- Modify: `apps/web/src/components/scan-stepper.snapshot.test.tsx` (or its snapshot file) — re-baseline the snapshot

- [ ] **Step 1: Run the snapshot test to see the diff**

Run: `pnpm -F web test -- scan-stepper.snapshot`

Expected output: FAIL. The snapshot was captured under the old `SCAN_PIPELINE` order and now diverges by one row swap.

- [ ] **Step 2: Update the snapshot**

If using Vitest with `toMatchSnapshot`, run with `-u` to update:

```bash
pnpm -F web test -- scan-stepper.snapshot -u
```

Inspect the snapshot diff to confirm only the row order changed (no other drift). If anything else changed, investigate before committing.

- [ ] **Step 3: Re-run to confirm GREEN**

Run: `pnpm -F web test -- scan-stepper.snapshot`

Expected output: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/scan-stepper.snapshot.test.tsx
git commit -m "test(web): re-baseline scan-stepper snapshot for new pipeline order"
```

---

## Task 8: Update `check-step-graph.mjs`

**Files:**
- Modify: `apps/workers/scripts/check-step-graph.mjs` — update `EXPECTED_STEP_NAMES` if the script asserts on workflow order

- [ ] **Step 1: Read the script**

```bash
cat apps/workers/scripts/check-step-graph.mjs
```

Identify the `EXPECTED_STEP_NAMES` constant. If the script also asserts order, update it to include `publish:fetching` and `publish:retrieving`, and to reflect the swapped evaluating / retrieving positions.

- [ ] **Step 2: Update EXPECTED_STEP_NAMES**

If the script's array is currently:

```js
const EXPECTED_STEP_NAMES = [
  "parse-params",
  "fetch:homepage",
  "discover:page-urls",
  "fetch:about",
  "fetch:privacy",
  "fetch:contact",
  "fetch:terms",
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

Replace with:

```js
const EXPECTED_STEP_NAMES = [
  "parse-params",
  "publish:fetching",
  "fetch:homepage",
  "discover:page-urls",
  "fetch:about",
  "fetch:privacy",
  "fetch:contact",
  "fetch:terms",
  "publish:extracting",
  "phase-2:extract-evidence",
  "phase-3:extract-signals",
  "phase-4:scan-assets-references",
  "phase-5:classify-asset-rights",
  "publish:evaluating",
  "phase-6:evaluate-license",
  "publish:retrieving",
  "phase-7:evaluate-rules",
  "phase-8:aggregate",
  "publish:reporting",
  "phase-9:persist-report",
  "phase-10:persist-terminal",
];
```

- [ ] **Step 3: Run the script**

Run: `node apps/workers/scripts/check-step-graph.mjs`

Expected output: exit code 0, no drift reported.

- [ ] **Step 4: Commit**

```bash
git add apps/workers/scripts/check-step-graph.mjs
git commit -m "chore(workflow): include publish:fetching + publish:retrieving in expected step list"
```

---

## Task 9: Verify

**Files:** none — read-only verification.

- [ ] **Step 1: Run all worker tests**

Run: `cd apps/workers && pnpm test`

Expected output: PASS. All existing tests + the new structural test pass.

- [ ] **Step 2: Run all web tests**

Run: `pnpm -F web test`

Expected output: PASS. All existing tests + the updated SCAN_PIPELINE assertion pass.

- [ ] **Step 3: Run root tests + build**

Run: `pnpm -w test && pnpm -w build`

Expected output: PASS for both.

- [ ] **Step 4: Run typecheck**

Run: `pnpm -w typecheck`

Expected output: PASS with no type errors.

- [ ] **Step 5: Run the step-graph script**

Run: `node apps/workers/scripts/check-step-graph.mjs`

Expected output: exit code 0.

- [ ] **Step 6: Confirm no stray `runStepWithFallback` calls in `scan-workflow.ts`**

Run: `grep -n "runStepWithFallback(" apps/workers/src/workflows/scan-workflow.ts`

Expected output: no matches. (The helper still exists in `scan-workflow.steps.ts` for unit tests; it just isn't called from the entrypoint anymore.)

- [ ] **Step 7: Final commit (if any verification-only edits)**

If Steps 1-6 required any fix-ups, commit them now. Otherwise this task is the end of the plan.

```bash
git status  # confirm clean
git log --oneline -10  # confirm the 7+ commits from this plan are present
```

---

## Self-Review

After writing this plan, I checked it against the spec:

1. **Spec coverage** — every goal in §2 maps to a task:
   - G1 (Step Graph shows literal names): Tasks 1, 2, 3, 4, 5
   - G2 (failure-branch graph fixed): Task 3
   - G3 (workflow emits all 6 states): Tasks 4, 5
   - G4 (UI list order = DB transition order): Task 6
   - G5 (semantic mapping): Task 5 (publish:retrieving between phase-6 and phase-7)
   - G6 (TDD coverage): Tasks 1, 2, 6, 7 (every code task is preceded by a test task or test step)
   - G7 (no PII/compliance change): no task touches logging shape or scoring; structural only

2. **Placeholder scan** — no `TBD`/`TODO`/`fill in details` in this plan. Every code step shows the exact replacement code.

3. **Type consistency** — `EXPECTED_STEP_NAMES` matches between Task 1 (test) and Task 8 (CI script). The 21 step names match the spec's §4.3 list.

4. **Ambiguity** — Task 3 says "wrap everything after the homepagePage.ok early-return inside `if (homepagePage.ok) { ... }`". This includes the final `return` of `run()`? No — the final `return` stays outside the wrapper because when `homepagePage.ok` is false we already early-returned. I clarified this in Step 3.
