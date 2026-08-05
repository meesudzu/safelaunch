---
title: Scan Flow Simplification — Implementation Plan
date: 2026-08-05
status: ready
spec: docs/superpowers/specs/2026-08-05-scan-flow-simplification-design.md
owner: fullstack
project: SafeLaunch
related:
  - apps/workers/src/services/digital-assets.ts
  - apps/workers/src/workflows/scan-workflow.ts
  - apps/web/src/components/scan-progress.tsx
  - apps/web/src/components/report-view.tsx
---

# Scan Flow Simplification — Implementation Plan

The plan below follows strict TDD (red → green → refactor) for every behavioral change. Tests are added/updated first, the failure is observed, then the implementation is the smallest delta that flips the test green. Refactor happens only when green.

Each task lists the file(s) touched and the test command that must pass before moving on. The full verification step at the end runs the whole monorepo.

---

## Phase A — Font-only asset scan

### A1. digital-assets: drop image/audio/video from `collectAssetReferences`

**TDD sequence:**

1. **RED** — update `apps/workers/src/services/digital-assets.test.ts`:
   - Change existing test "collects image, audio, font and CDN references with redacted URLs" to expect only `["font"]`.
   - Add test "drops image, audio, and video references while keeping fonts".
   - Add test "drops CSS background-image (image kind) references".
2. Run `pnpm --filter workers test apps/workers/src/services/digital-assets.test.ts` — must see the new assertions FAIL.
3. **GREEN** — edit `apps/workers/src/services/digital-assets.ts::collectAssetReferences`:
   - Remove the three `addReferences(refs, sourceUrl, sourceUrl, "image" | "audio" | "video", ...)` calls.
   - Keep the `font` branch.
   - Keep the dedupe-by-`(kind, url)` and `.slice(0, MAX_ASSETS)`.
4. Re-run test — must pass.
5. **REFACTOR** — none expected; if helper signatures can be tightened, do so without changing behavior. Re-run test.

**Files touched:**
- `apps/workers/src/services/digital-assets.ts`
- `apps/workers/src/services/digital-assets.test.ts`

### A2. Report messages: asset inventory scope text

**TDD-light (data-only, no behavior test):**

1. Update `apps/web/messages/report-vi.json` and `apps/web/messages/report-en.json`:
   - Add `"asset.inventory.scope": "Phạm vi: font"` (vi).
   - Add `"asset.inventory.scope": "Scope: fonts"` (en).
2. Update `apps/web/src/components/report-view.test.tsx` test fixtures (`viMessages`, `enMessages`) to include the new key.
3. Update `apps/web/src/components/report-view.tsx::ReportMessages` interface to add the field.
4. Render the scope line in the asset inventory section under the summary line.
5. Run `pnpm --filter web test apps/web/src/components/report-view.test.tsx` — must pass.

**Files touched:**
- `apps/web/messages/report-vi.json`
- `apps/web/messages/report-en.json`
- `apps/web/src/components/report-view.tsx`
- `apps/web/src/components/report-view.test.tsx`

---

## Phase B — Coverage deduplication

### B1. scan-workflow: do not put `homepage` in `failed`

**TDD sequence:**

1. **RED** — add test in `apps/workers/src/workflows/scan-workflow.test.ts`:
   - "persists coverage with 'homepage' in `fetched` only, never in `failed`, when homepage fetch succeeds".
   - Drive `runScan` with a mocked fetcher that succeeds for homepage but fails for `about`. Assert `coverage.fetched.includes("homepage") === true` and `coverage.failed.includes("homepage") === false`.
2. Run `pnpm --filter workers test apps/workers/src/workflows/scan-workflow.test.ts` — must FAIL.
3. **GREEN** — edit `apps/workers/src/workflows/scan-workflow.ts` around line 447-451:
   - Replace the ad-hoc `coverage` object with a call to `buildCoverage(["homepage", ...fetcheds], faileds, [])`.
   - Confirm `buildCoverage` already dedupes via a shared `seen` set (it does — verify and rely on it).
4. Re-run test — must pass.
5. **REFACTOR** — keep the diff minimal. Re-run test.

**Files touched:**
- `apps/workers/src/workflows/scan-workflow.ts`
- `apps/workers/src/workflows/scan-workflow.test.ts`

### B2. scan-progress UI: defensive dedupe across fetched/failed/skipped

**TDD sequence:**

1. **RED** — add test in `apps/web/src/components/scan-progress.test.tsx`:
   - "does not render the same page in both fetched and failed lists".
   - Render with `coverage: { fetched: ["homepage", "about"], failed: ["homepage", "privacy"], skipped: [] }`.
   - Assert screen shows homepage once (success state), and does NOT show `! homepage`.
