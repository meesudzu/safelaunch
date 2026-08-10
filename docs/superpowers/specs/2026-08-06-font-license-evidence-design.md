---
title: "Font Copyright Evidence — Inventory Grouping + Binary Inspection"
date: 2026-08-06
status: approved
owner: fullstack
project: SafeLaunch
related:
  - docs/compliance/rubrics/vn-mvp-v2-licensing-font-evidence-v1.md
  - docs/superpowers/specs/2026-08-05-scan-flow-simplification-design.md
  - apps/workers/src/services/digital-assets.ts
  - apps/workers/src/services/font-inspector.ts
  - apps/workers/src/services/font-grouping.ts
  - apps/workers/src/data/font-registry.json
  - apps/web/src/components/report-view.tsx
---

# Font Copyright Evidence — V1

## Background

User report (2026-08-06) of two production defects on `/vi/report/rpt_*`:

1. The digital-asset inventory currently lists every font file as its
   own row. A site that uses `Roboto-Regular/Bold/Italic/Medium.woff2|
.woff|.ttf` shows eight lines even though they all belong to the
   same font family. This makes the inventory noisy and pushes
   `verification before launch` noise to the top of the report.
2. The current "license evidence" classification is **HTML-only**
   (CC markers, generic license keyword, host-based provider
   hint). It cannot tell whether a self-hosted font is a known open
   face (Roboto, Inter, Source Serif 4) or a commercial one (Arial,
   Helvetica, Times New Roman). The user explicitly asked whether we
   can read the font's own metadata and cross-check it against a
   registry.

## Goals (in scope)

- `G1` Group font references into one row per family. The grouping
  key is the `fontInfo.familyName` (OpenType `name` ID 16, with
  fallback to ID 1). Variants are listed in an expandable
  `<details>` block, sorted by PostScript name.
- `G2` Parse the font binary with `fontkit` to read `familyName`,
  `subfamilyName`, `fullName`, `postscriptName`, `version`,
  `copyright`, `vendorId`, `OS/2.fsType`, and the
  `TTF/OTF/WOFF/WOFF2/TTC/DFont` format tag. TTC/DFont use the first
  face.
- `G3` Classify the font license into one of six statuses
  (`verified_open`, `declared_open`, `requires_license_proof`,
  `unknown`, `conflicting`, `unavailable`) using a versioned
  `font-registry.json` snapshot committed to the repo plus the
  binary's `fsType` field and the page's license markers.
- `G4` Always surface a "Verify before launch" hint when the
  family name matches a known commercial face (Arial, Helvetica,
  Times New Roman) **and** the host is not Google Fonts. Confidence
  is capped at 0.4 so it never escalates to `high`.
- `G5` Match the PostScript name and SHA-256 against the registry.
  Mismatch raises a `conflicting` finding with reason
  `registry_hash_mismatch`.
- `G6` Render the new `fontInventory` section in the report UI,
  with a per-family badge, expandable variants, and a link to the
  registry citation (allowlisted to non-legal sources only).
- `G7` Bump `analysisVersion` and `RUBRIC_VERSION` to
  `vn-mvp-v2-licensing-font-evidence-v1`. Old reports still parse
  correctly (the new fields are optional).

## Non-goals (out of scope)

- `N1` Live lookup against Monotype / Adobe / MyFonts / Vendor
  catalogs. V1 only uses a self-hosted, versioned snapshot
  (Google Fonts under SIL OFL, plus a curated list of Inter,
  Source Serif 4, JetBrains Mono).
- `N2` Storing the binary on R2 or Vectorize. Only the SHA-256 and
  redacted URL are persisted.
- `N3` Changing scoring. All font findings stay `review`. The
  aggregate `high_risk` is still driven by license / regulatory
  findings.
- `N4` Adding SVG-font / EOT support. The OpenType spec was
  standardised on WOFF/WOFF2; EOT is only relevant to legacy IE
  users.
- `N5` Removing the legacy `assetInventory` section. It remains in
  the payload for backward compatibility and is what the existing
  `asset.inventory.*` UI messages key off of.

## Architecture

```
apps/workers/
├── data/
│   └── font-registry.json          # Google Fonts OFL snapshot, versioned
├── services/
│   ├── font-inspector.ts           # parseFontBytes + assessFontLicense
│   ├── font-grouping.ts            # groupAssetsIntoFamilies + extractFontFamilyFromCss
│   ├── __fixtures__/
│   │   └── font-fixtures.ts        # inlined WOFF2 (vitest pool-workers compat)
│   ├── font-inspector.test.ts
│   ├── font-grouping.test.ts
│   └── digital-assets.ts           # existing collector (now also calls inspector + grouping)
└── test/
    └── fixtures/fonts/             # real WOFF2 fixtures (also inlined for tests)

apps/web/
├── src/components/report-view.tsx  # new "Font audit" section
├── src/lib/api-client.ts           # ReportFontInventoryDto + per-asset fields
└── src/lib/citation-hosts.ts       # new APPROVED_FONT_SOURCE_HOSTS
```

