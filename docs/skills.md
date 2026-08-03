# Skills Catalog

This is the canonical catalog of AI skills available to the SafeLaunch team. It exists so that every team member — human or AI — answers "which skill do I use for X?" the same way.

> **If a skill applies to your task, you do not have a choice — you must use it.** (paraphrased from `superpowers:using-superpowers`).

## Layer 1 — Project skills (`.codex/skills/`)

These live in the repo and are auto-loaded for any agent working here. They encode **our** rules.

| Skill                    | One-line description                                                             | SKILL.md                                                 |
| ------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `safelaunch-overview`    | Project context: what SafeLaunch is, stack, layout, brand voice, what's banned.  | [link](../.codex/skills/safelaunch-overview/SKILL.md)    |
| `safelaunch-compliance`  | Compliance-first engineering: citations, jurisdictions, scoring rubric, privacy. | [link](../.codex/skills/safelaunch-compliance/SKILL.md)  |
| `safelaunch-ai-workflow` | The four-phase dev loop mapped to specific superpowers + hallmarks.              | [link](../.codex/skills/safelaunch-ai-workflow/SKILL.md) |

When any agent — human or AI — opens the project, **read all three** before doing anything beyond exploration.

## Layer 2 — Superpowers (development process)

Installed via the OpenAI Curated `superpowers` plugin. Available to every team member that has the plugin installed (`codex plugin install superpowers`).

| Skill                                        | Trigger it when...                                                 |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `superpowers:using-superpowers`              | First message of any session — confirms the skill protocol.        |
| `superpowers:brainstorming`                  | Before any creative work: new feature, component, behavior change. |
| `superpowers:writing-plans`                  | After design approval — break work into phased tasks.              |
| `superpowers:test-driven-development`        | Always. Tests are how we encode regulations, scoring, contracts.   |
| `superpowers:systematic-debugging`           | On any failure: tests, build, runtime, before guessing a fix.      |
| `superpowers:dispatching-parallel-agents`    | 2+ truly independent tasks, no shared state, parallel-safe.        |
| `superpowers:subagent-driven-development`    | Executing an implementation plan in this session via subagents.    |
| `superpowers:verification-before-completion` | Before claiming done: run tests, build, deploy preview.            |
| `superpowers:requesting-code-review`         | Before merging major work.                                         |
| `superpowers:receiving-code-review`          | When review feedback arrives.                                      |
| `superpowers:using-git-worktrees`            | Isolating a feature branch from the main checkout.                 |
| `superpowers:finishing-a-development-branch` | At merge time: rebase, squash, push, clean up.                     |

## Layer 3 — Anti-slop design

These exist to fight the LLM-default look-and-feel. **Required for any UI work.**

| Skill                   | Use for                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `hallmark`              | Anti-AI-slop design for greenfield, audits, redesigns, design study from URL/screenshot. |
| `design-taste-frontend` | Anti-slop frontend patterns — landing pages, portfolios, redesigns.                      |

`hallmark` has three explicit verbs:

| Verb                | Behavior                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| `hallmark audit`    | Score a target against the anti-pattern list. Read-only.                |
| `hallmark redesign` | Redesign inside existing implementation boundaries. Default scope.      |
| `hallmark study`    | Extract the design DNA from a URL or screenshot. Then build or lock it. |

If the brief doesn't map to `audit` / `redesign` / `study`, treat it as default and follow the Design flow.

## Layer 4 — Domain specialists (optional, project-applicable)

These are pre-installed and available when the relevant work shows up. Do not invoke them speculatively.

| Skill                      | Domain                                     | Trigger example                                      |
| -------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `seo`                      | Search engine optimization                 | "audit safelaunch.app for SEO"                       |
| `seo-audit`                | Full multi-agent SEO audit                 | "run a full SEO audit"                               |
| `seo-page`                 | Single-page SEO deep-dive                  | "analyze the landing page"                           |
| `seo-schema`               | Schema.org / JSON-LD generation            | "add Organization schema"                            |
| `seo-sitemap`              | Sitemap generation & validation            | "generate a sitemap"                                 |
| `cloudflare`               | Cloudflare Workers / Pages / D1 / R2 / KV  | "deploy this Worker"                                 |
| `agents-sdk`               | Cloudflare Agents SDK                      | "build a stateful agent"                             |
| `durable-objects`          | Cloudflare Durable Objects                 | "set up coordination on Cloudflare"                  |
| `cloudflare-email-service` | Transactional email on Cloudflare          | "send a welcome email"                               |
| `workers-best-practices`   | Cloudflare Workers production patterns     | "review this Worker for prod"                        |
| `mmx-cli`                  | mmx CLI: text, image, video, speech, music | "generate a hero image"                              |
| `web-perf`                 | Web performance / Core Web Vitals          | "measure LCP on the landing page"                    |
| `pdf`                      | PDF read / create / inspect / verify       | "extract text from this compliance PDF"              |
| `documents`                | `.docx`, Word, Google Docs artifacts       | "draft a compliance report .docx"                    |
| `spreadsheets`             | Spreadsheet creation, edit, analysis       | "build the rubrics spreadsheet"                      |
| `presentations`            | Slide deck creation                        | "make a pitch deck for the compliance check feature" |
| `find-skills`              | Discover & install new skills              | "is there a skill for X?"                            |

## How to pick — the decision tree

```
Are you doing creative work (new feature, component, behavior)?
  -> superpowers:brainstorming      (mandatory, no exceptions)

Does it touch compliance surfaces, scoring, AI prompts, or PII?
  -> safelaunch-compliance          (mandatory)

Does it touch UI / landing pages / design?
  -> hallmark                       (mandatory)

Did something fail?
  -> superpowers:systematic-debugging

Have you written code?
  -> superpowers:test-driven-development        (always)
  -> superpowers:verification-before-completion (before done)
  -> superpowers:requesting-code-review         (before merge)

Need to parallelize?
  -> superpowers:dispatching-parallel-agents
     or superpowers:subagent-driven-development
```

## Installing skills for new team members

These skills are user-installed (each teammate runs the same setup once):

```bash
# 1. Install the Codex CLI (if not done)
brew install --cask codex

# 2. Install the superpowers plugin (the team's process skills)
codex plugin install superpowers

# 3. Install the anti-slop design skill
codex plugin install hallmark   # or use the installable skill catalog

# 4. Verify
codex "/list-skills"            # or your platform's equivalent
ls ~/.codex/skills/             # confirm superpowers + seo + ... appear
ls ~/.agents/skills/            # confirm hallmark + find-skills + ...
```

The **project** skills (Layer 1) come with the repo — no per-user install needed. New team members just `git clone` and they're loaded.

## Updating / adding skills

- **Project skills**: edit the `SKILL.md` in `.codex/skills/<name>/`. They auto-reload.
- **Superpowers / hallmark / SEO**: upgrade via `codex plugin update <name>`.
- **New skill**: use `superpowers:writing-skills` (TDD applied to docs) or
  `codex:skill-creator` for project skills.

See [`workflow.md`](./workflow.md) for the full update ritual.
