# SafeLaunch — Setup & Deploy Guide

> Step-by-step instructions for taking SafeLaunch from a fresh clone to
> a production deploy on Cloudflare. This guide is the operational
> counterpart to `docs/releases/mvp-release-checklist.md` (the per-release
> gate) and `docs/runbooks/release.md` / `rollback.md` (the per-release
> process). The MVP ships with three surfaces: an API Worker, a Web
> Worker (Next.js 14 + OpenNext), and a Cloudflare Turnstile-protected
> admin console.

---

## Part 1 · Local development setup

### 1.1 · Prerequisites

| Tool               | Version                                              | Why                                                    |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------ |
| Node.js            | 20.x or 22.x (see `.nvmrc`)                          | Runtime for both Workers tooling and Next.js           |
| pnpm               | 10.13.1 (matches `packageManager` in `package.json`) | Workspace package manager                              |
| Wrangler           | 4.114.0 (matches `apps/workers`)                     | Deploy + D1 + R2 + Vectorize + AI + Queues + Workflows |
| Git                | any                                                  | Standard                                               |
| Cloudflare account | free tier is enough for `wrangler dev`               | Required for the deploy steps in Part 3                |

> **Tip:** the repo pins `packageManager` in `package.json`. Run
> `corepack enable` once so pnpm auto-installs at the right version.

### 1.2 · Clone and install

```bash
git clone <your-fork-url> safelaunch
cd safelaunch
pnpm install --frozen-lockfile
```

`pnpm install` populates every workspace (`apps/*`, `packages/*`) and
runs the lockfile. If the install fails on peer-dep warnings, that's
expected for `@playwright/test` — it's only used by the e2e gate.

### 1.3 · Generate the Workers environment types

```bash
cd apps/workers
pnpm exec wrangler types
cd ../..
```

This produces `apps/workers/worker-configuration.d.ts` (gitignored).
Commit it only if your `.gitignore` allows — the MVP keeps it out of
the tree so that local D1 IDs never leak into version control.

### 1.4 · Local Cloudflare resources

`wrangler dev` will start a local D1 + R2 + Vectorize + AI on your
machine. No remote resources are required for development. The local
emulator binds to the `Env` type that `wrangler types` just generated.

If you want to point at a real (staging) D1 instead, set
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and use
`--remote` on individual wrangler commands. The MVP defaults to local.

### 1.5 · Apply the D1 migrations locally

```bash
cd apps/workers
pnpm exec wrangler d1 migrations apply DB --local
cd ../..
```

This creates a `safelaunch` SQLite file under
`apps/workers/.wrangler/state/v3/d1/` and applies every migration
in `packages/db/migrations/`.

### 1.6 · Run the gates (the same ones CI runs)

```bash
# Lint, typecheck, tests across every workspace
pnpm -r --if-present lint
pnpm -r --if-present typecheck
pnpm -r --if-present test

# The eval runner (the MVP release blocker)
pnpm -C packages/ai test -- eval-runner
```

All four commands must exit 0 before any change is shipped.

### 1.7 · Run the Worker locally

```bash
cd apps/workers
pnpm exec wrangler dev --local --port 8787
```

The dev server listens on `http://127.0.0.1:8787`. Useful endpoints:

- `GET  /v1/health` — health probe.
- `POST /v1/scans` — start a scan (returns `{ scanId, state: "queued" }`).
- `GET  /v1/scans/:scanId` — poll progress.
- `GET  /v1/reports/:token?token=...` — fetch a report (single-use).

The Worker needs the legal corpus in D1 to score findings. For local
development you can either seed the reviewed fixture provisions (see
`packages/db/src/seed-fixtures.ts` if it exists in your build) or run
the staging seed script against the local D1.

### 1.8 · Run the Web app locally

```bash
# In a second terminal
cd apps/web
NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8787 pnpm dev
```

Open `http://localhost:3000/vi` (or `/en`). The form posts to the
Worker's `/v1/scans` and polls the result.

### 1.9 · Run the legal-evaluation baseline

```bash
# Run the eval runner against the 60-case benchmark set
pnpm -C packages/ai test -- eval-runner

# Run the latency probe (requires a live API)
STAGING_URL=http://127.0.0.1:8787 \
  node scripts/check-latency.mjs --samples 25

# Run smoke against a local Worker
STAGING_URL=http://127.0.0.1:8787 \
  node scripts/smoke.mjs
```

The latency probe and smoke need a live, reachable API. The eval runner
runs without one — it invokes the system under test directly.

### 1.10 · Common local-dev recipes

