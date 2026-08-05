# SafeLaunch — Production Setup & Deploy Guide

> Operational guide for taking SafeLaunch from a fresh clone to its single
> Cloudflare production deployment. SafeLaunch does not maintain a staging
> environment or a Cloudflare Pages project.

---

## 1. Production topology

SafeLaunch has one deployment environment: **production**.

| Surface                   | Cloudflare resource                             | Public URL                          | Configuration                 |
| ------------------------- | ----------------------------------------------- | ----------------------------------- | ----------------------------- |
| Web app and admin console | Worker `safelaunch-app` (Next.js 14 + OpenNext) | `https://safelaunch.runany.dev`     | `apps/web/wrangler.jsonc`     |
| API                       | Worker `safelaunch-api`                         | `https://safelaunch-api.runany.dev` | `apps/workers/wrangler.jsonc` |

The Web Worker uses `safelaunch.runany.dev` as a Cloudflare Worker Custom
Domain. Its build-time API origin is `https://safelaunch-api.runany.dev`. The
API Worker permits browser requests from `https://safelaunch.runany.dev` via
its `WEB_ORIGIN` variable.

The top-level configuration in both Wrangler files is the production
configuration. There is intentionally no `env.production` block. Therefore:

- do not create staging resources or staging GitHub environments;
- do not create a Cloudflare Pages project;
- do not append `--env production` to Wrangler commands;
- do not add production resource bindings under `env.production` unless the
  repository is deliberately migrated back to multi-environment deployment.

> `production` is the GitHub Environment name and the deployment role. It is
> not a Wrangler named environment in the current configuration.

### Production Cloudflare resources

The API Worker currently binds these production resources:

| Binding                 | Resource                                                          |
| ----------------------- | ----------------------------------------------------------------- |
| `DB`                    | D1 database `safelaunch`                                          |
| `ARTIFACTS`             | R2 bucket `safelaunch-artifacts`                                  |
| `LEGAL_INDEX`           | Vectorize index `safelaunch-legal`, 768 dimensions, cosine metric |
| `AI`                    | Workers AI                                                        |
| `LEGAL_INGESTION_QUEUE` | Queue `safelaunch-legal-ingestion`                                |
| `SCAN_WORKFLOW`         | Workflow `scan-workflow` / class `ScanWorkflowEntrypoint`         |
| `ABUSE_RATE_LIMITER`    | Durable Object class `AbuseRateLimiter`                           |

Treat `apps/workers/wrangler.jsonc` as the source of truth for resource IDs,
names, compatibility settings, bindings, and Durable Object migrations.

---

## 2. Local development

### 2.1. Prerequisites

| Tool               | Version                             | Purpose                                           |
| ------------------ | ----------------------------------- | ------------------------------------------------- |
| Node.js            | 20.x or 22.x (see `.nvmrc`)         | Next.js and Cloudflare tooling runtime            |
| pnpm               | 10.13.1                             | Workspace package manager                         |
| Wrangler           | 4.114.0                             | Workers, D1, R2, Vectorize, Queues, and Workflows |
| Git                | Any supported version               | Source control                                    |
| Cloudflare account | Required only for remote operations | Production setup and deploy                       |

Enable Corepack once so the repository's pinned pnpm version is used:

```bash
corepack enable
```

### 2.2. Clone and install

```bash
git clone <your-fork-url> safelaunch
cd safelaunch
pnpm install --frozen-lockfile
```

### 2.3. Generate Worker types and apply local migrations

```bash
cd apps/workers
pnpm exec wrangler types
pnpm exec wrangler d1 migrations apply DB --local
cd ../..
```

Local D1 state is stored under `apps/workers/.wrangler/`. Do not commit local
state or credentials.

### 2.4. Run the quality gates

```bash
pnpm -r --if-present lint
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -C packages/ai test -- eval-runner
```

All commands must exit successfully before deployment.

### 2.5. Run the API locally

```bash
cd apps/workers
pnpm exec wrangler dev --local --port 8787
```

