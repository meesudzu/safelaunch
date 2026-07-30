# SafeLaunch Homepage — Visual Direction

> Source: `hallmark` design flow, applied to the MVP brief.
> Audience: founders, product teams, and legal/ops leads shipping apps to Vietnam.
> Locale: bilingual (`/vi`, `/en`) via the Next.js `[locale]` dynamic segment.

## 1 · Brand stance

- **Confident but careful.** SafeLaunch is a compliance signal — a tool that issues a verdict on a public website. The UI has to feel sober, evidence-led, and unfashionable-in-a-good-way. The opposite of a marketing site.
- **Multilingual-aware.** Vietnamese is the default (`/vi`). The copy never leans on idioms that don't translate. Inter and Source Serif 4 both render Vietnamese diacritics correctly.
- **Plain-language legal.** Surface the meaning of the regulation, not the legalese. Pair every claim with its source.
- **Vietnamese-first warmth.** The palette and copy carry a quiet Vietnamese sensibility (warm off-white background, ink-on-sand contrast, deep teal accent) — not the cold steel-blue of a generic compliance SaaS.

## 2 · Anti-slop rules (per hallmark)

The MVP release plan already names the anti-slop surface. Hallmark enforces it concretely:

- **No gradient backgrounds.** Background is a single warm off-white (`oklch(0.97 0.01 80)`). Surface cards are pure white.
- **No glassmorphism.** No `backdrop-filter`, no blurred cards, no glass buttons.
- **No icon-3-up feature row.** There is no "three reasons to choose us" marketing strip. The form IS the page.
- **No italic display headers.** Headings are roman; emphasis is carried by weight or a drawn underline.
- **No emoji as bullets.** None.
- **No "Built with ❤️" footer.** A plain text line with the source-of-law citation and a non-advice disclosure.
- **No generic hero / 3-features / CTA / footer rhythm.** This page is two columns (left: editorial explanation, right: the form). Not a hero.

## 3 · Palette — "Trust Sand"

Restrained, warm, evidence-led. One anchor accent, one warm secondary.

| Token | Value (OKLCH) | Hex | Use |
| --- | --- | --- | --- |
| `--bg` | `oklch(0.97 0.01 80)` | `#F8F4ED` | Page background, warm off-white |
| `--surface` | `oklch(0.995 0.003 80)` | `#FDFCF9` | Form card surface |
| `--ink` | `oklch(0.20 0.01 250)` | `#181A1F` | Primary text, deep ink |
| `--ink-soft` | `oklch(0.40 0.01 250)` | `#4A4D55` | Secondary text |
| `--accent` | `oklch(0.42 0.07 195)` | `#1E6B73` | Primary action, deep teal (Vietnamese-leaning calm) |
| `--accent-hover` | `oklch(0.36 0.07 195)` | `#15585F` | Hover state |
| `--gold` | `oklch(0.70 0.10 85)` | `#A6822C` | Non-advice disclosure, citation markers |
| `--rule` | `oklch(0.88 0.01 80)` | `#D8D2C2` | Hairline borders |
| `--error` | `oklch(0.50 0.18 27)` | `#B43A1F` | Inline validation errors |
| `--success` | `oklch(0.45 0.10 155)` | `#1F7A50` | Submission accepted state |

The palette is anchored to `--accent` (deep teal) and `--ink` (deep ink). The warm off-white background replaces the usual cold white that compliance tools use, signalling "we are on your side" rather than "we are a regulator."

## 4 · Typography — "2 + 1" pairing

Per Hallmark: exactly two display voices (a serif for editorial weight + a sans for UI) plus one mono for technical content.

| Role | Family | Source | Notes |
| --- | --- | --- | --- |
| Display / editorial | **Source Serif 4** | Google Fonts | Vietnamese diacritics supported; roman only, weight 400 / 600 / 700 |
| Body / UI | **Inter** | Google Fonts | System-class sans; weight 400 / 500 / 600 |
| Mono | **JetBrains Mono** | Google Fonts | Used for the URL form input only |

Italic survives only inside running paragraph copy (e.g., the non-advice disclosure). All headings are roman.

## 5 · Macrostructure — editorial two-column

Single page. No marketing carousel, no testimonial wall, no pricing. Two columns on `≥ 768 px`, stacked on mobile.