| Goal                                            | Command                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Run a single package's tests in watch mode      | `pnpm -C packages/compliance-core test -- --watch`                                                    |
| Open the D1 Studio                              | `cd apps/workers && pnpm exec wrangler d1 execute DB --local --command "select * from scans limit 5"` |
| Tail the Worker's local logs                    | `cd apps/workers && pnpm exec wrangler dev --local --log-level debug`                                 |
| Regenerate types after editing `wrangler.jsonc` | `cd apps/workers && pnpm exec wrangler types`                                                         |
| Inspect the bundled Worker size                 | `cd apps/workers && pnpm build && du -sh dist/`                                                       |

---

## Part 2 · Cloudflare prerequisites (one-time per environment)

These resources are created **once** per Cloudflare account / environment
(staging, production). The IDs go into `apps/workers/wrangler.jsonc`
and the corresponding secrets go into the GitHub environment.

### 2.1 · Create the D1 database

```bash
pnpm exec wrangler d1 create safelaunch
# Take note of the `database_id` printed by Wrangler.
```

Replace the `database_id: "00000000-0000-0000-0000-000000000000"`
placeholder in `apps/workers/wrangler.jsonc` with the real ID.

### 2.2 · Apply D1 migrations to the remote database

```bash
# Staging
pnpm exec wrangler d1 migrations apply DB --remote --env staging

# Production (do this only ONCE on first production setup)
pnpm exec wrangler d1 migrations apply DB --remote --env production
```

After this, the D1 schema is in place. Re-running the migrations is a
no-op (Wrangler tracks applied versions).

### 2.3 · Create the R2 bucket

```bash
pnpm exec wrangler r2 bucket create safelaunch-staging-artifacts
pnpm exec wrangler r2 bucket create safelaunch-prod-artifacts
```

Update the `r2_buckets` block in `wrangler.jsonc` with the names. The MVP
keeps page snapshots only for the duration of the scan (7-day retention
deletes them on schedule).

### 2.4 · Create the Vectorize index

```bash
pnpm exec wrangler vectorize create safelaunch-legal \
  --dimensions=384 \
  --metric=cosine
```

The legal-retrieval layer embeds Vietnamese legal text with
`@cf/baai/bge-base-en-v1.5` (384-dim). Other embedding models are
incompatible without re-indexing.

### 2.5 · AI binding

Workers AI is enabled by default in every account. The MVP uses AI
Gateway (`safelaunch-legal` gateway identifier) for caching + retry.
The gateway is auto-created on first request — no manual setup.

### 2.6 · Queue

```bash
pnpm exec wrangler queues create safelaunch-legal-ingestion
```

The queue is used by the corpus ingestion pipeline (Tasks 5–6). It's
producer-only from the Worker; the consumer runs in a separate cron /
worker.

### 2.7 · Workflows

The MVP scan pipeline uses a Cloudflare Workflow
(`ScanWorkflowEntrypoint`). Workflows don't need separate setup — they're
declared in `wrangler.jsonc` and Wrangler registers them at deploy time.

### 2.8 · Cloudflare Access (admin)

1. In the Cloudflare dashboard, go to **Zero Trust → Access → Applications**.
2. Create a new **Self-hosted** application with the path
   `admin.legal.*` (or the prefix you use).
3. Set the policy: **Allow** with an email-domain rule
   (`@yourcompany.com`) or a one-time PIN for the release captain.
4. Capture the application's **Application Audience (AUD) tag** — it's
   needed for the `cf-access-jwt-assertion` header validation on the
   Worker side (see the rollout notes below).

> The MVP ships with the Worker's admin routes gated by Access at the
> edge. Without this policy, the admin form is publicly reachable.

### 2.9 · `wrangler.jsonc` final shape (production)

After running the steps above, `apps/workers/wrangler.jsonc` should
contain real IDs. The final shape:

```jsonc
{
  "name": "safelaunch-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-28",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "safelaunch",
      "database_id": "<real D1 id>",
      "migrations_dir": "../../packages/db/migrations",
    },
  ],
  "r2_buckets": [{ "binding": "ARTIFACTS", "bucket_name": "safelaunch-prod-artifacts" }],
  "vectorize": [{ "binding": "LEGAL_INDEX", "index_name": "safelaunch-legal" }],
  "ai": { "binding": "AI" },
  "queues": {
    "producers": [{ "binding": "LEGAL_INGESTION_QUEUE", "queue": "safelaunch-legal-ingestion" }],
  },
  "workflows": [
    { "name": "scan-workflow", "binding": "SCAN_WORKFLOW", "class_name": "ScanWorkflowEntrypoint" },
  ],
  "vars": { "WEB_ORIGIN": "https://safelaunch.app" },
  "env": {
    "staging": { "vars": { "WEB_ORIGIN": "https://staging.safelaunch.app" } },
    "production": { "vars": { "WEB_ORIGIN": "https://safelaunch.app" } },
  },
  "observability": { "enabled": true, "head_sampling_rate": 1 },
}
```

