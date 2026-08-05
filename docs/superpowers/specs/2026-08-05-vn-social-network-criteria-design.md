---
title: "VN Social-Network License Criteria — Refactor `hasSocialNetworkSignals`"
date: 2026-08-05
status: approved
owner: fullstack
project: SafeLaunch
related:
  - docs/superpowers/specs/2026-07-28-safelaunch-mvp-design.md
  - packages/compliance-core/src/licensing.ts
  - packages/compliance-core/src/license-registry.ts
  - docs/workflow-steps.vi.md
  - docs/workflow-steps.en.md
---

# VN Social-Network License Criteria — Refactor `hasSocialNetworkSignals`

## 1. Background

User feedback (2026-08-05): the current implementation of
`hasSocialNetworkSignals` in `packages/compliance-core/src/licensing.ts`
correctly excludes "login alone" from triggering a Vietnamese social-network
license check, but the gates that **do** trigger the check are too narrow
compared to the regulatory definition.

The current code requires:

```
ugc  AND  at least one of { public_profile, content_feed,
                            follow_or_friend, comment, share }
```

Per **Nghị định 27/2018/NĐ-CP** (which amends **Nghị định 72/2013/NĐ-CP**),
a service is classified as a "mạng xã hội" (social network) when, after login,
users can perform community/sharing behaviors. The decree lists four
distinguishing behaviors, any combination of which qualifies:

1. **Tạo trang cá nhân (Profile)** → signal `public_profile`.
2. **Tự do đăng tải nội dung (Self-publish content)** → signal `ugc`.
3. **Tương tác đa chiều (Multi-directional interaction)** →
   signals `follow_or_friend`, `comment`, `share`.
4. **Tạo diễn đàn / Hội nhóm (Forum / Group)** → signal `content_feed`.

The current gates miss real social-network patterns:

| Observed signals                       | Current   | Per regulation |
| -------------------------------------- | --------- | -------------- |
| `login`                                | false ✓   | false ✓        |
| `login` + `ugc`                        | false     | false          |
| `login` + `ugc` + `public_profile`     | true ✓    | true ✓         |
| `login` + `ugc` + `comment`            | true ✓    | true ✓         |
| `login` + `public_profile` + `comment` | **false** | **true** ✗     |
| `login` + `content_feed` + `comment`   | **false** | **true** ✗     |
| `login` + `public_profile` + `follow`  | **false** | **true** ✗     |

A pure forum (criteria 3 + 4) or a social-discovery app (criteria 1 + 3)
would not be flagged today, yet both fall squarely inside the licensing
scope.

The citation attached to the social-network check also points at
**Luật An toàn thông tin mạng 2015**, which is about contact disclosure
and content moderation, not the social-network definition. The user
explicitly cited **Nghị định 72/2013/NĐ-CP** and
**Nghị định 27/2018/NĐ-CP** as the controlling instruments.

## 2. Goals (in scope)

- `G1` `hasSocialNetworkSignals` returns `true` whenever the service shows
  at least **two distinct** non-login community/sharing behaviors drawn
  from the four regulatory criteria. Single behaviors and login-only
  signals stay at `false`.
- `G2` The citation for `licenseType: "social_network"` points at
  **Nghị định 27/2018/NĐ-CP** (amending Nghị định 72/2013/NĐ-CP). The
  `VBPL_SLUGS.social_network` slug in `license-registry.ts` follows.
- `G3` Rationale strings explicitly explain why login alone is insufficient
  and reference the four regulatory criteria.
- `G4` All changes are covered by unit tests (TDD). Existing tests in
  `licensing.test.ts` and `license-registry.test.ts` keep passing.
- `G5` Bilingual workflow docs (`workflow-steps.vi.md`, `workflow-steps.en.md`)
  describe the updated gate and citation.
- `G6` No DB schema change, no AI-prompt change, no UI change. Rubric
  version unchanged. `login` signal stays a valid kind; it just stops
  counting toward the social-network gate.

## 3. Non-goals (out of scope)

- `N1` Adding new `ServiceSignalKind` values.
- `N2` Switching from `InMemoryLicenseRegistry` to `vbplLicenseRegistry`
  in the production scan workflow (orthogonal work).
