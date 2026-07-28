# AI-Assisted Development Workflow

This is the team's day-to-day AI workflow — the same loop every team member (human + AI) follows so the output is consistent, auditable, and shippable.

> **Single source of truth:** the `safelaunch-ai-workflow` skill (`.codex/skills/safelaunch-ai-workflow/SKILL.md`) is the authoritative mapping. This doc is the human-friendly walkthrough.

## The four phases at a glance

```
 +---------------------------+   +-------------------------+   +--------------------------+   +-----------------------------+
 | 1. Understand             |   | 2. Plan                  |   | 3. Build                  |   | 4. Verify & Ship            |
 |                           |   |                         |   |                          |   |                             |
 | - safelaunch-overview     |-->| - writing-plans         |-->| - test-driven-development |-->| - verification-before-     |
 | - safelaunch-compliance * |   | - using-git-worktrees   |   | - dispatching-parallel-   |   |   completion               |
 | - brainstorming           |   |                         |   |   agents                  |   | - requesting-code-review   |
 |                           |   |                         |   | - hallmark **            |   | - receiving-code-review    |
 |                           |   |                         |   | - systematic-debugging    |   | - finishing-a-dev-branch   |
 +---------------------------+   +-------------------------+   +--------------------------+   +-----------------------------+
```

`*` only when compliance surfaces are in scope.
`**` only when UI surfaces are in scope.

## Phase 1 — Understand

**Goal:** Agree on what we are building and why before writing a single line.

1. **Open the project.** Agent loads `safelaunch-overview` automatically.
2. **Check compliance scope.** If the change touches compliance surfaces (scoring,
   legal text, AI prompts, PII, new jurisdiction), load `safelaunch-compliance`.
3. **Brainstorm.** `superpowers:brainstorming` runs:
   - Asks clarifying questions one at a time.
   - Proposes 2-3 approaches with trade-offs.
   - Walks you through the design in sections, getting approval at each one.
   - Writes the design to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
   - Self-reviews the spec for placeholders, contradictions, ambiguity, scope.
   - Hands it back to you for a final read.

> **HARD GATE.** No code, no scaffolding, no file edits, no `git` operations until
> the user has approved the design. This applies to every change, including ones
> that "feel too simple to need a design".

## Phase 2 — Plan

**Goal:** Break the approved design into ordered, independently-testable tasks.

1. `superpowers:writing-plans` converts the design doc into a phased plan.
2. Plan lands at `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`.
3. `superpowers:using-git-worktrees` sets up an isolated branch.

## Phase 3 — Build

**Goal:** Ship working code in small, tested slices.

- **Always**: `superpowers:test-driven-development`. Tests come first; they encode
  the regulation, the scoring rubric, and the public contract.
- **Parallelize** when work decomposes cleanly:
  `superpowers:dispatching-parallel-agents` (separate sessions) or
  `superpowers:subagent-driven-development` (in-session).
- **UI work**: invoke `hallmark`. If you are redesigning, default to `hallmark
  redesign <target>`. If you are studying a reference, use `hallmark study <url|img>`.
- **Bug fixes**: `superpowers:systematic-debugging` before any fix attempt.

## Phase 4 — Verify & Ship

**Goal:** Nothing leaves the branch that isn't actually working and reviewed.

1. `superpowers:verification-before-completion`:
   - `rtk pnpm -w test` — all tests green.
   - `rtk pnpm -w build` — build green.
   - Deploy to preview environment; smoke-test the affected flow.
   - Only then claim "done".
2. `superpowers:requesting-code-review` — request a review before merge.
3. `superpowers:receiving-code-review` — evaluate feedback technically before
   applying (don't blindly accept).
4. `superpowers:finishing-a-development-branch` — rebase, squash, push, clean up.

## Storage convention

| Output                                  | Lives at                                                  |
| --------------------------------------- | --------------------------------------------------------- |
| Design doc from `brainstorming`         | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`     |
| Plan from `writing-plans`               | `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`       |
| Review notes from `requesting-...`      | `docs/superpowers/reviews/<pr-number>.md`                 |
| Project skill updates                  | `.codex/skills/<name>/SKILL.md`                           |
| Compliance PR checklists               | pasted into the PR description (per `safelaunch-compliance`) |

## Rituals

### Daily
- Every agent session starts with `safelaunch-overview` already loaded.
- Every PR description uses the compliance checklist if it touches compliance surfaces.
- Every UI PR is attached to a `hallmark` run output.

### Weekly
- Review the `docs/superpowers/specs/` folder for stale designs.
- Update skill `description:` frontmatter if trigger phrases have drifted.
- Promote recurring patterns into a new project skill via `superpowers:writing-skills`.

### Per-release
- Run a full SEO audit on the production URL: `codex "/seo audit https://safelaunch.app"`.
- Run a `hallmark audit` on the public landing page.
- Update the brand voice / claim list if any compliance copy changed.

## Anti-patterns (do not)

- Skip brainstorming because "the change is small". Small changes have hidden assumptions.
- Open a PR without tests. TDD is non-negotiable for compliance surfaces.
- Merge without running verification on a preview deployment.
- Hand-wave a citation. If the regulation can't be cited, surface the uncertainty.
- Use generic LLM UI defaults. Run `hallmark`.
- Save LLM raw output as user-facing copy. Always route through a human-reviewed pass.

## Onboarding a new human team member

1. `git clone` the repo. Read `README.md`, then `AGENTS.md`.
2. Read `docs/workflow.md` (this file) and `docs/skills.md`.
3. Read the three project skills in `.codex/skills/`.
4. Install Codex CLI + `superpowers` plugin + `hallmark` plugin.
5. Pair with an existing teammate on one brainstorming → plan → PR loop.
6. After one full loop, you're cleared to drive solo.

## Onboarding a new AI agent

Most of this is automatic — Codex loads `.codex/skills/` and `AGENTS.md` at session
start. For agents that don't auto-load (some non-Codex platforms):

1. Read `AGENTS.md`.
2. Read `.codex/skills/safelaunch-overview/SKILL.md`.
3. If compliance-scope: read `.codex/skills/safelaunch-compliance/SKILL.md`.
4. Read `.codex/skills/safelaunch-ai-workflow/SKILL.md` to find the right superpowers.
5. Invoke the skill that matches your phase. Start with `superpowers:using-superpowers`.