---

## Part 3 · First-time deploy

### 3.1 · GitHub repository secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret                  | Used by                                       | Notes                                                                    |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | `deploy-staging.yml`, `deploy-production.yml` | Token with Workers Scripts + D1 + R2 + Vectorize + Queues + Pages scopes |
| `CLOUDFLARE_ACCOUNT_ID` | both deploy jobs                              | From the Cloudflare dashboard URL                                        |
| `STAGING_URL`           | `deploy-staging.yml`                          | e.g. `https://staging.safelaunch.app`                                    |
| `PRODUCTION_URL`        | `deploy-production.yml`                       | e.g. `https://safelaunch.app`                                            |
| `PREVIEW_URL`           | `ci.yml` e2e job                              | The Cloudflare Pages preview URL for a PR                                |

For the Cloudflare Access-protected admin:

| Variable        | Used by                         | Notes                              |
| --------------- | ------------------------------- | ---------------------------------- |
| `CF_ACCESS_AUD` | the Worker admin route (future) | Application Audience tag from §2.8 |

### 3.2 · GitHub environments

Create two environments under **Settings → Environments**:

- `staging` — no required reviewers (auto-deploys on merge to `main`).
- `production` — **required reviewers**: the release captain +
  one other engineer. This is the manual approval gate for the prod
  deploy.

### 3.3 · Configure Cloudflare Pages for the Web Worker

The Web Worker is built with `OpenNext` for Cloudflare. The deploy
commands in the staging / production workflows assume a Cloudflare
Pages project named `safelaunch-web`. Create it once:

1. In the Cloudflare dashboard, **Workers & Pages → Create application
   → Pages → Connect to Git**.
2. Select the SafeLaunch repo. **Build command**:
   `cd apps/web && pnpm install --frozen-lockfile && NEXT_PUBLIC_API_ORIGIN=$CF_PAGES_URL pnpm build`.
   **Build output directory**: `apps/web/.vercel/output/static` (OpenNext
   default) or `apps/web/.open-next/dist` depending on the OpenNext
   adapter version. See `apps/web/open-next.config.ts`.
3. The deploy workflows use `opennextjs-cloudflare build && opennextjs-cloudflare
deploy` which is independent of the Pages Git integration. The Pages
   project is for previews; production goes through `wrangler`.

### 3.4 · First-time staging deploy

After merging the MVP to `main`, the staging deploy triggers
automatically (`.github/workflows/deploy-staging.yml`):

1. CI runs first (`.github/workflows/ci.yml`). All gates must pass.
2. The staging job:
   - applies forward-only D1 migrations;
   - deploys the API Worker to staging;
   - builds and deploys the Web Worker to staging;
   - seeds **only the reviewed fixture provisions** (never the
     production corpus);
   - runs `scripts/smoke.mjs`;
   - runs the eval gate;
   - runs the latency probe;
   - uploads a redacted staging report.

3. Watch the GitHub Actions run. If any step fails, **the release is
   blocked** at staging — see the [rollback runbook](../runbooks/rollback.md)
   for that environment.

### 3.5 · First-time production deploy

Once staging is green, the release captain triggers the production
workflow from the GitHub UI:

1. **Actions → Deploy production → Run workflow**.
2. Enter the green commit SHA from `main`.
3. (Optional) Enter a ruleset override. The default is the commit SHA.
4. Click **Run workflow**. A reviewer (the second required approver from
   §3.2) must approve in the GitHub UI before the deploy proceeds.

The production workflow:

1. Re-runs CI against the chosen commit. If CI fails, the deploy aborts.
2. Exports a D1 snapshot to `artifacts/db-snapshot/db.sql` (90-day
   retention). **This is your rollback anchor** — keep it.
3. Applies forward-only D1 migrations to production.
4. Deploys the API Worker to production.
5. Builds and deploys the Web Worker.
6. **Shifts traffic gradually**: 10 % → 50 % → 100 %, with 60 s pauses
   between each step. Cloudflare's `wrangler versions deploy
--percentage` is a Worker-version feature, not a generic
   load-balancer.
7. Runs smoke + eval + latency (50 samples).
8. Records the deployment audit (`commit`, `ruleset`, `model`,
   `corpus`, `timestamp`) to a 365-day artifact.

### 3.6 · Verify the deploy

```bash
# The marketing homepage should render in both locales
curl -sSL https://safelaunch.app/vi/ | head -50
curl -sSL https://safelaunch.app/en/ | head -50