- `N3` Localizing the rationale strings — keep them Vietnamese to match
  the existing report copy.

## 4. Design

### 4.1 New gate

```ts
// Per Nghị định 27/2018/NĐ-CP (amending Nghị định 72/2013/NĐ-CP, Article 1).
// Login/registration alone is identity only — not a community behavior —
// so it is intentionally excluded from the count.
const SOCIAL_NETWORK_BEHAVIORS: readonly ServiceSignalKind[] = [
  "public_profile", // criterion 1: Tạo trang cá nhân
  "ugc", // criterion 2: Tự do đăng tải nội dung
  "follow_or_friend", // criterion 3: Tương tác đa chiều (theo dõi/kết bạn)
  "comment", // criterion 3: Tương tác đa chiều (bình luận)
  "share", // criterion 3: Tương tác đa chiều (chia sẻ)
  "content_feed", // criterion 4: Tạo diễn đàn / Hội nhóm
];

const SOCIAL_NETWORK_MIN_DISTINCT_KINDS = 2;

export const hasSocialNetworkSignals = (signals: readonly ServiceSignal[]): boolean => {
  const observed = new Set(
    signals.filter((signal) => signal.observed).map((signal) => signal.kind),
  );
  let distinct = 0;
  for (const kind of SOCIAL_NETWORK_BEHAVIORS) {
    if (!observed.has(kind)) continue;
    distinct += 1;
    if (distinct >= SOCIAL_NETWORK_MIN_DISTINCT_KINDS) return true;
  }
  return false;
};
```

### 4.2 Updated citation

`SOCIAL_CITATION` in `licensing.ts` and `VBPL_SLUGS.social_network` in
`license-registry.ts` both move to the amending decree:

```
provisionId: "vn-pd-27-2018-social-network"
source:      "Nghị định 27/2018/NĐ-CP sửa đổi, bổ sung Nghị định 72/2013/N�-CP"
url:         "https://vbpl.vn/van-ban/trung-uong/nghi-dinh-27-2018-nd-cp"
```

The excerpt summarises the four distinguishing behaviors so the report
UI can paraphrase it with attribution.

### 4.3 Updated rationale

`rationaleFor(...)` for `required_unavailable` (the common no-license
state) is rewritten to explain _both_ why login alone is insufficient
and why the gate fires.

### 4.4 Workflow-doc updates

`docs/workflow-steps.vi.md` and `docs/workflow-steps.en.md` swap the
description for `social_network` from "fires only when `ugc` is observed
**and** at least one of ... is also observed" to a two-distinct-behaviors
description, and add the citation pointer to the amending decree.

## 5. Test plan (TDD)

New unit tests in `packages/compliance-core/src/licensing.test.ts`:

| Signals                                     | Expected   |
| ------------------------------------------- | ---------- |
| `[login]`                                   | false      |
| `[login, public_profile]`                   | false      |
| `[login, ugc]`                              | false      |
| `[login, public_profile, ugc]`              | true       |
| `[login, ugc, comment]`                     | true       |
| `[login, ugc, share]`                       | true       |
| `[login, ugc, follow_or_friend]`            | true       |
| `[login, ugc, content_feed]`                | true       |
| `[login, public_profile, comment]`          | true (NEW) |
| `[login, public_profile, follow_or_friend]` | true (NEW) |
| `[login, content_feed, comment]`            | true (NEW) |
| `[login, content_feed, share]`              | true (NEW) |
| `[login, editorial_publishing, ugc]`        | true       |

Existing tests (`login` alone, `ugc` + `public_profile`, declared/verified
license, registry wiring) keep their assertions unchanged.

## 6. Compliance PR checklist

- [x] Every claim cites a source (article + URL + `retrievedAt`).
- [x] Affected jurisdictions enumerated; "single country" paths flagged.
- [x] Scoring rubric change documented in `docs/compliance/rubrics/` → N/A (rubric version unchanged).
- [x] No PII added to logs/analytics.
- [x] AI-assisted copy is visually marked. → N/A (no AI copy).
- [x] Tests cover: rubric reproducibility, citation presence, jurisdiction filtering.
- [x] Corpus `retrievedAt` updated if regulations cited changed → citation constant uses the existing `2026-08-05T00:00:00.000Z` stamp.
