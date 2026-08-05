---
title: Scan Flow Simplification — Font-Only Asset Scan, Coverage Dedupe, Citation Link Hardening
date: 2026-08-05
status: approved
owner: fullstack
project: SafeLaunch
related:
  - docs/superpowers/specs/2026-07-28-safelaunch-mvp-design.md
  - docs/superpowers/specs/2026-08-04-scan-workflow-step-graph-design.md
  - apps/workers/src/services/digital-assets.ts
  - apps/workers/src/workflows/scan-workflow.ts
  - apps/web/src/components/scan-progress.tsx
  - apps/web/src/components/report-view.tsx
---

# Scan Flow Simplification

## 1. Background

User report (2026-08-05) of three production defects on `/vi/report/rpt_9c2c4a2e…fadd4a95`:

1. **Scan scope too broad.** The asset scan currently classifies `image`, `audio`, `video`, and `font` references. The user wants only `font` to be checked for copyright exposure. Image / audio / video classification is unused by any downstream compliance rule, costs one network fetch per reference, and inflates the asset inventory in the report. Drop them.

2. **Scan-progress UI shows contradictory coverage.** The same page (`homepage`) appears in both `�ã quét` (fetched) and `Không thể quét` (failed) lists. Root cause: `apps/workers/src/workflows/scan-workflow.ts` line ~451 unconditionally prepends `"homepage"` to the `failed` array even though homepage fetch has already short-circuited the workflow on failure (line ~327-352). The persisted coverage then ships the contradiction to the client. Defensive dedupe is also missing in the UI.

3. **"Xem văn bản đầy đủ" link 404.** `report-view.tsx` renders `href={citation.url}` without validating the host. Some citations point to hard-coded vbpl.vn URLs that do not match the canonical vbpl.vn slug pattern (e.g. `https://vbpl.vn/van-ban/trung-uong/luat-so-huu-tri-tue-2022`). When the URL is stale, the user hits a 404.

## 2. Goals (in scope)

- `G1` Asset scan pipeline emits **only `font` references**. Image/audio/video branches are removed from `collectAssetReferences`. Existing `DigitalAssetKind` enum values remain for back-compat with persisted reports.
- `G2` The asset inventory section in the report UI states the scope explicitly: "Phạm vi: font" (vi) / "Scope: fonts" (en).
- `G3` Scan-coverage arrays never contain the same page in both `fetched` and `failed`. Fixed at the source (workflow) AND defensively in the UI.
- `G4` "Xem văn bản đầy đủ" link is hidden (with a plain-text fallback) when the citation host is not in the approved source list.
- `G5` Hard-coded vbpl.vn URL for the IP law citation uses a search-fallback URL so the page is reachable even if the canonical slug changes.
- `G6` All three behaviors are covered by unit tests (TDD). Existing tests keep passing.
- `G7` No new PII enters logs. No compliance claim loses its citation.
- `G8` No scoring rubric change in `packages/compliance-core`.
- `G9` No DB schema change.

## 3. Non-goals (out of scope)

- `N1` Removing `image`/`audio`/`video` from `DigitalAssetKind` enum (would break parsing of persisted reports; left for a future contract-version bump).
- `N2` Replacing the hard-coded IP-law citation with a runtime legal-corpus lookup. Would require a new admin endpoint and a corpus seed; deferred.
- `N3` Changing scoring, prompts, or retrieval layers in `packages/ai` or `packages/compliance-core`.
- `N4` New UI design language (this spec only touches text and an existing component; no new section).

## 4. Allow-list for citation hosts

A small allow-list is added to the web app for citation hosts (used by the UI guard in `report-view.tsx`). The list mirrors the source-authority list already present in `apps/workers/src/services/url-policy.ts` and `packages/compliance-core/src/jurisdictions.ts` (which whitelist `vbpl.vn`).

```ts
// apps/web/src/lib/citation-hosts.ts (new)
export const APPROVED_CITATION_HOSTS = [
  "vbpl.vn",
  "hoidapphapluat.vn",
  "thuvienphapluat.vn",
] as const;

export const isApprovedCitationUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return APPROVED_CITATION_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
};
```

If the host is not approved, the link is replaced with a `<p>` text node: "Liên kết nguồn không khả dụng" / "Source link unavailable".

## 5. Architecture

### 5.1 Backend (apps/workers)

```
src/
├── services/
│   └── digital-assets.ts          # collectAssetReferences() → font-only
│                                   # COPYRIGHT_CITATION.url → search URL
└── workflows/
    └── scan-workflow.ts           # coverage build: drop "homepage" from failed
```

