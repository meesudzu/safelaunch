---
name: safelaunch-compliance
description: Use when designing, reviewing, or changing any compliance surface (a jurisdiction check, a scoring rule, an evidence citation, a regulatory corpus update, or any feature that touches user data, privacy, or legal claims). Also use before adding any AI-generated legal/compliance output to the product.
---

# SafeLaunch — Compliance-First Engineering

This skill encodes the rules every AI agent must follow when touching the parts
of SafeLaunch that advise users on legal/regulatory matters. **Hallmark of this
project: every compliance surface must be auditable, sourced, and jurisdiction-aware.**

## When to invoke this skill

Load it BEFORE any of the following:

- Designing a new compliance check (cookie banner, GDPR consent flow, age gate, ...).
- Changing scoring/severity logic in `packages/compliance-core/`.
- Adding or editing prompts in `packages/ai/` that produce legal claims.
- Adding a new jurisdiction or category to the system.
- Modifying how evidence/citations are stored or surfaced.
- Writing copy that makes a compliance claim (UI text, marketing, emails).
- Reviewing a PR that touches any of the above.

If you are unsure whether a change qualifies, **load this skill anyway** and check.

## Hard rules

### 1. Every compliance claim must have a citation

Any sentence that tells the user what a regulation requires, prohibits, or
recommends must end with a citation object:

```ts
type Citation = {
  source: string; // e.g. "GDPR Art. 7" or "Vietnam PDPD Art. 11"
  url?: string; // official source URL when available
  retrievedAt: string; // ISO date the source was last verified
  excerpt?: string; // optional quoted excerpt
};
```

- No citation = no claim. Do **not** paraphrase without attribution.
- If the model cannot cite, it must say so explicitly and route the user to a human.

### 2. Multi-jurisdiction handling

- Default to "all jurisdictions checked" rather than a single-country default.
- Every compliance check declares which jurisdictions it applies to.
- When two jurisdictions conflict (e.g. EU vs US), surface both with their citations
  and rank by user's declared operating region, never silently pick one.

### 3. Severity scoring is explainable

`packages/compliance-core/scoring/*` must:

- Use a **named, documented rubric** (no magic numbers without a comment explaining them).
- Return a `rationale` string in the result, not just a score.
- Be reproducible: same input + same rubric version = same output.

### 4. Privacy by design

- Never log PII to console or analytics. Use hashed or redacted forms.
- User-submitted URLs go through a redaction pass before being stored in vector indexes.
- Cookies and trackers set by the SafeLaunch app itself must respect the user's
  own compliance findings (we dogfood our product).

### 5. AI-generated legal text

- Treat AI output as a _draft_ until a human signs off. UI must visually mark
  "AI-assisted" with a tooltip explaining the limitation.
- Never claim "this is legal advice" anywhere in the product. Use neutral wording:
  "compliance signal", "checklist item", "evidence-backed guidance".
- Always show the underlying regulation text alongside any paraphrase.

## Anti-patterns (do NOT do)

- "Just summarize the GDPR and call it done" without article-level citations.
- Hardcoded jurisdiction list in a UI component (use the data layer).
- A single severity score with no rationale string.
- Using "should" / "may" / "must" interchangeably — pick one and match the regulation.
- Saving LLM raw outputs as the user-facing answer.
- Treating the legal corpus as evergreen. Sources must have a `retrievedAt` and
  a refresh job (see `apps/workers/refresh-corpus/`).

## Required companions

Before writing any compliance code, you MUST also load:

- `safelaunch-overview` - for stack and layout conventions.
- `superpowers:brainstorming` - to align on intent before designing checks.
- `superpowers:test-driven-development` - compliance logic MUST be test-driven.
  Tests are how we encode "the regulation says X" into code.

## Review checklist (paste into PR descriptions)

Copy this into any PR that touches compliance surfaces:

```markdown
### Compliance PR checklist

- [ ] Every claim cites a source (article + URL + retrievedAt).
- [ ] Affected jurisdictions enumerated; "single country" paths flagged.
- [ ] Scoring rubric change documented in `docs/compliance/rubrics/`.
- [ ] No PII added to logs/analytics.
- [ ] AI-assisted copy is visually marked.
- [ ] Tests cover: rubric reproducibility, citation presence, jurisdiction filtering.
- [ ] Corpus `retrievedAt` updated if regulations cited changed.
```
