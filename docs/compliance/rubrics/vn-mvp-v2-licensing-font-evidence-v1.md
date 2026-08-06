# Font Copyright Evidence — Rubric v1

Version: `vn-mvp-v2-licensing-font-evidence-v1`
Date: 2026-08-06
Owner: fullstack
Supersedes: `vn-mvp-v2-licensing-digital-rights-strict` (kept for historical
reference; not used by new scans anymore).

## What this rubric measures

This rubric is the strict-mvp rule for classifying the **font copyright
signal** surfaced by the digital-rights scan. It does **not** prove
infringement or grant a license. Every public claim cites a source
(article + URL + `retrievedAt`).

For every font binary the collector downloads (up to 25 binaries per scan,
4 MB decompressed each), the worker:

1. Parses the font's `name` and `OS/2.fsType` tables with `fontkit` to
   get the canonical family / subfamily / full name / PostScript name /
   version / copyright / vendor / fsType.
2. Hashes the bytes with SHA-256 (already part of the existing asset
   pipeline).
3. Calls `assessFontLicense(...)` which returns one of six statuses:
   - `verified_open` — matched the registry (hash or PostScript name +
     Google Fonts host) or has fsType `installable` plus a Google Fonts
     identity match.
   - `declared_open` — page text or binary metadata declares an
     open license (Creative Commons, royalty-free, OFL, …).
   - `requires_license_proof` — fsType restricts embedding OR the
     family name is a known commercial face (Arial / Helvetica / Times
     New Roman) on a non-Google host. The output is **always** flagged
     as "Gợi ý" (suggestion), never as confirmed infringement.
   - `unknown` — no license evidence found in the binary, registry, or
     page markers.
   - `conflicting` — registry has the same PostScript name but the SHA
     does not match (possible fork), OR multiple files in the same
     family resolve to different statuses.
   - `unavailable` — binary parse failed or inspection was skipped due
     to the 25-bin cap / 4 MB cap.
4. Groups variants of the same family into one row (`FontFamilyGroup`).
   The grouping key is `fontInfo.familyName`; if the binary did not
   parse, we fall back to the `@font-face` family declared in the page
   HTML.

## Severity

All font-license findings default to `review` (never `high`). Rationale
matches the previous rubric: web fonts are routinely embedded under
permissive web-licensing (Google Fonts OFL, Adobe Fonts ToS,
self-hosted OFL/CC), and a missing-evidence signal reflects the
detection limit, not the absence of a license. The user is asked to
verify before launch.

| Status                   | Severity in report | Notes                                                                                       |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------- |
| `verified_open`          | pass (no finding)  | The asset is exposed in the inventory with a green badge.                                   |
| `declared_open`          | review             | Inventory shows a blue badge; user still confirms contract terms.                           |
| `requires_license_proof` | review             | Inventory shows a gold badge; "Gợi ý" tooltip makes it clear this is a hint, not a verdict. |
| `unknown`                | review             | Inventory shows a grey badge; "Chưa tìm thấy bằng chứng".                                   |
| `conflicting`            | review             | Inventory shows a red badge; users should investigate (fork / mismatched binary).           |
| `unavailable`            | pass (no finding)  | Inventory shows a muted badge; binary was not downloaded.                                   |

## Sources and citations

Every assessment must carry a citation set. The static citation table
in `apps/workers/src/services/font-inspector.ts` covers:

- `vn-ip-law-2022` — Luật Sở hữu trí tuệ 2022 (Berne Convention
  alignment for VN). URL: vbpl.vn search.
- `sil-open-font-license-1.1` — OFL 1.1 (openfontlicense.org).
- `opentype-os2-fstype` — Microsoft Learn OpenType spec for
  `OS/2.fsType`.

The registry citation (`google-fonts-snapshot-2026-08`) is appended
dynamically whenever the registry is consulted (matched by hash or
PostScript name).

## Multi-jurisdiction handling

Default jurisdiction: **VN (Vietnam)**. The scope is unchanged from
the previous rubric: GDPR, CCPA, and APAC laws are flagged through the
same citation set; the worker does not collect PII, so the new field
does not introduce a separate compliance surface.

## Privacy and SSRF controls

- Font URLs are redacted before being persisted (no query string, no
  hash).
- Bounded fetcher: 4 MB decompressed per font, 25 binaries per scan.
  Binary is never persisted; only the SHA-256 hash is kept.
- No raw URL or binary content in observability logs.
- Private/loopback/link-local/metadata hosts remain blocked.

## Reproducibility

- `RUBRIC_VERSION` and `ANALYSIS_VERSION` are bumped to
  `vn-mvp-v2-licensing-font-evidence-v1`. Reports persisted under the
  previous version still parse correctly; the new fields are optional.
- Re-running a scan with the previous `analysisVersion` produces the
  historical output verbatim.
- The font registry is a versioned snapshot committed to the repo at
  `apps/workers/src/data/font-registry.json`. Refresh via
  `pnpm -F @safelaunch/workers run build:font-registry` and commit.

## Rollout checklist

- [x] Tests cover: parsing real WOFF2 (Roboto Regular/Bold/Italic),
      hash-match vs identity-match, conflicting for SHA mismatch,
      declared-open for CC markers, unknown fallback, and registry
      schema round-trip.
- [x] Maximum font binary size: 4 MB (vs 2 MB for other assets).
- [x] Maximum per-scan font inspections: 25; past this the assessment
      becomes `unavailable` with reason `size_or_count_limit`.
- [x] No PII captured; only SHA-256 hash and redacted URL are stored.
- [x] Report JSON backward-compatible (new fields optional).
- [x] UI: `apps/web/src/components/report-view.tsx` renders the new
      `fontInventory` section in both `vi` and `en` locales.
