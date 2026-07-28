---
name: safelaunch-ai-workflow
description: Use when starting any non-trivial task in this repo (new feature, refactor, design change, PR review, bug investigation). Maps the team's AI-assisted dev workflow to specific superpowers + project skills so every agent follows the same loop.
---

# SafeLaunch — AI-Assisted Development Workflow

This skill is the **single source of truth** for which AI skills the team uses,
in which order, and for which task. Load it whenever a task is non-trivial —
new feature, refactor, design surface, bug investigation, PR review.

If a task is trivial (typo, one-line config tweak) you can skip the workflow, but
you still MUST invoke `superpowers:verification-before-completion` before declaring done.

## The four phases

Every meaningful change goes through these phases. Each phase names the skills
the agent MUST invoke.

### Phase 1 — Understand (no code yet)

Skills to invoke, in order:

1. `superpowers:using-superpowers` — confirms the skill flow itself.
2. `safelaunch-overview` — load project context.
3. `safelaunch-compliance` — load if the task touches compliance, legal text,
   user data, scoring, or AI prompts.
4. `superpowers:brainstorming` — **required for any creative work** (new feature,
   new component, behavior change). Produces a written design doc saved to
   `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.

Stop condition: you have a written design the user has approved. Do **not** start
writing code before this is true. There are no exceptions for "small" features.

### Phase 2 — Plan

Skills to invoke:

5. `superpowers:writing-plans` — turn the approved design into a phased
   implementation plan.
6. `superpowers:using-git-worktrees` — isolate the work.

Output: a plan file at `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`.

### Phase 3 — Build

Skills to invoke, depending on the slice:

7. `superpowers:test-driven-development` — **always**. Tests encode the regulations,
   the scoring rubric, and the public contracts. No exceptions.
8. `superpowers:dispatching-parallel-agents` or
   `superpowers:subagent-driven-development` — when you have 2+ independent tasks
   that can run without shared state.
9. `hallmark` (or `design-taste-frontend`) — **required for any UI work**:
   - new landing/marketing page
   - redesign of an existing surface
   - visual study of a reference
   See `hallmark` skill for the verbs (`audit`, `redesign`, `study`).
10. `superpowers:systematic-debugging` — when something fails before guessing fixes.

### Phase 4 — Verify & Ship

Skills to invoke, in order:

11. `superpowers:verification-before-completion` — actually run the tests,
    actually build, actually deploy to a preview. No "should work" claims.
12. `superpowers:requesting-code-review` — request a review before merge.
13. `superpowers:receiving-code-review` — when feedback arrives, evaluate it
    technically before applying.
14. `superpowers:finishing-a-development-branch` — merge / PR / cleanup.

## Quick reference table

| Task type                         | Minimum skill chain                                                  |
| --------------------------------- | -------------------------------------------------------------------- |
| New product feature               | using-superpowers > overview > brainstorming > writing-plans > TDD > verification > code-review > finishing |
| Compliance-surface change         | ... add `safelaunch-compliance` after `overview` ...                 |
| New landing/marketing page        | ... add `hallmark` in Phase 3 ...                                   |
| Bug fix (reproducible)            | using-superpowers > overview > systematic-debugging > TDD > verification |
| Refactor (no behavior change)     | using-superpowers > overview > TDD (characterization tests first) > verification |
| Dependency / config bump          | overview > verification > finishing                                  |
| PR review (incoming)              | using-superpowers > overview > receiving-code-review                 |
| Design extraction from a URL/pic  | hallmark `study` verb                                                |
| Doc-only / copy edit              | overview > verification (build still has to pass)                    |

## Anti-slop rules (carried from `hallmark`)

For any UI work, additionally obey:

- **Structural variety.** Two pages must not share hero-3-features-CTA-footer rhythm.
- **No LLM defaults.** Reject centered hero + gradient + 3-icon-row + glassmorphism
  unless the brief actually calls for it.
- **Real type pairings.** Pick from `hallmark`'s free-font pairing list. No Inter-only.
- **Colour anchored to a palette.** No random hex.

For non-UI copy (markdown, docs, READMEs), additionally obey:

- **No filler intros.** Don't open with "In today's fast-paced world...".
- **No emoji as bullet points** unless the brand explicitly uses them.
- **No AI hedge phrases** ("it's important to note that", "dive into", "unlock").
- **Active voice.** Subject does the verb.

## Storage convention

- Design docs from `brainstorming` -> `docs/superpowers/specs/`.
- Plans from `writing-plans` -> `docs/superpowers/plans/`.
- Code review notes -> `docs/superpowers/reviews/<pr-number>.md`.

This keeps the human-readable audit trail alongside the code so a future agent
(or new team member) can reconstruct the reasoning.
