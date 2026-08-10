# Defensive LLM output parser — design

> Authored 2026-08-10 in response to the production LLM response shape
> surfaced after PR #38 (model deprecation) + PR #39 (schema
> strictness). The 70B model consistently wraps its JSON in a markdown
> code fence and uses non-schema field names, so even with the relaxed
> schema from PR #39 the provider falls back to the generic
> "Không thể trích xuất đánh giá có cấu trúc..." rationale and we lose
> the model's actual response.

## Production evidence

Input the user pasted from production:

```
User: Category: electronic_press

Website evidence:
<untrusted_website_content>
Chính sách bảo mật dữ liệu cá nhân Đọc báo Dân trí trên mobile: IOS Android
Theo dõi Dân trí trên: Facebook Youtube Tiktok Telegram © 2005-2026
Bản quyền thuộc về Báo điện tử Dân trí
</untrusted_website_content>
```

Model completion:

````
```json
{
  "category": "electronic_press",
  "severity": "review",
  "confidence": 0.5,
  "reason": "Insufficient evidence to evaluate compliance"
}
````

````

Three failure modes:

1. **Markdown code fence wrapping.** `provider.ts:safeParseDraft`
   tries `JSON.parse("```json\n{...}\n```")` → throws → returns `null`
   → provider throws "AI provider returned a payload that did not
   match EvaluationDraftSchema".
2. **Wrong field name.** Model uses `reason`; schema requires
   `rationale`. Even if we strip the fence, `safeParse` would reject
   because `rationale` is missing.
3. **Missing required fields.** `evidenceIds`, `provisionIds`,
   `legalQuotes`, `recommendedAction` are absent. With the relaxed
   PR-39 schema the empty arrays are legal for `severity: "review"`,
   but `safeParse` still rejects because the *keys* are absent.

## Fix

Two layers:

### Layer 1 — tighter prompt

Update `SYSTEM_RULES` in `packages/ai/src/provider.ts` to specify the
exact schema fields. The model has been guessing because the prompt
just says "EvaluationDraft schema" without defining it.

### Layer 2 — defensive parser

Add `parseModelOutput(raw)` in `packages/ai/src/provider.ts` that:

1. Strips markdown code fences (both ```json\n...\n``` and ```\n...\n```).
2. Tries `JSON.parse` on the stripped string; falls back to extracting
   the first balanced `{ ... }` substring if that fails.
3. Maps known field aliases (`reason`/`explanation` → `rationale`,
   `citations` → `legalQuotes`, etc.).
4. Strips keys not in `EvaluationDraftSchema`.
5. Fills defaults for missing keys **only when** `severity ∈ {"review",
   "pass"}` (the no-ground-finding cases). For `severity: "high"` the
   schema's `superRefine` still rejects and the existing fallback
   takes over.

The parser returns the cleaned object; `safeParse` then validates it.

## Affected surfaces

| Path | What changes |
| --- | --- |
| `packages/ai/src/provider.ts` | New `parseModelOutput` helper. `safeParseDraft` uses it. `SYSTEM_RULES` updated to list the required fields explicitly. |
| `packages/ai/src/provider.test.ts` | Tests for markdown stripping, alias mapping, defensive defaults. |

## Compliance review (per `safelaunch-compliance`)

- [x] **Citation contract preserved.** A `high` draft still requires
      ≥1 evidenceId/provisionId/legalQuote via the existing
      `superRefine` from PR #39.
- [x] **AI-generated legal text still visually marked downstream.**
      No UI changes.
- [x] **Privacy by design.** Parsing happens entirely on the model's
      raw completion; we do not log or persist any new data.
- [x] **Multi-jurisdiction unaffected.**
- [x] **No "should/may/must" drift.** The `SYSTEM_RULES` wording is
      tightened, not relaxed.
- [x] **Tests cover** parser edge cases: fence-only output, plain
      JSON, JSON with extra keys, JSON with aliases, JSON missing
      required keys for `review`/`pass`.

## Verification plan

1. Failing tests first:
   - `parseModelOutput` strips ```json fences.
   - `parseModelOutput` strips ``` fences (no language hint).
   - `parseModelOutput` returns null for unparseable text.
   - `parseModelOutput` maps `reason` → `rationale` etc.
   - `parseModelOutput` fills defaults for `severity: "review"` with
     missing `evidenceIds`/`provisionIds`/`legalQuotes`.
   - `parseModelOutput` does NOT fill defaults for `severity: "high"`
     with missing `legalQuotes` (caller falls back).
2. `safeParseDraft` integration tests:
   - The exact production shape (markdown fence + missing fields +
     `reason`) parses into a usable `EvaluationDraft`.
3. `pnpm -r typecheck` clean.
4. `pnpm -r test` all green.

## Out of scope

- Switching to a different model that natively returns correct JSON.
- Switching to a structured-output API that guarantees schema
  compliance (e.g. tool/function calling). The current
  prompt-and-parse path is what `createEvaluationProvider` exposes.
- Persisting model completions to a corpus for regression testing.
- Translating the model rationale to Vietnamese in the parser; the
  `SYSTEM_RULES` already says the report is shown in Vietnamese and
  the existing fallback handles the case where the model's English
  rationale is the best we have.
````