The API listens on `http://127.0.0.1:8787`. Important endpoints include:

- `GET /v1/health`;
- `POST /v1/scans`;
- `GET /v1/scans/:scanId`;
- `GET /v1/reports/:token?token=...`.

Some Cloudflare bindings, especially Workers AI, may require remote access for
an end-to-end local scan. Normal unit tests and the evaluation baseline do not
require production resources.

### 2.6. Run the Web app locally

In a second terminal:

```bash
cd apps/web
NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8787 pnpm dev
```

Open `http://localhost:3000/vi` or `http://localhost:3000/en`.

### 2.7. Run smoke checks against a local API

```bash
node scripts/smoke.mjs \
  --base-url http://127.0.0.1:8787
```

---

## 3. Cloudflare authentication and API token permissions

Use a scoped **Cloudflare Account API Token**, not the legacy Global API Key.
Create it from **Cloudflare Dashboard → Manage Account → Account API Tokens →
Create Token**. Account-owned tokens are preferred for CI/CD because they act as
a service principal instead of inheriting a person's access. The built-in
**Edit Cloudflare Workers** template is a useful starting point, but it does not
include every D1, Vectorize, or Queues permission used by SafeLaunch.

Cloudflare references:

- [Workers CI/CD authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Account-owned API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)
- [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [API token templates](https://developers.cloudflare.com/fundamentals/api/reference/template/)

### 3.1. Production deploy token

Create one token for local production administration and GitHub Actions. Grant
only the following resources:

- **Account resources:** the Cloudflare account that owns SafeLaunch;
- **Zone resources:** only the `runany.dev` zone.

Required permissions:

| Scope   | Permission in Cloudflare dashboard | Why SafeLaunch needs it                                                                         |
| ------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| Account | `Account Settings Read`            | Allows Wrangler to resolve account metadata                                                     |
| Account | `Workers Scripts Write`            | Deploys both Workers, versions, static assets, Durable Object migrations, and Workflow bindings |
| Account | `D1 Edit`                          | Creates the D1 database and runs migrations, queries, and exports                               |
| Account | `Workers R2 Storage Write`         | Creates and binds `safelaunch-artifacts`                                                        |
| Account | `Vectorize Edit`                   | Creates and manages `safelaunch-legal`                                                          |
| Account | `Queues Edit`                      | Creates and binds `safelaunch-legal-ingestion`                                                  |
| Zone    | `Zone Read`                        | Resolves the `runany.dev` zone                                                                  |
| Zone    | `Workers Routes Write`             | Creates or updates the Worker Custom Domain for `safelaunch.runany.dev`                         |

Cloudflare may display `Write` as `Edit` for some permission groups. Choose the
write/edit variant, not read-only, for D1, R2, Vectorize, Queues, Workers
Scripts, and Workers Routes.

Conditional permissions are intentionally excluded from the minimum set:

- `DNS Write` is not required when Wrangler manages the Custom Domain declared
  by `custom_domain: true`. Add it for `runany.dev` only if the setup process
  will create, replace, or delete DNS records directly.
- `Workers AI Read` is not required for a deployed Worker to call its native
  `AI` binding. Add it only if CI or an operator calls the Workers AI REST API
  directly with this token.
- `User Details Read` and `User Memberships Read` apply to user-owned tokens,
  not the recommended account-owned CI token. If a user-owned token is used for
  ad hoc local administration, start from the **Edit Cloudflare Workers**
  template so Wrangler receives those identity permissions.

The production token does **not** need:

- Cloudflare Pages permissions;
- access to every account or every zone;
- Zero Trust permissions, unless the same token is intentionally used to
  create the Access application (a separate token is safer).

Store the token as `CLOUDFLARE_API_TOKEN`; never commit it or print it in CI
logs. Store the account ID as `CLOUDFLARE_ACCOUNT_ID`.

Create the hostname-HMAC secret used by privacy-preserving admin usage metrics:

```bash
pnpm --filter @safelaunch/workers exec wrangler secret put METRICS_HASH_SALT
```

Use a random value of at least 32 bytes. Never reuse an API token or commit this
secret. Scans remain available when it is missing, but the admin dashboard marks
the unique-site metric incomplete.

Verify the token locally:

```bash
export CLOUDFLARE_API_TOKEN='<token>'
export CLOUDFLARE_ACCOUNT_ID='<account-id>'
pnpm exec wrangler whoami
```

### 3.2. Separate Cloudflare Access token

`scripts/setup-cloudflare-access.sh` creates the self-hosted Access application
for `safelaunch.runany.dev/admin/*`. Prefer a short-lived, separate token in
`CF_API_TOKEN` with:

| Scope   | Permission                                                                                         | Purpose                                               |
| ------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Account | `Access: Apps and Policies Write` (or the dashboard's equivalent `Access: Apps and Policies Edit`) | Create/update the Access application and allow policy |
| Account | `Account Settings Read`                                                                            | Validate and resolve the account                      |

Run the script only after reviewing its allow policy:

```bash
export CF_API_TOKEN='<short-lived-access-token>'
bash scripts/setup-cloudflare-access.sh
unset CF_API_TOKEN
```

Revoke the token after one-time setup if it is no longer needed. The script's
email-domain allow rule must match the actual administrator identity policy
before production use.

---

## 4. One-time production resource setup

Authenticate as described in Section 3. Run commands from the repository root.
Before creating anything, check the Cloudflare dashboard and
`apps/workers/wrangler.jsonc`; the production resources may already exist.
Never create a second production database just because a create command reports
that a name is unavailable.

### 4.1. D1

Create the database only if `safelaunch` does not exist:

```bash
pnpm exec wrangler d1 create safelaunch
```

Put the returned `database_id` in `apps/workers/wrangler.jsonc`, then apply all
forward-only migrations using the base production configuration:

```bash
cd apps/workers
pnpm exec wrangler d1 migrations apply DB --remote
cd ../..
```

### 4.2. R2

```bash
pnpm exec wrangler r2 bucket create safelaunch-artifacts
```

The bucket name must match the `ARTIFACTS` binding in
`apps/workers/wrangler.jsonc`.

### 4.3. Vectorize

```bash
pnpm exec wrangler vectorize create safelaunch-legal \
  --dimensions=768 \
  --metric=cosine
```

The 768 dimensions must match the configured embedding model
`@cf/baai/bge-base-en-v1.5`. Changing the model or dimensions requires a new
index and a complete re-index of the reviewed legal corpus.

### 4.4. Queue

```bash
pnpm exec wrangler queues create safelaunch-legal-ingestion
```

### 4.5. Workers AI, Workflow, and Durable Object

Workers AI requires no separate resource creation. Wrangler registers the
Workflow binding and applies the Durable Object migration when the API Worker
is deployed. Do not manually create duplicate Workflow or Durable Object
resources.

### 4.6. Custom Domain

`apps/web/wrangler.jsonc` declares:

```jsonc
"routes": [
  { "pattern": "safelaunch.runany.dev", "custom_domain": true }
]
```

Before the first Web deploy:

1. ensure `runany.dev` is an active zone in the same Cloudflare account;
2. remove any conflicting A, AAAA, or CNAME record for
   `safelaunch.runany.dev`;
3. deploy the Web Worker and allow Cloudflare to create the managed DNS record
   and certificate.

No Cloudflare Pages project or Pages Git integration is used.

---

## 5. GitHub Actions configuration

### 5.1. GitHub Environment

Create exactly one environment under **Settings → Environments**:

- `production` — require the release captain and at least one additional
  reviewer before deployment.

### 5.2. Secrets and variables

Add these under **Settings → Secrets and variables → Actions** or directly to
the protected `production` environment:

| Name                    | Value                               | Used for                       |
| ----------------------- | ----------------------------------- | ------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Token from Section 3.1              | Wrangler production operations |
| `CLOUDFLARE_ACCOUNT_ID` | SafeLaunch Cloudflare account ID    | Wrangler account selection     |
| `PRODUCTION_URL`        | `https://safelaunch-api.runany.dev` | API smoke and latency gates    |

The Web origin is not `PRODUCTION_URL`; it is fixed by the Web Worker Custom
Domain as `https://safelaunch.runany.dev`.

If CI needs an API origin to build the Web app, pass
`NEXT_PUBLIC_API_ORIGIN=https://safelaunch-api.runany.dev`. Do not provision a
staging URL or a Pages preview URL for this purpose.

### 5.3. Production-only workflow rule

`.github/workflows/deploy-production.yml` is the only deployment workflow. Its
Wrangler commands must target the base configuration and therefore must not use
`--env production`. A production-only deploy uses:

```bash
# API migration and deploy
cd apps/workers
pnpm exec wrangler d1 migrations apply DB --remote
pnpm exec wrangler deploy
cd ../..

# Web build and deploy
cd apps/web
pnpm exec opennextjs-cloudflare build
pnpm exec opennextjs-cloudflare deploy
cd ../..
```

Keep `environment: production` in GitHub Actions; that setting protects secrets
and enforces reviewer approval independently of Wrangler environments.

---

## 6. First production deploy

### 6.1. Pre-deploy gates

```bash
pnpm install --frozen-lockfile
pnpm -r --if-present lint
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -C packages/ai test -- eval-runner
```

Export a D1 rollback snapshot before migrations:

```bash
mkdir -p artifacts/db-snapshot
cd apps/workers
pnpm exec wrangler d1 export DB \
  --remote \
  --output=../../artifacts/db-snapshot/db.sql
cd ../..
```

The snapshot may contain production data. Keep it encrypted, access-controlled,
and out of Git.

### 6.2. Deploy

Use the protected GitHub workflow:

1. Open **Actions → deploy-production → Run workflow**.
2. Enter a commit SHA from `main` whose CI run is green.
3. Obtain the required GitHub Environment approval.
4. Monitor migration, API deploy, Web deploy, smoke, eval, and latency gates.
5. Preserve the redacted deployment audit artifact.

For an emergency manual deploy, use the commands in Section 5.3 only after
recording the approver, commit SHA, migration set, and rollback snapshot.

### 6.3. Verify production

```bash
# Web Worker and localized pages
curl -fsSIL https://safelaunch.runany.dev/
curl -fsSL https://safelaunch.runany.dev/vi/ | head -50
curl -fsSL https://safelaunch.runany.dev/en/ | head -50

# API Worker
curl -fsS https://safelaunch-api.runany.dev/v1/health

# Automated API checks
node scripts/smoke.mjs \
  --base-url https://safelaunch-api.runany.dev

# Admin must redirect to Cloudflare Access when unauthenticated
curl -sSIL https://safelaunch.runany.dev/admin/legal
```

Also verify that a report token remains single-use: the first request succeeds
and a second request with the same token returns `403` or `410`.

Sign `docs/releases/mvp-release-checklist.md` and attach the completed checklist
to the release record.

---

## 7. Ongoing releases

For every release:

1. Open a PR to `main` and obtain green CI.
2. Obtain code review and merge.
3. Trigger `deploy-production.yml` manually with the green commit SHA.
4. Approve the protected `production` GitHub Environment.
5. Export the D1 snapshot, apply forward-only migrations, and deploy both
   Workers.
6. Run smoke, evaluation, and latency gates against
   `https://safelaunch-api.runany.dev`.
7. Verify `https://safelaunch.runany.dev` and the Access-protected admin route.
8. Preserve the deployment audit and signed release checklist.

There is no staging promotion step. CI, reviewer approval, the pre-migration D1
snapshot, post-deploy gates, and rollback readiness are the production safety
controls.

---

## 8. Rollback

Follow [`docs/runbooks/rollback.md`](../runbooks/rollback.md). The standard
order is:

1. route 100% of traffic to the last known-good Worker version;
2. disable new scan intake if data compatibility is uncertain;
3. restore D1 only when a migration caused the incident;
4. rerun smoke, evaluation, and latency checks against the production API;
5. preserve version IDs, deployment diff, snapshot, row counts, timestamps, and
   redacted gate output as incident evidence.

Example Worker version rollback:

```bash
cd apps/workers
pnpm exec wrangler versions list
pnpm exec wrangler versions deploy \
  --version-id <previous-version-id> \
  --percentage 100
```

Do not perform rollback drills against production. Validate the commands with
local or disposable resources and require explicit production approval for an
actual rollback.

---

## 9. Troubleshooting

### Wrangler reports that `production` is not configured

The repository uses the top-level Wrangler configuration as production. Remove
`--env production` from the command instead of creating an empty
`env.production` block.

### Worker types are stale

```bash
cd apps/workers
pnpm exec wrangler types
```

### Local D1 schema is stale

```bash
rm -rf apps/workers/.wrangler/state/v3/d1
cd apps/workers
pnpm exec wrangler d1 migrations apply DB --local
```

### OpenNext build cannot find a module

```bash
cd apps/web
rm -rf .next .open-next
pnpm install --frozen-lockfile
NEXT_PUBLIC_API_ORIGIN=https://safelaunch-api.runany.dev pnpm build
```

### Custom Domain deployment fails

Check all of the following:

- the token has `Zone Read` and `Workers Routes Write` for `runany.dev`;
- `runany.dev` belongs to the account in `CLOUDFLARE_ACCOUNT_ID`;
- no conflicting DNS record exists for `safelaunch.runany.dev`;
- `apps/web/wrangler.jsonc` still declares `custom_domain: true`.

### A resource command returns `permission denied`

Match the failed operation to Section 3.1. In particular, the **Edit
Cloudflare Workers** token template alone does not grant `D1 Edit`, `Vectorize
Edit`, or `Queues Edit`. Add only the missing permission and keep account/zone
resource scopes restricted.

---

## 10. References

- [`docs/releases/mvp-release-checklist.md`](../releases/mvp-release-checklist.md)
- [`docs/runbooks/release.md`](../runbooks/release.md)
- [`docs/runbooks/rollback.md`](../runbooks/rollback.md)
- [`docs/compliance/eval-baseline.md`](../compliance/eval-baseline.md)
- [`docs/privacy/data-inventory.md`](../privacy/data-inventory.md)
- [`apps/workers/wrangler.jsonc`](../../apps/workers/wrangler.jsonc)
- [`apps/web/wrangler.jsonc`](../../apps/web/wrangler.jsonc)
- [Cloudflare Workers CI/CD authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare account-owned API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)
- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [Cloudflare Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## Change log

- `2026-07-30` — v1 setup & deploy guide. First release will follow
  this document step by step.

---

## Daily quota feature flag

The `ENABLE_DAILY_QUOTA` Worker **secret** gates the daily-domain-quota
feature (`docs/superpowers/specs/2026-08-03-daily-domain-quota-design.md`).

- Default: secret unset (treated as `"false"`, so the existing
  `POST /v1/scans` behavior is unchanged).
- Flip to `"true"` only after a manual smoke run on staging.

The flag lives as a **secret** (not a `vars` entry) because the binding
name `ENABLE_DAILY_QUOTA` cannot coexist as both a var and a secret (CF
returns error `10053`). This keeps the value out of the public
`wrangler.jsonc`.

```bash
# Enable (run from apps/workers):
echo "true" | pnpm exec wrangler secret put ENABLE_DAILY_QUOTA

# Disable (rollback):
echo "false" | pnpm exec wrangler secret put ENABLE_DAILY_QUOTA

# Verify (no value shown, just the key list):
pnpm exec wrangler secret list
```

The first request to `POST /v1/scans` after the flag flips to `true` will
use the new code path. No migration is required for the new tables
(`redeem_codes`, `redeem_grants`) — they are created by D1 migration
`0002_daily_quota.sql` which runs automatically on the next deploy.