2. Run `pnpm --filter web test apps/web/src/components/scan-progress.test.tsx` — must FAIL.
3. **GREEN** — edit `apps/web/src/components/scan-progress.tsx`:
   - Add `const seen = new Set<string>()`, then build `effectiveFetched`, `effectiveFailed`, `effectiveSkipped` by skipping items already in `seen` and adding items to `seen` as they are processed in priority order.
4. Re-run test — must pass.
5. **REFACTOR** — extract helper `dedupeCoverage(coverage)` for readability; re-run test.

**Files touched:**
- `apps/web/src/components/scan-progress.tsx`
- `apps/web/src/components/scan-progress.test.tsx`

---

## Phase C — Citation link hardening

### C1. report-view: guard citation URL against unapproved hosts

**TDD sequence:**

1. **RED** — add `apps/web/src/lib/citation-hosts.ts` with `APPROVED_CITATION_HOSTS` and `isApprovedCitationUrl` (pure, no React).
2. **RED** — add `apps/web/src/lib/citation-hosts.test.ts`:
   - "returns true for vbpl.vn URL"
   - "returns true for subdomain of vbpl.vn"
   - "returns false for unrelated host"
   - "returns false for malformed URL"
3. Run `pnpm --filter web test apps/web/src/lib/citation-hosts.test.ts` — must FAIL (file does not exist yet).
4. **GREEN** — implement the helper.
5. Re-run — must pass.
6. **RED** — add tests in `apps/web/src/components/report-view.test.tsx`:
   - "renders the provision link when citation URL host is approved"
   - "renders text fallback when citation URL host is unapproved"
   - "renders text fallback when citation URL is malformed"
7. Run — must FAIL.
8. **GREEN** — edit `apps/web/src/components/report-view.tsx::FindingCard`:
   - Import `isApprovedCitationUrl`.
   - Compute `const linkHref = isApprovedCitationUrl(citation.url) ? citation.url : null`.
   - Render `<a>` only if `linkHref !== null`; otherwise render `<p data-testid="citation-link-unavailable">` with localized message.
   - Add the message keys `"finding.source_link_unavailable"` to `report-vi.json` / `report-en.json` and the `ReportMessages` interface.
9. Re-run — must pass.
10. **REFACTOR** — keep helpers tiny. Re-run.

**Files touched (new + edit):**
- `apps/web/src/lib/citation-hosts.ts` (NEW)
- `apps/web/src/lib/citation-hosts.test.ts` (NEW)
- `apps/web/src/components/report-view.tsx`
- `apps/web/src/components/report-view.test.tsx`
- `apps/web/messages/report-vi.json`
- `apps/web/messages/report-en.json`

### C2. Fix hard-coded vbpl.vn URL for IP-law citation

**TDD sequence:**

1. **RED** — add test in `apps/workers/src/services/digital-assets.test.ts`:
   - "uses vbpl.vn search URL for COPYRIGHT_CITATION" — drive an asset reference that triggers a `digital-rights` finding, then assert `finding.citations[0].url` is a `vbpl.vn/tim-kiem` URL.
2. Run — must FAIL.
3. **GREEN** — edit `apps/workers/src/services/digital-assets.ts::COPYRIGHT_CITATION`:
   - Replace `url` with the search URL (URL-encoded `Luật Sở hữu trí tuệ 2022`).
4. Re-run — must pass.

**Files touched:**
- `apps/workers/src/services/digital-assets.ts`
- `apps/workers/src/services/digital-assets.test.ts`

---

## Phase D — Verify

Run from the repo root:

```bash
rtk pnpm install
rtk pnpm -w test
rtk pnpm -w build
rtk pnpm --filter workers lint
rtk pnpm --filter web lint
```

All must succeed with zero new failures. If a pre-existing test fails unrelated to this change, document it in the PR description but do not regress this change.

Smoke-check the live report page:
- `apps/web/src/app/[locale]/report/[token]/page.tsx` still renders without changes.

---

## Phase E — Review & merge

1. `superpowers:requesting-code-review` — request a review with the compliance PR checklist (see design §7) pasted into the PR description.
2. `superpowers:receiving-code-review` — evaluate any feedback technically before applying.
3. `superpowers:finishing-a-development-branch` — merge to `main` and clean up the worktree.

---

## Risk register

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing report payloads with `image`/`audio`/`video` assets no longer display | Low | Enum preserved; UI simply skips rendering when inventory array is empty for new scans. |
| Search URL for IP law changes (vbpl.vn refactors) | Low | Search URL has been stable since 2010. Even if it breaks, the UI guard from C1 hides the link. |
| Workflow change regresses a downstream consumer of `coverage` | Low | `coverage` shape unchanged; only the contents of the `failed` array differ for the `homepage` entry. |
| UI dedupe breaks a legitimate "homepage failed" message | Low | Backend fix removes the bug; UI dedupe is a safety net. If homepage actually fails, the workflow returns early with `state: "failed"` and never reaches the dedupe branch. |
