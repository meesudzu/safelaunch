# SafeLaunch

> Ra mắt toàn cầu. Tuân thủ ngay từ đầu.
> *Launch globally. Compliant from day one.*

SafeLaunch là nền tảng kiểm tra tuân thủ pháp lý bằng AI, giúp phát hiện các rủi ro pháp lý và quy định trước khi ra mắt website, ứng dụng hoặc sản phẩm số.

## Status

Early development. The repo currently holds the **AI workflow scaffold** for the team — see the directory layout below. Application code (`apps/`, `packages/`) lands in follow-up commits.

## AI-assisted development

Every contributor (human or AI agent) working in this repo follows a four-phase loop backed by a curated set of AI skills.

| Phase    | Purpose                                       | Skills (must-invoke)                                       |
| -------- | --------------------------------------------- | ---------------------------------------------------------- |
| 1. Understand | Agree on intent before any code           | `safelaunch-overview`, `safelaunch-compliance`*, `superpowers:brainstorming` |
| 2. Plan  | Break design into testable tasks              | `superpowers:writing-plans`, `superpowers:using-git-worktrees` |
| 3. Build | Ship working code in tested slices            | `superpowers:test-driven-development`, `hallmark`**, `superpowers:dispatching-parallel-agents` |
| 4. Verify & Ship | Make sure it actually works, then merge | `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, `superpowers:finishing-a-development-branch` |

`*` only when the change touches compliance surfaces, scoring, AI prompts, or PII.
`**` only when the change touches UI.

Full details: [`docs/workflow.md`](./docs/workflow.md). Skill catalog: [`docs/skills.md`](./docs/skills.md).

## Repository layout

```
.
├── AGENTS.md                 # AI agent entrypoint (auto-loaded)
├── README.md                 # This file
├── docs/                     # Human-facing documentation
│   ├── README.md
│   ├── skills.md             # Which skill for which task
│   ├── workflow.md           # The four-phase dev loop
│   └── superpowers/          # Design specs, plans, reviews (output of skills)
│       ├── specs/
│       ├── plans/
│       └── reviews/
└── .codex/skills/            # Project-specific AI skills (auto-loaded)
    ├── safelaunch-overview/    # Project context for AI agents
    ├── safelaunch-compliance/  # Compliance-first engineering rules
    └── safelaunch-ai-workflow/ # Skill mapping per phase
```

## Onboarding (humans)

1. `git clone` and read [`AGENTS.md`](./AGENTS.md) — this is what AI agents see first.
2. Read [`docs/workflow.md`](./docs/workflow.md) and [`docs/skills.md`](./docs/skills.md).
3. Read the three project skills in [`.codex/skills/`](./.codex/skills/).
4. Install the Codex CLI + the `superpowers` and `hallmark` plugins (see `docs/skills.md` § "Installing skills for new team members").
5. Pair with an existing teammate on one full loop (brainstorm → plan → PR).

## Onboarding (AI agents)

Most of this is automatic. Codex loads `.codex/skills/` and `AGENTS.md` at session start. If your platform does not auto-load them, read them in this order:

1. [`AGENTS.md`](./AGENTS.md)
2. [`.codex/skills/safelaunch-overview/SKILL.md`](./.codex/skills/safelaunch-overview/SKILL.md)
3. (if compliance-scope) [`.codex/skills/safelaunch-compliance/SKILL.md`](./.codex/skills/safelaunch-compliance/SKILL.md)
4. [`.codex/skills/safelaunch-ai-workflow/SKILL.md`](./.codex/skills/safelaunch-ai-workflow/SKILL.md)
5. Match your task to a skill chain from [`docs/workflow.md`](./docs/workflow.md).

## License

TBD (project pre-launch).
