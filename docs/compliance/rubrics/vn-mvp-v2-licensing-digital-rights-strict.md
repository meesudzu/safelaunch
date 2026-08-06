# VN MVP v2 — licensing and digital-rights strict rubric

Version: `vn-mvp-v2-licensing-digital-rights-strict`
Jurisdiction enabled: `VN`
Reviewed: `2026-08-04`

## Revision log

| Date       | Change                                                                                                                                                                                                                                                                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-06 | Digital-rights findings for `no_license_evidence` / `copyright_notice_only` / `inaccessible` / `conflicting` are `review` (was `high`) for all asset findings — which today covers fonts only (see _Digital assets_ below). Rationale text in the report softened from "tín hiệu rủi ro" to "tín hiệu xem xét". | Web fonts (Google Fonts under SIL OFL, Adobe Fonts ToS, self-hosted OFL/CC) are routinely embedded with permissive web-licensing. The collector only inspects redacted URLs and bounded-response hashes, so a missing-evidence signal reflects detection limits, not the absence of a license. Downgrading keeps the same "verify before launch" action while avoiding an unintended `high_risk` aggregate status for the common case where the font is correctly licensed but the page carries no license marker. Citation framing for the underlying law is unchanged (Berne Convention + Vietnam IP Law references already shipped via COPYRIGHT_CITATION). |

**Aggregate impact:** a page that previously flipped the overall scan to `high_risk` solely because of font license-evidence gaps now reports `needs_review`. All other severity rules in this rubric remain `high` as written above.

**Reproducibility note:** the rule-id and `domain` of every digital-rights finding is unchanged. Only the `severity` field changed. Scan reproducibility for any prior run is preserved by re-running with the historical `analysisVersion` if needed.

## Scope

The scan reports source-backed signals for service characteristics, license
claims, and referenced digital assets. It does not prove ownership or conclude
copyright infringement from a URL, filename, hash, login form, or missing
metadata alone.

## Service-signal gates

- A login or registration form is a supporting signal only.
- A social-network license check requires observed user-generated content plus
  at least one observed public-profile, feed, follow/friend, comment, or share
  signal.
- An electronic-press check uses the selected category or an observed
  editorial-publishing signal.
- An online-game check uses the selected `online_game` category.

## Severity

- `pass`: the requirement does not apply or the configured registry confirms a
  matching, current license.
- `high`: an activated requirement has no proof, is not found, mismatches the
  detected subject/type, is expired, or cannot currently be verified.
- Every high result is a `high_risk` status in this strict rubric. User-facing
  rationale must still say “unverified / missing evidence” where applicable and
  must not say that infringement or an illegal operation has been proven.

## Digital assets

The collector covers image, audio, video, and font URLs referenced by HTML,
inline CSS, and one directly referenced external stylesheet. It stores only
redacted URLs and bounded-response hashes; it does not retain original binary
assets.

`no_license_evidence`, `copyright_notice_only`, `inaccessible`, and
`conflicting` are high-priority rights signals. The report instructs the user
to verify contracts, purchase records, attribution, or provider terms.

## Citation and source gate

Every user-facing legal finding includes a citation object with `source`, `url`,
`retrievedAt`, and an excerpt. Before activating a new production legal rule,
replace the review-marker citations for electronic press/social-network checks
with an approved article-level provision from the official corpus and add
reviewed evaluation fixtures. The current game check uses the existing
approved provision `vn-pd-72-2013-game-license`.

## Privacy and SSRF controls

- Do not log raw asset URLs, query tokens, binary content, or PII.
- Only HTTP(S) asset references are considered.
- Private, loopback, link-local, internal, and metadata hosts are blocked.
- Redirects, response size, total assets, and request duration are bounded.