- `collectAssetReferences` (in `digital-assets.ts`): remove the `image`, `audio`, and `video` `addReferences(...)` calls. Keep the `font` branch (link rel + `<style>` url + css url from inline page css). The dedupe-by-`(kind, url)` and 50-cap behavior stay.
- `COPYRIGHT_CITATION.url` (in `digital-assets.ts`): replace `https://vbpl.vn/van-ban/trung-uong/luat-so-huu-tri-tue-2022` with a vbpl.vn search URL that always 200s: `https://vbpl.vn/tim-kiem?SearchIn=all&q=Lu%E1%BA%ADt%20S%E1%BB%9F%20h%E1%BB%AFu%20tr%C3%AD%20tu%E1%BB%87%202022`.
- Workflow `coverage` build (around line 447-451 of `scan-workflow.ts`): use the existing `buildCoverage` helper instead of building the object ad-hoc, so the dedupe contract is enforced. Specifically:
  - `fetched`: `["homepage", ...fetcheds]`
  - `failed`: `Array.from(new Set(faileds))` ← **drop the bogus `"homepage"` prepending**
  - `skipped`: `[]`

### 5.2 Frontend (apps/web)

```
src/
├── components/
│   ├── scan-progress.tsx          # defensive dedupe across fetched/failed/skipped
│   └── report-view.tsx            # citation URL guard
├── lib/
│   └── citation-hosts.ts          # NEW: APPROVED_CITATION_HOSTS + isApprovedCitationUrl
└── messages/
    ├── report-vi.json             # add "asset.inventory.scope", update inventory title hint
    └── report-en.json             # same for English
```

- `scan-progress.tsx`: at render time, compute `effective` arrays where `fetched` wins over `failed` wins over `skipped`. Use a `Set<string>` shared across the three lists.
- `report-view.tsx`: wrap the `<a href={citation.url}>` in a conditional that imports `isApprovedCitationUrl`. When invalid, render a `<p>` placeholder.
- Messages: add `"asset.inventory.scope"` to both locale files with the scope line ("Phạm vi: font" / "Scope: fonts").

### 5.3 No DB / no migrations

Coverage is still stored as `coverage_json` TEXT in the `scans` table. The shape `{ fetched, failed, skipped }` is unchanged. No new columns.

## 6. Test plan

| File                                               | New / Update | Case                                                                     |
| -------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `apps/workers/src/services/digital-assets.test.ts` | UPDATE       | "collects only font references, dropping image/audio/video"              |
| same                                               | UPDATE       | "drops CSS background-image (image kind) from collected refs"            |
| `apps/workers/src/services/digital-assets.test.ts` | NEW          | "uses vbpl.vn search URL for COPYRIGHT_CITATION"                         |
| `apps/workers/src/workflows/scan-workflow.test.ts` | NEW          | "coverage does not include 'homepage' in failed when homepage succeeded" |
| `apps/web/src/components/scan-progress.test.tsx`   | NEW          | "does not render the same page in both fetched and failed lists"         |
| `apps/web/src/components/report-view.test.tsx`     | NEW          | "renders link when citation URL host is in approved list"                |
| same                                               | NEW          | "renders text fallback when citation URL host is unapproved"             |
| same                                               | NEW          | "renders text fallback when citation URL is malformed"                   |
| `apps/web/src/components/report-view.test.tsx`     | UPDATE       | Add `asset.inventory.scope` to test fixtures                             |
| `apps/web/messages/report-vi.json`                 | UPDATE       | Add `asset.inventory.scope`                                              |
| `apps/web/messages/report-en.json`                 | UPDATE       | Add `asset.inventory.scope`                                              |

## 7. Compliance checklist (per safelaunch-compliance skill)

- [x] Every claim cites a source. No change to scoring rubric; copyright citation `source`/`excerpt`/`retrievedAt` unchanged; only the URL string is updated (still vbpl.vn).
- [x] Affected jurisdictions unchanged (VN only for now).
- [x] No scoring rubric change (`packages/compliance-core/` untouched).
- [x] No new PII in logs.
- [x] AI-assisted copy unchanged.
- [x] Tests cover: URL allow-list membership, malformed URL handling, coverage dedup, scope-only-font asset collection.
- [x] `retrievedAt` for the IP-law citation is unchanged (`2026-08-05T00:00:00.000Z`).

## 8. Rollout

- Merge to `main` via PR. No feature flag needed (asset-inventory section is optional and renders only when assets exist; existing scans continue to be readable).
- Existing reports in DB still parse correctly (asset enum values preserved).
- Watch for any `image`/`audio`/`video` rows in `reports.payload_json` — those are read as-is (no migration), but new scans will not add more.

## 9. Future work (out of scope here)

- Migrate hard-coded IP-law citation to legal-corpus lookup (`packages/db` + admin legal endpoints already exist).
- Add a `fontFamily` heuristic to flag known commercial fonts (Arial, Helvetica, Times New Roman) when their source host is not Google Fonts.
- Move citation-host allow-list to a shared package (`packages/contracts` or new `packages/citations`) so workers and web stay in sync.
