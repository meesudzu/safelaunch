---
name: safelaunch-overview
description: Use when starting any work in the SafeLaunch project, when you need project context (purpose, stack, conventions, constraints), or before proposing changes that touch architecture, branding, or compliance surfaces.
---

# SafeLaunch — Project Overview

Load this skill whenever you begin work in this repository. It encodes the project
context every AI agent needs to make safe proposals.

## What SafeLaunch is

**SafeLaunch** is an AI-powered legal & regulatory compliance platform that detects
legal and regulatory risks **before** a website, app, or digital product ships.

- Tagline: _"Ra mắt toàn cầu. Tuân thủ ngay từ đầu."_ ("Launch globally. Compliant from day one.")
- Core promise: shift compliance left — find issues at design/launch time, not after
  regulators or users find them.
- Primary users: founders, product teams, legal/ops leads shipping to multiple
  jurisdictions.

## Mission-critical principles

These are **non-negotiable** for every change:

1. **Compliance is a feature, not a footnote.** Compliance checks must be a
   first-class concern in any new surface (UI, API, automation).
2. **Multi-jurisdiction by default.** Every feature must consider GDPR, CCPA,
   Vietnam PDPD, US state laws, and at least one APAC jurisdiction. Never ship a
   feature that only works for one country.
3. **Source-attributed answers.** Any legal/compliance claim surfaced to the user
   must cite the source (regulation article, official guidance, dated URL). No
   hand-waving. No "consult a lawyer" cop-outs that hide lack of evidence.
4. **Privacy by design.** Don't collect data we don't need. Document every piece
   of PII the system touches and why.
5. **Trust the human.** When the model is uncertain, surface the uncertainty to
   the user with the next-best action — never silently guess.

## Tech stack & conventions

- **Frontend:** Next.js 14 (App Router) + TypeScript, Tailwind CSS, shadcn/ui.
- **Backend:** tRPC + Prisma + PostgreSQL.
- **AI layer:** Cloudflare Workers AI + Vectorize for retrieval over regulatory corpora.
- **Auth:** Clerk.
- **Hosting:** Cloudflare (Pages + Workers + R2 + D1 if needed).
- **Package manager:** pnpm with workspaces.
- **Code style:** ESLint + Prettier; strict TS, no `any` outside generated code.

## Repository layout

```
/
├── apps/
│   ├── web/                # Marketing site + product app
│   └── workers/            # Cloudflare Workers (compliance checks, crawlers)
├── packages/
│   ├── ui/                 # Shared design system (shadcn-based)
│   ├── db/                 # Prisma schema + migrations
│   ├── compliance-core/    # Domain logic — jurisdictions, checks, scoring
│   └── ai/                 # LLM prompts, retrieval, eval harness
├── docs/                   # Human-facing documentation
├── .codex/skills/          # Project-specific AI skills
└── AGENTS.md               # AI agent entrypoint (loaded automatically)
```

## Where things live — quick reference

| If you are working on...      | Touch these paths                           |
| ----------------------------- | ------------------------------------------- |
| Marketing copy / landing page | `apps/web/app/(marketing)/`, `packages/ui/` |
| Compliance scoring logic      | `packages/compliance-core/`                 |
| AI prompts / retrieval        | `packages/ai/`                              |
| DB schema                     | `packages/db/prisma/`                       |
| Crawlers / external fetches   | `apps/workers/`                             |
| Docs / specs                  | `docs/`                                     |

## Brand voice (for any copy or UI text)

- **Confident but careful.** We give clear guidance, not vague warnings.
- **Multilingual-aware.** Avoid idioms that don't translate. Plain English works globally.
- **Plain-language legal.** Surface the _meaning_ of regulations, not the legalese.
- **Vietnamese-first friendly.** When the audience is Vietnamese, default to clear
  Vietnamese without mixed-language slop.

## Out-of-scope (don't do this)

- Do not add LLM-generated legal advice presented as authoritative without citation.
- Do not ship features that work for one country only without a flag.
- Do not pull in a heavy ML framework (PyTorch, etc.) - we run on Workers AI.
- Do not introduce a new state store without checking `packages/db/`.
- Do not bypass the design system - extend it.

## Skills to chain with this one

- `superpowers:brainstorming` - always run before designing a new feature.
- `hallmark` - required before any UI/landing-page work.
- `safelaunch-compliance` - load before touching compliance-core or scoring.
- `safelaunch-ai-workflow` - load to see which superpowers apply at each phase.