## Decisions & defaults

- 25 binaries per scan (`MAX_FONT_INSPECTIONS`). Past this, the
  assessment becomes `unavailable` with reason
  `size_or_count_limit`. This is enough for marketing sites
  (typically 3–10 font files) and protects the budget.
- 4 MB decompressed cap (`MAX_FONT_INSPECTION_BYTES`). Larger
  than the 2 MB cap on other assets because variable WOFF2
  subsets can legitimately exceed 2 MB.
- Cache the parsed `fontInfo` per SHA-256 within a single scan to
  avoid re-parsing duplicate faces.
- Grouping key is `fontInfo.familyName` (lowercased, trimmed). If
  the binary did not parse, we fall back to the
  `@font-face font-family` from the page HTML so the file still
  joins the right group.
- Mixed status within a family becomes `conflicting` with reason
  `family_status_mismatch`. The group is then marked as
  flagged.
- The `font.family.open_details` block is **open by default** so
  users see variants without an extra click. A future change
  can collapse it if reports become too long.

## Compliance & safety

- Every assessment carries at least one citation:
  `vn-ip-law-2022` (Berne / Luật SHTT 2022),
  `sil-open-font-license-1.1`, or
  `opentype-os2-fstype`. The registry citation is appended
  dynamically when the registry is consulted.
- The new `APPROVED_FONT_SOURCE_HOSTS` allowlist
  (`raw.githubusercontent.com`, `openfontlicense.org`,
  `learn.microsoft.com`) is **separate** from
  `APPROVED_CITATION_HOSTS` (the latter is still `vbpl.vn` only
  for legal citations). We deliberately do not blur the two.
- The collector redacts URLs (no query string, no hash) before
  persisting. SHA-256 of the bytes is the only stable identifier.
- The collector never logs the binary or the raw URL. Bounded
  fetch limits (2 MB compressed / 4 MB decoded) prevent
  resource-exhaustion attacks.
- All font-license findings default to `review`. We do **not**
  raise to `high` even when the binary is a known commercial
  face — web fonts are routinely embedded under permissive
  web-licensing and the user should verify before launch.
- The `fontLicense.status` field is **not** used to compute the
  aggregate `high_risk` scan status. The same approach the v2
  rubric already takes for asset evidence.

## Test plan

- `apps/workers/src/services/font-inspector.test.ts`: 16 cases
  covering real Roboto WOFF2 (Regular/Bold/Italic), parse
  failure, fsType branches, registry hash match, identity
  match, conflicting, page markers, parse_failed.
- `apps/workers/src/services/font-grouping.test.ts`: 13 cases
  covering family grouping, multi-host handling, CSS fallback,
  mixed status, alphabetical sort, non-font assets.
- `apps/workers/src/services/digital-assets.test.ts`: 14 cases,
  including the new font binary inspection block (4 cases).
- `apps/workers/src/data/font-registry.test.ts`: 8 cases
  covering snapshot shape, family coverage, deduplication,
  citation registry, zod round-trip.
- `apps/web/src/components/report-view.test.tsx`: 2 new font
  inventory cases.
- All other existing tests still pass (405 total).

## Rollout

- Worker bundle: 1.4 MB uncompressed (≈400 KB gzipped). The
  `fontkit` library dominates the increase; no other change
  affected size materially.
- New `build:font-registry` script in
  `apps/workers/package.json` regenerates
  `font-registry.json` from `google/fonts` (configurable to
  add other trusted sources).
- Deploy via existing PR flow. After deploy, smoke-test on
  1 site per category: Google Fonts (1 site), self-host OFL
  (1 site), system font (1 site), unknown `.ttf` (1 site), and
  24h.com.vn (1 site, the original bug report).
- Reports persisted under the previous analysis version still
  load correctly. The new `fontInventory` field is optional in
  the JSON.

## Future work

- Add Adobe Fonts (Typekit) snapshot. Their public CDN is
  `use.typekit.net`; we currently treat any host outside
  `fonts.gstatic.com` / `fonts.googleapis.com` as unknown.
- Add a "vendor" hint (the `OS/2.achVendID` 4-char code, e.g.
  `GOOG`, `MONOTYPE`, `ADBE`) to the registry so we can flag
  known vendors without exposing commercial catalog URLs.
- Render the report's `assetInventory` section as a thin
  fallback (only when `fontInventory` is missing) so old reports
  still look reasonable while new reports use the family view.
