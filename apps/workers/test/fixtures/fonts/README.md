# Test font fixtures

These WOFF2 files are downloaded from Google Fonts for unit tests in
`apps/workers/src/services/font-inspector.test.ts` and
`apps/workers/src/services/font-grouping.test.ts`.

They are committed to the repo so the parser can be exercised against
real binary content (and so the registry hash logic can be checked with
known-good values).

## Source

- URL: <https://fonts.googleapis.com/css2?family=Roboto>
- License: SIL Open Font License 1.1 (`OFL.txt` shipped in
  <https://github.com/google/fonts/tree/main/ofl/roboto>)
- Retrieved: 2026-08-06
- Files: `roboto-regular.woff2`, `roboto-bold.woff2`, `roboto-italic.woff2`
  (subset URLs differ across Google Fonts snapshots; content is the
  canonical Roboto face as published by Google Fonts under OFL).
