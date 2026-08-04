# Recommended Vietnamese legal sources for the MVP

The production MVP currently retrieves approved provisions from four seeded
records representing three unique instruments. The following official sources
are candidates for future reviewed provisions; they are **not active scan
rules** until an article-level provision, source snapshot, reviewer approval,
and evaluation cases are added.

## 1. Luật Bảo vệ quyền lợi người tiêu dùng 2023

- Instrument: Luật số 19/2023/QH15.
- Potential coverage: transparency and information duties in consumer-facing
  digital services, as a supplement to the privacy-notice check.
- Official catalogue: <https://vbpl.vn/>
- Activation requirement: identify the exact applicable articles in the
  official text and add a reviewed `legal_documents` / `legal_provisions`
  record. Do not infer article numbers from secondary summaries.

## 2. Luật Báo chí 2016

- Instrument: Luật số 103/2016/QH13.
- Potential coverage: publisher, editorial-responsibility, and disclosure
  signals for the `electronic_press` category.
- Official catalogue: <https://vbpl.vn/>
- Activation requirement: verify the exact provisions and applicability to
  the scanned service before adding a citation to a production rule.

## 3. Luật Giao dịch điện tử 2023

- Instrument: Luật số 20/2023/QH15.
- Potential coverage: electronic transactions, electronic records, and digital
  service flows that are not covered by the current privacy/contact rules.
- Official catalogue: <https://vbpl.vn/>
- Activation requirement: define a concrete evidence signal and article-level
  citation first; the instrument is currently reference-only.

## Corpus integrity

All active citations must use the same reviewed `retrievedAt` as the seeded
corpus snapshot (`2026-07-29T00:00:00.000Z`) unless a later corpus refresh is
reviewed and versioned. A source appearing in this document must not be
presented to scan users as an active legal finding until that review workflow is
complete.