# The health probe should return 200
curl -sS https://api.safelaunch.app/v1/health

# The report endpoint should be single-use
# (open the URL once → 200, second time → 403 or 410)

# The admin queue should require Cloudflare Access
# (an unauthenticated request should redirect to the Access login)
```

Sign the release checklist in
`docs/releases/mvp-release-checklist.md` and attach the filled copy to
the release PR.

---

## Part 4 · Ongoing release process

For every release after the first:

1. Open a PR from a feature branch to `main`. The CI gate runs.
2. Get a green CI on the PR commit.
3. Merge to `main`. Staging deploy triggers automatically.
4. Watch the staging deploy complete (smoke + eval + latency all pass).
5. Trigger the production workflow from the GitHub UI as in §3.5.
6. Verify per §3.6.
7. Sign the release checklist.

If anything in staging fails, the release is blocked — do not promote
to production. The branch's "do not merge" / "draft" labels should
remain on the PR until the staging issue is resolved.

---

## Part 5 · Rollback

If a production deploy is bad (eval failure, latency spike, 5xx rate),
follow the [rollback runbook](../runbooks/rollback.md). The standard
order is:

1. **Worker traffic** to the previous version
   (`wrangler versions deploy --version-id <previous> --percentage 100`).
2. **Disable new scans** if data compatibility is uncertain
   (set `SAFELAUNCH_SCAN_INTAKE_ENABLED: "false"` in the env, redeploy).
3. **D1 rollback** only if a migration broke the schema
   (restore from the snapshot artifact in the run's artifacts).
4. **Verify** with `smoke.mjs` + the eval gate + the latency probe.
5. **Preserve audit evidence**: attach the Worker version diff, the
   smoke + latency output, the D1 snapshot, and the row counts
   before / after to the incident ticket.

The full procedure (with timestamps and drill-in-staging) is in
`docs/runbooks/rollback.md`.

---

## Part 6 · Troubleshooting

### "I changed wrangler.jsonc and the types are wrong"

```bash
cd apps/workers
pnpm exec wrangler types
cd ../..
```

### "Vitest can't import in jsdom / commonjs"

The `apps/web` tests use `jsdom`; the workers tests use
`@cloudflare/vitest-pool-workers` (which is fine in Workers, not CommonJS).
If you see `Cannot be imported in a CommonJS module`, the test file is
running in the wrong pool. Re-check `vitest.config.ts`.

### "The D1 schema is out of date locally"

```bash
# Drop the local D1 and re-apply migrations
rm -rf apps/workers/.wrangler/state/v3/d1
cd apps/workers
pnpm exec wrangler d1 migrations apply DB --local
cd ../..
```

### "The eval gate fails locally with a real system"

The eval runner uses a fake `SystemUnderTest` in the tests. To run
against a real model, write a thin `provider.ts` that calls Workers AI
and wire it into `evaluateEvidenceProvisionPair`. The MVP test
`it("meets release quality gates", ...)` requires a stub that produces
the expected draft shape.

### "The OpenNext build fails with `Module not found`"

```bash
cd apps/web
rm -rf .next .open-next
pnpm install --frozen-lockfile
NEXT_PUBLIC_API_ORIGIN=https://api.example.com pnpm build
cd ../..
```

### "The 60-case eval set is wrong"

Re-generate the cases from the script template (see
`packages/ai/src/eval-runner.test.ts` for the case shape). The MVP
treats the eval set as a frozen artifact; any change to a case is a
breaking change to the release gate.

---

## Part 7 · Reference

- [`docs/releases/mvp-release-checklist.md`](../releases/mvp-release-checklist.md) — the
  per-release gate.
- [`docs/runbooks/release.md`](../runbooks/release.md) — release
  procedure.
- [`docs/runbooks/rollback.md`](../runbooks/rollback.md) — rollback
  procedure.
- [`docs/compliance/eval-baseline.md`](../compliance/eval-baseline.md) — the
  legal-evaluation gate.
- [`docs/privacy/data-inventory.md`](../privacy/data-inventory.md) — the
  privacy surface.
- [`docs/design/homepage.md`](../design/homepage.md) — the design
  direction.
- [`AGENTS.md`](../../AGENTS.md) — the agent entry point.
- `.github/workflows/` — the CI, staging, and production workflows.

## Change log

- `2026-07-30` — v1 setup & deploy guide. First release will follow
  this document step by step.
