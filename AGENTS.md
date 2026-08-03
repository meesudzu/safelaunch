# AGENTS.md — SafeLaunch

> Entry point for every AI coding agent (Codex, Claude Code, Copilot CLI, Gemini CLI, etc.) working in this repository.
>
> **Treat this file as binding instructions.** It overrides default agent behavior.

This file follows the convention recognized by Codex (`AGENTS.md`) and other agent platforms. It is automatically loaded at session start, so every agent — including ones dispatched as subagents on this project — should already see it. The local RTK reference at `/Users/friday/.codex/RTK.md` is also implicitly available via the global AGENTS chain.

---

## 1. Hard rule: invoke skills before acting

If there is even a 1% chance a skill applies to what you are doing, **invoke it first**. Do not rationalize skipping.

**Skill discovery order** (Codex reads in this order; other agents should mirror):

1. `.codex/skills/<name>/SKILL.md` — project skills (highest priority for this repo).
2. `~/.codex/skills/<name>/SKILL.md` — user skills (`superpowers:`, `seo:`, `hallmark`, etc.).
3. `~/.agents/skills/<name>/SKILL.md` — agents skills (`hallmark`, `find-skills`, ...).
4. Plugin-provided skills (e.g. `superpowers:brainstorming`).

## 2. Project skills — always start here

Every agent working in this repo MUST read these skills first:

| Skill                    | When to load                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `safelaunch-overview`    | Always — at session start, before any tool call beyond exploration.   |
| `safelaunch-compliance`  | Any change touching compliance, scoring, legal text, AI prompts, PII. |
| `safelaunch-ai-workflow` | Any non-trivial task — to find the right superpowers for the phase.   |

These live in `.codex/skills/` and are auto-loaded by Codex. Other agents should read them explicitly:

```
.codex/skills/safelaunch-overview/SKILL.md
.codex/skills/safelaunch-compliance/SKILL.md
.codex/skills/safelaunch-ai-workflow/SKILL.md
```

## 3. Global skills the team uses

These are installed at the user level (`~/.codex/skills/`, `~/.agents/skills/`) and are available to every team member. They are the **canonical tools** for their jobs — do not reimplement them.

### Superpowers (development process)

| Skill                                        | Use for                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `superpowers:using-superpowers`              | The skill invocation protocol itself.             |
| `superpowers:brainstorming`                  | Before any creative work — produces a design doc. |
| `superpowers:writing-plans`                  | Turn approved design into a phased plan.          |
| `superpowers:test-driven-development`        | Always. Encodes regulations as tests.             |
| `superpowers:systematic-debugging`           | When something fails before guessing.             |
| `superpowers:dispatching-parallel-agents`    | 2+ independent tasks without shared state.        |
| `superpowers:subagent-driven-development`    | Implementation plans in the current session.      |
| `superpowers:verification-before-completion` | Before claiming done. Actually run tests/build.   |
| `superpowers:requesting-code-review`         | Before merging.                                   |
| `superpowers:receiving-code-review`          | When review feedback arrives.                     |
| `superpowers:using-git-worktrees`            | Isolating feature work.                           |
| `superpowers:finishing-a-development-branch` | Merge / PR / cleanup.                             |

### Anti-slop design

| Skill                   | Use for                                               |
| ----------------------- | ----------------------------------------------------- |
| `hallmark`              | Any UI work — landing pages, redesigns, design study. |
| `design-taste-frontend` | Same scope, opinionated anti-slop frontend patterns.  |

The `safelaunch-ai-workflow` skill (`Phase 3`) is the authoritative mapping from task to skill. When in doubt, read it.

## 4. Operating principles

- **Compliance is a first-class feature.** See `safelaunch-compliance`.
- **Multi-jurisdiction by default.** GDPR, CCPA, Vietnam PDPD, US state laws, + 1 APAC.
- **No LLM-generated legal advice without citations.** Article + URL + `retrievedAt`.
- **No unverified slop UI.** Run `hallmark` before any visual change.
- **Privacy by design.** Don't add logging of PII. Don't expand data collection.
- **No work without a design.** Brainstorming → user-approved design → plan → code.
- **No merge without verification.** Tests + build + preview must pass.
- **No merge without code review.** Request review, evaluate feedback technically.

## 5. File-system rules

- Code lives under `apps/` and `packages/` (see `safelaunch-overview`).
- Human-facing docs under `docs/`.
- Skill specs and plans under `docs/superpowers/{specs,plans,reviews}/`.
- Never delete files unless the user explicitly asks. Hallmark/safe-edit rules apply.
- Token-optimize shell commands via `rtk` (see `/Users/friday/.codex/RTK.md`).

## 6. Quick command reference for the team

```bash
# Token-optimized shell wrapper (always prefer over raw commands)
rtk pnpm install
rtk pnpm -w test
rtk pnpm -w build
rtk git status

# Codex CLI
codex "Run safelaunch-compliance on the cookie banner PR"
codex "/seo audit https://staging.safelaunch.app"
```

---

## TL;DR for a new agent

1. You are in **SafeLaunch** — an AI compliance platform. Read `.codex/skills/safelaunch-overview/SKILL.md` first.
2. If the task touches compliance, legal text, AI prompts, or PII, also read `.codex/skills/safelaunch-compliance/SKILL.md`.
3. If the task is non-trivial, also read `.codex/skills/safelaunch-ai-workflow/SKILL.md` to find which superpowers to invoke.
4. UI work → invoke `hallmark`.
5. Always invoke `superpowers:brainstorming` before creative work. Always invoke `superpowers:verification-before-completion` before claiming done.
6. Use `rtk` for shell commands.
