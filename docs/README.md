# SafeLaunch Docs

This directory holds the human-facing documentation for the SafeLaunch project.

## Index

| File / folder                                | What's inside                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| [`skills.md`](./skills.md)                   | The full skill catalog: which skill to invoke when, with examples.         |
| [`workflow.md`](./workflow.md)               | How the team uses AI day-to-day — the four-phase loop, rituals, and norms. |
| [`superpowers/specs/`](./superpowers/specs/) | Design docs produced by `superpowers:brainstorming` (one per topic).       |
| [`superpowers/plans/`](./superpowers/plans/) | Implementation plans produced by `superpowers:writing-plans`.             |
| [`superpowers/reviews/`](./superpowers/reviews/)| Notes from `superpowers:requesting-code-review` sessions.               |

> **Rule of thumb:** anything an AI agent wrote for a human to review lives here.
> Anything an AI agent wrote as part of the product lives under `apps/` or `packages/`.

## How to read this as a new team member

1. Start at [`workflow.md`](./workflow.md) — it shows the daily loop.
2. Skim [`skills.md`](./skills.md) — bookmark it; you'll grep it constantly.
3. Read the project skills in `.codex/skills/` — these are the project's own rules.
4. Read [`AGENTS.md`](../AGENTS.md) — this is what AI agents read first.

## How to read this as an AI agent

You should already have `AGENTS.md` loaded. From here:

1. Confirm `safelaunch-overview` is loaded.
2. Open `skills.md` only if you need to map a task to a specific skill verb.
3. Open `workflow.md` only if you need the four-phase loop details.
4. Save your outputs to `superpowers/specs/`, `superpowers/plans/`, or `superpowers/reviews/` per the storage convention in `safelaunch-ai-workflow`.

## Conventions

- Filenames: `YYYY-MM-DD-<topic>-<kind>.md` where `<kind>` is `design` / `plan` / `review`.
- Markdown flavor: GitHub-flavored, with mermaid for diagrams when useful.
- Language: English for technical content; Vietnamese acceptable for copy that ships to Vietnamese users (see `safelaunch-overview` brand voice).
- Tone: confident but careful. No AI filler. No emoji bullets.