```
┌─────────────────────────────────────────────────────────┐
│ SafeLaunch                                  VI | EN       │  ← N5 minimal text-only top bar
├──────────────────────────┬──────────────────────────────┤
│                          │  ┌────────────────────────┐  │
│ Editorial headline       │  │ [URL input]            │  │
│ (Source Serif 4, 56 px)  │  │ [Category select]      │  │  ← form card surface
│                          │  │ [Turnstile token]      │  │     (white on warm-bg)
│ Subhead                  │  │ [Submit button]        │  │
│ (Inter, 18 px)           │  └────────────────────────┘  │
│                          │                              │
│ Trust signals            │  Non-advice disclosure       │
│ (small Inter, 13 px)     │  (italic body, gold)         │
│                          │                              │
│ Source-of-law citation   │                              │
│ (Inter, 13 px)           │                              │
├──────────────────────────┴──────────────────────────────┤
│ SafeLaunch · Báo cáo này là tín hiệu tham khảo,         │  ← Ft2 small text-only footer
│ không phải tư vấn pháp lý. · vbpl.vn · v0.1            │
└─────────────────────────────────────────────────────────┘
```

### Section list (page-scope)

1. **Top bar** (N5): brand mark left, locale switcher right. Single row, no dropdowns.
2. **Editorial column** (left, ≥ 768 px):
   - Headline: "Ra mắt toàn cầu. Tuân thủ ngay từ đầu." / "Launch globally. Compliant from day one."
   - Subhead: one sentence on what SafeLaunch does.
   - Trust signals: small inline list of "Không yêu cầu tài khoản · Mã nguồn mở · Trích dẫn đầy đủ" (No account · Open source · Full citations).
   - Source-of-law citation: a single sentence pointing to vbpl.vn.
3. **Form card** (right, ≥ 768 px; full width below):
   - URL input (mono font, large, single-line).
   - Category select (`Loại ứng dụng`): online_game, electronic_press, digital_entertainment — with one-line Vietnamese descriptions.
   - Jurisdiction indicator (disabled): "🇻🇳 Việt Nam — MVP" — locked for the MVP per the plan.
   - Turnstile token field (hidden when not on Cloudflare; rendered as a real widget otherwise).
   - Submit button "Kiểm tra website" / "Scan website".
   - **Non-advice disclosure** paragraph, italic body copy, sitting *above* the submit button so users see it before they submit.
4. **Footer** (Ft2): single line with the disclosure + the source-of-law host + the build version.

### Mobile (`< 768 px`)

Editorial column collapses on top of the form. The form card becomes full-width with `min-width: 0` and `overflow-wrap: anywhere` on the URL input so long URLs wrap inside the field. No horizontal scroll. No two-line buttons.

## 6 · Form contract

The form submits the `CreateScanInput` contract (already in `@safelaunch/contracts`):

```ts
{
  url: string,                  // valid URL, https only
  jurisdiction: "VN",          // locked in the MVP, selector disabled
  category: "online_game" | "electronic_press" | "digital_entertainment"
  // turnstileToken?: string     // optional in MVP, required once domain is live
}
```

Client-side Zod validation. The category select surfaces a one-line Vietnamese description for each option so non-Vietnamese reviewers can still operate it.

## 7 · Component boundaries

- `app/[locale]/layout.tsx` — server-rendered root with `<html lang>` + font loading + `<body>` warm-bg.
- `app/[locale]/page.tsx` — server-rendered home, fetches category descriptions and copy from `messages/{vi,en}.json`.
- `components/scan-form.tsx` — `"use client"` form, handles submission, validation, and the Turnstile widget.
- `messages/vi.json` + `messages/en.json` — flat key/value strings (no nested ICU; the MVP scope is small).
- `lib/api-client.ts` — typed wrapper around `POST /v1/scans` with the public API origin from a validated env var.
- `next.config.mjs` + `open-next.config.ts` — OpenNext config for Cloudflare Workers.

No Clerk, no account UI, no marketing analytics. Just the form and the disclosure.

## 8 · Quality gates

Per the release plan and Hallmark's slop-test suite:

- `[P3]` No gradient, no glassmorphism, no italic display headers, no icon-3-up.
- `[P2]` All buttons and primary links fit on one line at 320 px width.
- `[P2]` Source Serif 4 / Inter / JetBrains Mono loaded via `next/font/google` with Vietnamese subset.
- `[P2]` Non-advice disclosure sits **above** the submit button, italic body copy, gold accent.
- `[P2]` URL form input uses mono font, `min-width: 0`, `overflow-wrap: anywhere` for long URLs.
- `[P2]` Jurisdiction selector is disabled (MVP scope is VN only) but still rendered with the flag glyph.
- `[P1]` API CORS is restricted to the exact `WEB_ORIGIN` from the validated env config.
- `[P1]` Tests cover: submit with valid input, validation errors for malformed URL, category selection, jurisdiction disabled, disclosure visible above submit.

## 9 · Mobile responsiveness

Verified at 320 / 375 / 414 / 768 px. The form input's URL must wrap inside the field (no horizontal scroll). The headline wraps inside long Vietnamese diacritic clusters via `overflow-wrap: anywhere; min-width: 0` on the heading wrapper.

## 10 · Change log

- `v1` — initial design direction, recorded before `apps/web` was scaffolded.
