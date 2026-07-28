# SafeLaunch MVP Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and release the evidence-first SafeLaunch MVP for anonymous Vietnamese legal-risk screening of public internet-application websites.

**Architecture:** A Next.js App Router web application calls a dedicated Cloudflare Worker API. The Worker uses D1, R2, Vectorize, Queues, Workers AI, and a Workflow-based scan orchestrator; shared TypeScript packages hold contracts, legal domain rules, and AI schemas. Legal ingestion and website analysis remain independent pipelines and only approved, applicable vbpl.vn provisions enter user-facing analysis.

**Tech Stack:** pnpm workspaces, TypeScript strict mode, Next.js 14+, Tailwind CSS, shadcn/ui, Hono, Zod, Cloudflare Workers/Workflows/Queues/D1/R2/Vectorize/Workers AI/AI Gateway/Access/Turnstile, Vitest with Cloudflare pool, MSW, Playwright, Wrangler, GitHub Actions.

---

## Release Phases and Gates

| Phase | Deliverable | Exit gate |
|---|---|---|
| 0 | Monorepo, contracts, local Worker, D1 schema | lint, typecheck, unit tests, local health endpoint pass |
| 1 | Reviewed legal corpus pipeline | fixture document reaches approved/searchable state with audit trail |
| 2 | Safe website scanner | hostile URL suite passes and a fixture site yields source-bound evidence |
| 3 | Evidence-first compliance engine | benchmark enforces citation validity and high-risk precision |
| 4 | Anonymous bilingual product and admin UI | Playwright completes submit → progress → private report and admin approval |
| 5 | Production hardening and release | staging soak, security checks, backup/rollback drill, production smoke pass |

## Locked File Structure

```text
apps/
  web/
    app/[locale]/page.tsx
    app/[locale]/scan/[scanId]/page.tsx
    app/[locale]/report/[token]/page.tsx
    app/admin/legal/page.tsx
    components/scan-form.tsx
    components/scan-progress.tsx
    components/report-view.tsx
    lib/api-client.ts
    messages/{vi,en}.json
  workers/
    src/index.ts
    src/routes/{scans,reports,admin}.ts
    src/workflows/scan-workflow.ts
    src/queues/legal-ingestion.ts
    src/services/{safe-fetch,page-discovery,evidence,retention}.ts
    wrangler.jsonc
packages/
  contracts/src/{scan,legal,report,index}.ts
  db/migrations/*.sql
  db/src/{client,legal-repository,scan-repository}.ts
  compliance-core/src/{jurisdictions,rules,scoring,verify,aggregate}.ts
  ai/src/{provider,retrieval,evaluate,translate}.ts
  ui/src/*
tests/
  fixtures/{vbpl,sites}/
  evals/cases/*.json
  e2e/{scan,admin}.spec.ts
.github/workflows/{ci,deploy-staging,deploy-production}.yml
```

## Phase 0 — Foundation

### Task 1: Bootstrap the pnpm monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.nvmrc`

- [ ] **Step 1: Add the root workspace manifest**

```json
{
  "name": "safelaunch",
  "private": true,
  "packageManager": "pnpm@10.13.1",
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "@eslint/js": "latest",
    "@playwright/test": "latest",
    "eslint": "latest",
    "prettier": "latest",
    "typescript": "latest",
    "typescript-eslint": "latest"
  }
}
```

- [ ] **Step 2: Add workspace and strict TypeScript configuration**

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "noEmit": true, "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Install and verify the empty workspace**

Run: `rtk pnpm install && rtk pnpm typecheck`  
Expected: install succeeds and recursive typecheck exits 0.

- [ ] **Step 4: Commit**

```bash
rtk git add package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json .nvmrc pnpm-lock.yaml
rtk git commit -m "chore: bootstrap TypeScript monorepo"
```

### Task 2: Define shared public contracts

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/scan.ts`
- Create: `packages/contracts/src/legal.ts`
- Create: `packages/contracts/src/report.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import { CreateScanInput, Finding } from "./index";

describe("public contracts", () => {
  it("accepts only the enabled MVP jurisdiction and categories", () => {
    expect(CreateScanInput.parse({ url: "https://example.com", jurisdiction: "VN", category: "online_game" })).toBeTruthy();
    expect(() => CreateScanInput.parse({ url: "https://example.com", jurisdiction: "US", category: "online_game" })).toThrow();
  });
  it("requires evidence and a citation for high risk", () => {
    expect(() => Finding.parse({ id: "f1", severity: "high", rationale: "risk", confidence: 0.95, evidenceIds: [], citations: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `rtk pnpm --filter @safelaunch/contracts test`  
Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Implement the contracts**

```ts
// packages/contracts/src/scan.ts
import { z } from "zod";
export const JurisdictionCode = z.enum(["VN"]);
export const AppCategory = z.enum(["online_game", "electronic_press", "digital_entertainment"]);
export const CreateScanInput = z.object({ url: z.string().url(), jurisdiction: JurisdictionCode, category: AppCategory });
export const ScanState = z.enum(["queued", "fetching", "extracting", "retrieving", "evaluating", "reporting", "completed", "partial", "failed"]);
```

```ts
// packages/contracts/src/legal.ts
import { z } from "zod";
export const Citation = z.object({ provisionId: z.string().min(1), source: z.string().min(1), url: z.string().url(), retrievedAt: z.string().datetime(), excerpt: z.string().min(1) });
export const Evidence = z.object({ id: z.string(), type: z.string(), value: z.string(), sourceUrl: z.string().url(), excerpt: z.string().min(1), confidence: z.number().min(0).max(1) });
```

```ts
// packages/contracts/src/report.ts
import { z } from "zod";
import { Citation, Evidence } from "./legal";
export const Finding = z.object({ id: z.string(), severity: z.enum(["high", "review", "pass"]), rationale: z.string().min(1), confidence: z.number().min(0).max(1), evidenceIds: z.array(z.string()).min(1), citations: z.array(Citation).min(1), recommendedAction: z.string().min(1), applicability: z.enum(["current", "upcoming"]) });
export const ReportStatus = z.enum(["high_risk", "needs_review", "no_significant_risk"]);
export type EvidenceItem = z.infer<typeof Evidence>;
```

- [ ] **Step 4: Export, run tests, and commit**

Run: `rtk pnpm --filter @safelaunch/contracts test`  
Expected: PASS.

```bash
rtk git add packages/contracts
rtk git commit -m "feat: define SafeLaunch public contracts"
```

### Task 3: Create the D1 schema and repositories

**Files:**
- Create: `packages/db/migrations/0001_initial.sql`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/legal-repository.ts`
- Create: `packages/db/src/scan-repository.ts`
- Test: `packages/db/src/repositories.test.ts`

- [ ] **Step 1: Write repository integration tests**

```ts
it("keeps unapproved provisions out of retrieval", async () => {
  const documentId = await legal.createDocument(fixtureDocument);
  await legal.addProvision(documentId, fixtureProvision);
  expect(await legal.listRetrievable({ jurisdiction: "VN", on: "2026-07-28" })).toEqual([]);
  await legal.approve(documentId, "admin@example.com", "source verified");
  expect(await legal.listRetrievable({ jurisdiction: "VN", on: "2026-07-28" })).toHaveLength(1);
});
```

- [ ] **Step 2: Run against local D1 and confirm failure**

Run: `rtk pnpm --filter @safelaunch/db test`  
Expected: FAIL because migration and repository are absent.

- [ ] **Step 3: Add normalized tables and retrieval guard**

```sql
CREATE TABLE legal_documents (id TEXT PRIMARY KEY, source_url TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ("pending_review","approved","rejected","superseded")), retrieved_at TEXT NOT NULL, effective_from TEXT, effective_to TEXT, source_hash TEXT NOT NULL);
CREATE TABLE legal_provisions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES legal_documents(id), article TEXT NOT NULL, clause TEXT, text TEXT NOT NULL, vector_id TEXT, categories_json TEXT NOT NULL);
CREATE TABLE document_relations (id TEXT PRIMARY KEY, from_document_id TEXT NOT NULL REFERENCES legal_documents(id), to_document_id TEXT NOT NULL REFERENCES legal_documents(id), relation_type TEXT NOT NULL CHECK(relation_type IN ('amends','supplements','replaces','repeals')));
CREATE TABLE legal_review_events (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES legal_documents(id), actor TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE scans (id TEXT PRIMARY KEY, url TEXT NOT NULL, jurisdiction TEXT NOT NULL, category TEXT NOT NULL, state TEXT NOT NULL, coverage_json TEXT NOT NULL, analysis_version TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE scan_pages (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id), page_type TEXT NOT NULL, url TEXT NOT NULL, state TEXT NOT NULL, content_hash TEXT, r2_key TEXT, excerpt_bytes INTEGER NOT NULL DEFAULT 0);
CREATE TABLE evidence_items (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id), type TEXT NOT NULL, value TEXT NOT NULL, source_url TEXT NOT NULL, excerpt TEXT NOT NULL, confidence REAL NOT NULL);
CREATE TABLE findings (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id), severity TEXT NOT NULL, applicability TEXT NOT NULL, rationale TEXT NOT NULL, confidence REAL NOT NULL, recommended_action TEXT NOT NULL);
CREATE TABLE finding_citations (finding_id TEXT NOT NULL REFERENCES findings(id), provision_id TEXT NOT NULL REFERENCES legal_provisions(id), legal_excerpt TEXT NOT NULL, PRIMARY KEY(finding_id, provision_id));
CREATE TABLE reports (scan_id TEXT PRIMARY KEY REFERENCES scans(id), token_hash TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE rule_versions (id TEXT PRIMARY KEY, rubric_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id), rule_version_id TEXT NOT NULL REFERENCES rule_versions(id), model_id TEXT NOT NULL, prompt_version TEXT NOT NULL, retrieval_version TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX idx_legal_retrieval ON legal_documents(status, effective_from, effective_to);
```

```ts
export const isApplicable = (d: { status: string; effectiveFrom: string | null; effectiveTo: string | null }, on: string) => d.status === "approved" && (!d.effectiveFrom || d.effectiveFrom <= on) && (!d.effectiveTo || d.effectiveTo > on);
```

- [ ] **Step 4: Apply migration, pass tests, and commit**

Run: `rtk wrangler d1 migrations apply safelaunch-local --local && rtk pnpm --filter @safelaunch/db test`  
Expected: migration succeeds; tests PASS.

```bash
rtk git add packages/db
rtk git commit -m "feat: add auditable D1 data model"
```

### Task 4: Bootstrap the Worker and binding configuration

**Files:**
- Create: `apps/workers/package.json`
- Create: `apps/workers/wrangler.jsonc`
- Create: `apps/workers/src/index.ts`
- Test: `apps/workers/src/index.test.ts`

- [ ] **Step 1: Write a failing health-route test**

```ts
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "./index";
it("returns build metadata without leaking bindings", async () => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request("http://local/v1/health"), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(await response.json()).toMatchObject({ ok: true, service: "safelaunch-api" });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/workers test`  
Expected: FAIL because the Worker is absent.

- [ ] **Step 3: Implement Hono entrypoint and bindings**

```ts
import { Hono } from "hono";
const app = new Hono<{ Bindings: Env }>();
app.get("/v1/health", (c) => c.json({ ok: true, service: "safelaunch-api" }));
app.onError((error, c) => c.json({ code: "INTERNAL_ERROR", requestId: c.req.header("cf-ray") ?? crypto.randomUUID() }, 500));
export default app;
```

Configure `compatibility_date: "2026-07-28"`, `nodejs_compat`, generated Worker types, D1/R2/Vectorize/AI/Queue/Workflow bindings, and structured observability in `wrangler.jsonc`. Secrets remain outside the file.

- [ ] **Step 4: Generate types, test, and commit**

Run: `rtk pnpm --filter @safelaunch/workers wrangler types && rtk pnpm --filter @safelaunch/workers test`  
Expected: generated `worker-configuration.d.ts`; PASS.

```bash
rtk git add apps/workers
rtk git commit -m "feat: bootstrap Cloudflare Worker API"
```

## Phase 1 — Legal Corpus

### Task 5: Capture vbpl.vn fixtures and parse DOCX documents

**Files:**
- Create: `tests/fixtures/vbpl/sample-current.docx`
- Create: `tests/fixtures/vbpl/sample-current.html`
- Create: `tests/fixtures/vbpl/sample-upcoming.docx`
- Create: `tests/fixtures/vbpl/sample-replaced.docx`
- Create: `apps/workers/src/queues/vbpl-docx.ts`
- Test: `apps/workers/src/queues/vbpl-docx.test.ts`

- [ ] **Step 1: Save real DOCX fixtures from vbpl.vn**

Pick one in-force and one upcoming document for each of online game, electronic press, and digital entertainment from vbpl.vn. For each, record the `van-ban/chi-tiet/{slug}` URL and the file reference `{bucketName, folderName, objectName, preview}` from the `?tabs=tai-ve` POST response. Download each DOCX from `https://vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/minio/buckets/vbpl/{folderName}/{objectName}/download` and save it under `tests/fixtures/vbpl/`. Save the matching detail-page HTML for fallback metadata. Each fixture `manifest.json` records source URL, retrievedAt, and file reference.

- [ ] **Step 2: Write failing parser tests against the DOCX fixtures**

```ts
it("extracts Điều-level provisions with article labels and merged body text", async () => {
  const parsed = await parseVbplDocx(sampleDocxBytes, sampleMetadata);
  expect(parsed.provisions.length).toBeGreaterThan(0);
  expect(parsed.provisions[0]?.article).toMatch(/^Điều \d+/);
  expect(parsed.provisions[0]?.text.length).toBeGreaterThan(50);
  expect(parsed.effectiveFrom).toMatch(/^2026-/);
});
```

- [ ] **Step 3: Implement DOCX parser using `word/document.xml`**

```ts
import { gunzipSync } from "node:zlib";
import { parse as parseXml } from "fast-xml-parser";

export const parseVbplDocx = async (bytes: Uint8Array, input: { sourceUrl: string; retrievedAt: string; metadata: VbplMetadata }): Promise<ParsedVbplDocument> => {
  const entries = unzipOpenXml(bytes);
  const xml = new TextDecoder("utf-8").decode(entries["word/document.xml"]);
  const root = parseXml(xml, { ignoreAttributes: false });
  const provisions = walkProvisions(root);
  if (provisions.length === 0) throw new LegalParseError(input.sourceUrl, "no provisions found");
  return { ...input, provisions };
};
```

Implementation notes:
- Open the DOCX as a ZIP container; fail explicitly if `word/document.xml` is missing.
- Walk `w:p` paragraphs. Capture every `w:t` text node, preserve paragraph breaks, and ignore inline formatting.
- Group paragraphs under headings whose text begins with `Điều <number>`; each heading starts a new provision whose text is the concatenation of the heading paragraph and subsequent paragraphs until the next `Điều` heading or end of document.
- Never apply AI rewrite; the displayed legal text must match the DOCX byte-for-byte except for whitespace and paragraph join characters.

- [ ] **Step 4: Add a small-zip fallback for browsers**

Workers runtime cannot use Node `zlib.inflateRaw` directly on every browser, so implement DOCX parsing with the `fflate` package (small, MIT, ~10 KB) to keep the parser pure Workers code. Test runs in Node and Workers are equivalent.

- [ ] **Step 5: Test and commit fixtures plus parser**

Run: `rtk pnpm --filter @safelaunch/workers test -- vbpl-docx`  
Expected: PASS for current, upcoming, and replaced DOCX fixtures; `fast-xml-parser` and `fflate` are added to the worker package.json.

```bash
rtk git add tests/fixtures/vbpl apps/workers/src/queues/vbpl-parser*
rtk git commit -m "feat: parse versioned vbpl legal documents"
```

### Task 6: Implement ingestion, review, and indexing

**Files:**
- Create: `apps/workers/src/queues/legal-ingestion.ts`
- Create: `apps/workers/src/routes/admin.ts`
- Test: `apps/workers/src/queues/legal-ingestion.test.ts`
- Test: `apps/workers/src/routes/admin.test.ts`

- [ ] **Step 1: Write failure-first lifecycle tests**

```ts
it("indexes only after explicit approval", async () => {
  await ingest(snapshot);
  expect(await vectorIds()).toEqual([]);
  await approve({ documentId: snapshot.id, actor: "access:user@example.com", reason: "metadata and source checked" });
  expect(await vectorIds()).toEqual(snapshot.provisions.map((p) => p.id));
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/workers test -- legal-ingestion admin`  
Expected: FAIL because lifecycle handlers do not exist.

- [ ] **Step 3: Implement queue idempotency and approval transaction**

```ts
export async function ingestMessage(message: IngestionMessage, deps: IngestionDeps) {
  const sourceHash = await sha256(message.html);
  if (await deps.legal.hasSourceHash(sourceHash)) return { status: "duplicate" as const };
  const parsed = parseVbplHtml(message);
  await deps.r2.put(`legal/${parsed.id}/${sourceHash}.html`, message.html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await deps.legal.insertPending(parsed, sourceHash);
  return { status: "pending_review" as const };
}
```

Approval writes an audit event and queues provision embeddings in the same application operation; retries use stable provision IDs. A cron handler reads reviewed vbpl.vn search seeds from Worker configuration, discovers document URLs, and enqueues snapshots only when ETag, last-modified value, or source hash changed.

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/workers test -- legal-ingestion admin`  
Expected: duplicate delivery is harmless; approval indexes; rejection never indexes.

```bash
rtk git add apps/workers/src/queues apps/workers/src/routes/admin*
rtk git commit -m "feat: add reviewed legal corpus lifecycle"
```

## Phase 2 — Safe Website Scanner

### Task 7: Implement SSRF-safe URL policy

**Files:**
- Create: `apps/workers/src/services/url-policy.ts`
- Test: `apps/workers/src/services/url-policy.test.ts`

- [ ] **Step 1: Encode hostile URL cases**

```ts
it.each(["http://127.0.0.1", "http://[::1]", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "https://user:pass@example.com"])("blocks %s", async (url) => {
  await expect(validatePublicUrl(url, fakeDns)).rejects.toThrow(UnsafeUrlError);
});
it("accepts a public https destination", async () => expect(validatePublicUrl("https://example.com", fakeDnsPublic)).resolves.toMatchObject({ hostname: "example.com" }));
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/workers test -- url-policy`  
Expected: FAIL.

- [ ] **Step 3: Implement scheme, credentials, DNS, and IP-range validation**

```ts
export async function validatePublicUrl(raw: string, resolve: Resolver): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new UnsafeUrlError("unsupported URL");
  const addresses = await resolve(url.hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) throw new UnsafeUrlError("non-public destination");
  url.hash = "";
  return url;
}
```

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/workers test -- url-policy`  
Expected: PASS for IPv4, IPv6, encoded hosts, credentials, and redirect destination cases.

```bash
rtk git add apps/workers/src/services/url-policy*
rtk git commit -m "feat: enforce public URL policy"
```

### Task 8: Add bounded fetching and page discovery

**Files:**
- Create: `apps/workers/src/services/safe-fetch.ts`
- Create: `apps/workers/src/services/page-discovery.ts`
- Test: `apps/workers/src/services/safe-fetch.test.ts`
- Test: `apps/workers/src/services/page-discovery.test.ts`

- [ ] **Step 1: Test redirect revalidation, byte limits, and four page types**

```ts
it("revalidates every redirect", async () => expect(fetchBounded("https://public.test", redirectToPrivate)).rejects.toThrow(UnsafeUrlError));
it("selects one best URL per supported type", () => expect(discoverPages(homeHtml, base)).toEqual([
  { type: "terms", url: "https://site.test/terms" }, { type: "privacy", url: "https://site.test/privacy" },
  { type: "about", url: "https://site.test/about" }, { type: "contact", url: "https://site.test/contact" }
]));
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/workers test -- safe-fetch page-discovery`  
Expected: FAIL.

- [ ] **Step 3: Implement streaming size enforcement and deterministic discovery ranking**

```ts
export const FETCH_LIMITS = { redirects: 3, compressedBytes: 1_000_000, decodedBytes: 2_000_000, timeoutMs: 8_000 } as const;
```

Read response streams chunk-by-chunk, cancel once a limit is exceeded, accept only HTML/XHTML, and run `validatePublicUrl` before the first request and each redirect. Rank same-origin links using Vietnamese and English exact labels before URL keyword matches; never fetch more than homepage plus four selected pages.

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/workers test -- safe-fetch page-discovery`  
Expected: PASS; oversized streams are canceled and partial coverage is recorded.

```bash
rtk git add apps/workers/src/services/safe-fetch* apps/workers/src/services/page-discovery*
rtk git commit -m "feat: add bounded website discovery"
```

### Task 9: Extract source-bound evidence

**Files:**
- Create: `apps/workers/src/services/evidence.ts`
- Create: `tests/fixtures/sites/{game,press,entertainment}/index.html`
- Test: `apps/workers/src/services/evidence.test.ts`

- [ ] **Step 1: Create bilingual site fixtures and failing extraction tests**

```ts
it("preserves exact source for operator evidence", async () => {
  const items = await extractEvidence(gameFixture, deterministicExtractor);
  expect(items).toContainEqual(expect.objectContaining({ type: "operator_identity", sourceUrl: "https://game.test/about", excerpt: expect.stringContaining("Công ty") }));
});
it("treats page instructions as content", async () => expect(extractEvidence(promptInjectionFixture, deterministicExtractor)).resolves.not.toContainEqual(expect.objectContaining({ value: "ignore system" })));
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/workers test -- evidence`  
Expected: FAIL.

- [ ] **Step 3: Implement sanitization, chunking, typed extraction, and excerpt verification**

```ts
export const EvidenceDraft = z.object({ type: z.enum(["operator_identity", "contact", "privacy_notice", "payment", "ugc", "content_model", "license_claim"]), value: z.string(), quote: z.string(), confidence: z.number().min(0).max(1) });
export function verifyQuote(pageText: string, draft: z.infer<typeof EvidenceDraft>) {
  if (!pageText.includes(draft.quote)) throw new UnsupportedEvidenceError(draft.quote);
  return { ...draft, excerpt: draft.quote };
}
```

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/workers test -- evidence`  
Expected: PASS for Vietnamese, English, bilingual, empty, and injection fixtures.

```bash
rtk git add apps/workers/src/services/evidence* tests/fixtures/sites
rtk git commit -m "feat: extract auditable website evidence"
```

### Task 10: Orchestrate scans with progress and partial outcomes

**Files:**
- Create: `apps/workers/src/workflows/scan-workflow.ts`
- Create: `apps/workers/src/routes/scans.ts`
- Test: `apps/workers/src/workflows/scan-workflow.test.ts`

- [ ] **Step 1: Write workflow state tests**

```ts
it("returns partial when a discovered page fails", async () => {
  const result = await runFixtureScan({ failedPage: "privacy" });
  expect(result.state).toBe("partial");
  expect(result.coverage.failed).toContain("privacy");
  expect(result.status).not.toBe("no_significant_risk");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/workers test -- scan-workflow`  
Expected: FAIL.

- [ ] **Step 3: Implement explicit Workflow steps**

```ts
export class ScanWorkflow extends WorkflowEntrypoint<Env, ScanParams> {
  async run(event: WorkflowEvent<ScanParams>, step: WorkflowStep) {
    const pages = await step.do("fetch-pages", { retries: { limit: 1 }, timeout: "20 seconds" }, () => fetchScanPages(event.payload));
    const evidence = await step.do("extract-evidence", { timeout: "15 seconds" }, () => extractScanEvidence(pages));
    return step.do("evaluate-and-report", { timeout: "20 seconds" }, () => evaluateAndPersist(event.payload.scanId, pages, evidence));
  }
}
```

POST `/v1/scans` creates a cryptographic ID and Workflow instance; GET `/v1/scans/:id` returns contract-validated progress and, only after a terminal report is persisted, a one-time `reportUrl` containing the private token. Neither application logs nor telemetry record that URL or token.

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/workers test -- scan-workflow scans`  
Expected: completed, partial, failed, timeout, and retry cases PASS.

```bash
rtk git add apps/workers/src/workflows apps/workers/src/routes/scans*
rtk git commit -m "feat: orchestrate bounded compliance scans"
```

## Phase 3 — Compliance Engine

### Task 11: Implement jurisdiction registry and deterministic rules

**Files:**
- Create: `packages/compliance-core/src/jurisdictions.ts`
- Create: `packages/compliance-core/src/rules.ts`
- Create: `packages/compliance-core/src/scoring.ts`
- Test: `packages/compliance-core/src/rules.test.ts`
- Create: `docs/compliance/rubrics/v1.md`

- [ ] **Step 1: Test reproducible, coverage-aware rules**

```ts
it("does not infer absence from a failed privacy page", () => expect(runRules(scanWithFailedPrivacy)).toContainEqual(expect.objectContaining({ ruleId: "privacy-notice", outcome: "unknown" })));
it("returns the same rationale for the same versioned input", () => expect(runRules(completeScan)).toEqual(runRules(completeScan)));
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/compliance-core test`  
Expected: FAIL.

- [ ] **Step 3: Implement data-driven jurisdiction/category configuration and named rubric**

```ts
export const jurisdictions = [{ code: "VN", enabled: true, sourceHosts: ["vbpl.vn"], reportLocales: ["vi", "en"] }] as const;
export const RUBRIC_VERSION = "vn-mvp-v1";
export const severityFor = (outcome: "present" | "absent" | "unknown") => outcome === "absent" ? "high" : outcome === "unknown" ? "review" : "pass";
```

Document every rule ID, evidence requirement, unknown behavior, severity, rationale template, categories, and citations required in `v1.md`.

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/compliance-core test`  
Expected: PASS with no magic score and stable rationale.

```bash
rtk git add packages/compliance-core docs/compliance/rubrics/v1.md
rtk git commit -m "feat: add explainable Vietnam ruleset"
```

### Task 12: Add approved legal retrieval

**Files:**
- Create: `packages/ai/src/retrieval.ts`
- Test: `packages/ai/src/retrieval.test.ts`

- [ ] **Step 1: Test metadata guards before vector ranking**

```ts
it("excludes pending, expired, and wrong-category provisions", async () => {
  const result = await retrieveLegalContext(query, fixtureIndex);
  expect(result.map((x) => x.provisionId)).toEqual(["approved-current", "approved-upcoming"]);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/ai test -- retrieval`  
Expected: FAIL.

- [ ] **Step 3: Implement bounded hybrid retrieval**

```ts
export async function retrieveLegalContext(q: RetrievalQuery, deps: RetrievalDeps) {
  const eligible = await deps.legal.listRetrievable({ jurisdiction: q.jurisdiction, category: q.category, on: q.on });
  const allowed = new Set(eligible.map((p) => p.id));
  const hits = await deps.vector.query(await deps.embed(q.text), { topK: 12, returnMetadata: "all" });
  return hits.matches.filter((hit) => allowed.has(hit.id)).slice(0, 6).map((hit) => eligible.find((p) => p.id === hit.id)!);
}
```

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/ai test -- retrieval`  
Expected: PASS; result count never exceeds six per evidence topic.

```bash
rtk git add packages/ai/src/retrieval*
rtk git commit -m "feat: retrieve only approved legal provisions"
```

### Task 13: Evaluate and verify evidence-provision pairs

**Files:**
- Create: `packages/ai/src/provider.ts`
- Create: `packages/ai/src/evaluate.ts`
- Create: `packages/compliance-core/src/verify.ts`
- Test: `packages/ai/src/evaluate.test.ts`
- Test: `packages/compliance-core/src/verify.test.ts`

- [ ] **Step 1: Test malformed output, invented quotes, and weak high-risk claims**

```ts
it("rejects an invented legal quote", () => expect(() => verifyFinding(inventedQuote, context)).toThrow(CitationVerificationError));
it("downgrades unsupported high risk to expert review", () => expect(verifyFinding(weakHighRisk, context).severity).toBe("review"));
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/ai test && rtk pnpm --filter @safelaunch/compliance-core test -- verify`  
Expected: FAIL.

- [ ] **Step 3: Add structured provider boundary and deterministic verifier**

```ts
export const EvaluationDraft = z.object({ severity: z.enum(["high", "review", "pass"]), rationale: z.string(), evidenceIds: z.array(z.string()).min(1), provisionIds: z.array(z.string()).min(1), legalQuotes: z.array(z.string()).min(1), confidence: z.number().min(0).max(1), recommendedAction: z.string() });
```

The provider receives system rules separately from `<untrusted_website_content>` blocks. The verifier checks exact website excerpts, exact legal quotes, approved/applicable provision IDs, category match, and a high-risk confidence threshold of `0.90`. Raw model output never becomes a report.

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/ai test && rtk pnpm --filter @safelaunch/compliance-core test`  
Expected: PASS for valid, malformed, injected, invented, and uncertain outputs.

```bash
rtk git add packages/ai packages/compliance-core/src/verify*
rtk git commit -m "feat: verify evidence-backed AI findings"
```

### Task 14: Aggregate and translate reports without semantic drift

**Files:**
- Create: `packages/compliance-core/src/aggregate.ts`
- Create: `packages/ai/src/translate.ts`
- Create: `apps/workers/src/routes/reports.ts`
- Test: `packages/compliance-core/src/aggregate.test.ts`
- Test: `packages/ai/src/translate.test.ts`

- [ ] **Step 1: Test status precedence and translation invariants**

```ts
it("never returns a clean status for partial coverage", () => expect(aggregate([], { complete: false })).toBe("needs_review"));
it("keeps machine fields identical across locales", async () => {
  const bilingual = await translateReport(reportVi, fakeTranslator);
  expect(projectMachineFields(bilingual.en)).toEqual(projectMachineFields(bilingual.vi));
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/compliance-core test -- aggregate && rtk pnpm --filter @safelaunch/ai test -- translate`  
Expected: FAIL.

- [ ] **Step 3: Implement deterministic aggregation and private token storage**

```ts
export function aggregate(findings: Finding[], coverage: Coverage): ReportStatus {
  if (findings.some((f) => f.applicability === "current" && f.severity === "high")) return "high_risk";
  if (!coverage.complete || findings.some((f) => f.applicability === "current" && f.severity === "review")) return "needs_review";
  return "no_significant_risk";
}
```

Generate 32 random bytes with Web Crypto, return the base64url token once, persist only `SHA-256(token)`, set seven-day expiry, and fetch reports with constant-time hash comparison. Add `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`.

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/compliance-core test && rtk pnpm --filter @safelaunch/ai test && rtk pnpm --filter @safelaunch/workers test -- reports`  
Expected: PASS; plaintext report token is absent from D1 fixtures and logs.

```bash
rtk git add packages/compliance-core/src/aggregate* packages/ai/src/translate* apps/workers/src/routes/reports*
rtk git commit -m "feat: compose private bilingual reports"
```

## Phase 4 — Product UI

### Task 15: Build the bilingual homepage and scan form

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/open-next.config.ts`
- Create: `apps/web/wrangler.jsonc`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/app/[locale]/layout.tsx`
- Create: `apps/web/app/[locale]/page.tsx`
- Create: `apps/web/components/scan-form.tsx`
- Create: `apps/web/messages/vi.json`
- Create: `apps/web/messages/en.json`
- Test: `apps/web/components/scan-form.test.tsx`

- [ ] **Step 1: Invoke `hallmark` and record the approved visual direction in `docs/design/homepage.md`**

The direction must avoid generic gradient/glassmorphism, keep the URL form as the dominant center object, use a restrained trust-oriented palette, and include the non-advice disclosure before submission.

- [ ] **Step 2: Write a failing interaction test**

```tsx
it("submits the Vietnam scan contract without authentication", async () => {
  render(<ScanForm createScan={createScan} locale="vi" />);
  await user.type(screen.getByLabelText("URL website"), "https://example.com");
  await user.selectOptions(screen.getByLabelText("Loại ứng dụng"), "online_game");
  await user.click(screen.getByRole("button", { name: "Kiểm tra website" }));
  expect(createScan).toHaveBeenCalledWith({ url: "https://example.com", jurisdiction: "VN", category: "online_game" });
});
```

- [ ] **Step 3: Implement accessible localized form using shared contracts**

Use server-rendered copy, client-side Zod validation, a disabled-but-data-driven Vietnam jurisdiction selector, category descriptions, Turnstile token field, and a disclosure link. Configure OpenNext for Cloudflare Workers and read the public API origin from validated deployment environment configuration. The API allows CORS only for that exact origin. Do not add Clerk or account UI in the MVP.

- [ ] **Step 4: Test, build, and commit**

Run: `rtk pnpm --filter @safelaunch/web test && rtk pnpm --filter @safelaunch/web build`  
Expected: PASS and both `/vi` and `/en` render.

```bash
rtk git add apps/web docs/design/homepage.md
rtk git commit -m "feat: add anonymous bilingual scan homepage"
```

### Task 16: Build progress and report experiences

**Files:**
- Create: `apps/web/app/[locale]/scan/[scanId]/page.tsx`
- Create: `apps/web/app/[locale]/report/[token]/page.tsx`
- Create: `apps/web/components/scan-progress.tsx`
- Create: `apps/web/components/report-view.tsx`
- Create: `apps/web/lib/api-client.ts`
- Test: `apps/web/components/report-view.test.tsx`

- [ ] **Step 1: Write failing UI tests for partial and current/upcoming findings**

```tsx
it("shows failed coverage and never displays a compliance approval", () => {
  render(<ReportView report={partialReport} locale="vi" />);
  expect(screen.getByText(/không thể quét.*privacy/i)).toBeVisible();
  expect(screen.queryByText(/tuân thủ hoàn toàn|được phép phát hành/i)).toBeNull();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/web test -- report-view`  
Expected: FAIL.

- [ ] **Step 3: Implement polling and evidence-first report cards**

Poll with capped exponential backoff (1s, 2s, then 3s) until a terminal state. Render overall status, scanned/failed coverage, AI-assisted badge, exact website excerpt, original Vietnamese legal excerpt, article/clause link, retrieval date, confidence, recommended action, upcoming-effective-date banner, locale switch, seven-day expiry, and disclaimer.

- [ ] **Step 4: Test accessibility, build, and commit**

Run: `rtk pnpm --filter @safelaunch/web test && rtk pnpm --filter @safelaunch/web build`  
Expected: PASS; axe reports no serious violations in homepage, progress, and report fixtures.

```bash
rtk git add apps/web/app apps/web/components apps/web/lib
rtk git commit -m "feat: render transparent compliance reports"
```

### Task 17: Build the Access-protected legal admin

**Files:**
- Create: `apps/web/app/admin/legal/page.tsx`
- Create: `apps/web/app/admin/legal/[documentId]/page.tsx`
- Create: `apps/web/components/legal-review-form.tsx`
- Test: `apps/web/components/legal-review-form.test.tsx`

- [ ] **Step 1: Write failing review-form tests**

```tsx
it("requires a reason before approval", async () => {
  render(<LegalReviewForm document={pendingDocument} submit={submit} />);
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByText(/reason is required/i)).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/web test -- legal-review-form`  
Expected: FAIL.

- [ ] **Step 3: Implement review queue and source comparison**

Render source URL, retrieved timestamp, source hash, lifecycle dates, relations, parsed provisions, prior version diff, and audit history. Submit approve/reject with mandatory reason. The Worker derives actor identity from the validated Cloudflare Access JWT; the browser cannot supply actor identity.

- [ ] **Step 4: Test, build, and commit**

Run: `rtk pnpm --filter @safelaunch/web test && rtk pnpm --filter @safelaunch/web build`  
Expected: PASS; unauthenticated admin route returns Access challenge in staging.

```bash
rtk git add apps/web/app/admin apps/web/components/legal-review-form*
rtk git commit -m "feat: add auditable legal review console"
```

## Phase 5 — Hardening and Release

### Task 18: Add abuse controls, retention, and privacy-safe observability

**Files:**
- Create: `apps/workers/src/middleware/abuse.ts`
- Create: `apps/workers/src/services/retention.ts`
- Create: `apps/workers/src/observability.ts`
- Test: `apps/workers/src/services/retention.test.ts`
- Create: `docs/privacy/data-inventory.md`

- [ ] **Step 1: Write failing retention and redaction tests**

```ts
it("deletes expired D1 and R2 scan artifacts", async () => { await purgeExpired(now, deps); expect(await deps.db.scan("expired")).toBeNull(); expect(await deps.r2.get("scans/expired/home.html")).toBeNull(); });
it("never logs raw URL paths or tokens", () => expect(toLogEvent(requestFixture)).toEqual(expect.objectContaining({ hostHash: expect.any(String), path: undefined, token: undefined })));
```

- [ ] **Step 2: Run and confirm failure**

Run: `rtk pnpm --filter @safelaunch/workers test -- retention observability abuse`  
Expected: FAIL.

- [ ] **Step 3: Implement Turnstile verification, rate limits, deletion cron, and structured metrics**

Rate-limit by salted IP hash and hostname hash, never raw values. Delete report, evidence, pages, scans, and R2 objects after seven days; keep only aggregate counters. Document every collected field, purpose, location, retention, access, and deletion path in the data inventory.

- [ ] **Step 4: Test and commit**

Run: `rtk pnpm --filter @safelaunch/workers test`  
Expected: PASS; repeated purge is idempotent and logs contain no fixture PII.

```bash
rtk git add apps/workers/src docs/privacy/data-inventory.md
rtk git commit -m "feat: harden anonymous scan privacy"
```

### Task 19: Build the legal evaluation and latency gates

**Files:**
- Create: `tests/evals/cases/*.json`
- Create: `packages/ai/src/eval-runner.ts`
- Create: `packages/ai/src/eval-runner.test.ts`
- Create: `scripts/check-latency.mjs`
- Create: `docs/compliance/eval-baseline.md`

- [ ] **Step 1: Add 60 human-reviewed benchmark cases**

Create at least 30 high-risk cases (10 per supported category) and 30 non-high-risk cases. Each JSON includes website evidence, expected severity, approved provision IDs, expected citations, reviewer, review date, and rationale. Two reviewers sign off any disputed case before it enters the release set.

- [ ] **Step 2: Write failing metric tests**

```ts
it("meets release quality gates", async () => {
  const metrics = await evaluateAll(loadCases(), systemUnderTest);
  expect(metrics.citationValidity).toBe(1);
  expect(metrics.highRiskPrecision).toBeGreaterThanOrEqual(0.9);
  expect(metrics.unsupportedHighRisk).toBe(0);
});
```

- [ ] **Step 3: Implement deterministic metrics and latency probe**

The eval runner reports confusion matrix, precision by category/language, citation validity, unsupported high-risk count, and changed cases versus baseline. The latency script submits 100 eligible staging fixtures, waits for terminal states, and fails when P95 is 60,000 ms or higher.

- [ ] **Step 4: Run gates and commit baseline**

Run: `rtk pnpm --filter @safelaunch/ai eval && rtk node scripts/check-latency.mjs --base-url "$STAGING_URL" --samples 100`  
Expected: citation validity 100%, high-risk precision ≥90%, unsupported high-risk 0, P95 <60s.

```bash
rtk git add tests/evals packages/ai/src/eval-runner* scripts/check-latency.mjs docs/compliance/eval-baseline.md
rtk git commit -m "test: add legal quality release gates"
```

### Task 20: Add CI, staged deployment, and production rollback

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-staging.yml`
- Create: `.github/workflows/deploy-production.yml`
- Create: `scripts/smoke.mjs`
- Create: `docs/runbooks/release.md`
- Create: `docs/runbooks/rollback.md`

- [ ] **Step 1: Add CI with immutable gates**

CI runs install with frozen lockfile, formatting, lint, typecheck, unit/integration tests, web build, Worker dry-run deploy, contract compatibility, secret scan, and Playwright against preview. It uploads test/eval reports without website content or tokens.

- [ ] **Step 2: Add staging deployment**

On merge to `main`, apply staging D1 migrations, deploy API Worker and web Worker, seed only reviewed fixture provisions, run smoke/e2e/eval checks, and stop promotion on any failure.

- [ ] **Step 3: Add approval-gated production deployment**

Production deploy uses a GitHub Environment approval, takes a D1 backup/export, applies forward-only migrations, deploys Worker versions, shifts traffic gradually, runs `rtk node scripts/smoke.mjs "$PRODUCTION_URL"`, and records deployed commit, ruleset, prompt, model, and corpus versions.

- [ ] **Step 4: Write and rehearse release/rollback runbooks**

The rollback procedure restores the prior Worker versions first, disables new scan creation if data compatibility is uncertain, restores D1 only when migration rollback requires it, verifies report access and admin review, and preserves audit evidence. Perform the drill in staging and paste command output into the release PR.

- [ ] **Step 5: Commit**

```bash
rtk git add .github/workflows scripts/smoke.mjs docs/runbooks
rtk git commit -m "ci: add staged SafeLaunch release pipeline"
```

### Task 21: Execute the release candidate checklist

**Files:**
- Create: `docs/releases/mvp-release-checklist.md`

- [ ] **Step 1: Verify product and compliance gates**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm build && rtk pnpm test:e2e`  
Expected: every command exits 0.

- [ ] **Step 2: Verify production-like quality gates in staging**

Run: `rtk pnpm --filter @safelaunch/ai eval && rtk node scripts/check-latency.mjs --base-url "$STAGING_URL" --samples 100 && rtk node scripts/smoke.mjs "$STAGING_URL"`  
Expected: legal and performance thresholds pass; smoke creates a scan, reaches a terminal result, resolves every citation, and cannot access an expired token.

- [ ] **Step 3: Complete manual review**

The checklist requires legal reviewer sign-off for the initial corpus and benchmark, security review of SSRF/Access/token handling, privacy review of the data inventory and deletion evidence, bilingual content review, accessibility review, responsive browser review, cost-limit review, monitoring alerts, support contact, incident owner, and rollback owner.

- [ ] **Step 4: Deploy and smoke production**

Trigger the approval-gated workflow, then run: `rtk node scripts/smoke.mjs "$PRODUCTION_URL"`  
Expected: health, anonymous scan, progress, report, citation links, `noindex`, admin Access challenge, and expiry behavior pass.

- [ ] **Step 5: Tag and commit release evidence**

```bash
rtk git add docs/releases/mvp-release-checklist.md
rtk git commit -m "docs: record MVP release verification"
rtk git tag -a v0.1.0 -m "SafeLaunch Vietnam MVP"
rtk git push origin main v0.1.0
```

## Spec Coverage Matrix

| Design requirement | Implemented by |
|---|---|
| Anonymous URL/category/Vietnam submission | Tasks 2, 10, 15 |
| Homepage plus four legal/company pages | Tasks 8–10 |
| SSRF, redirect, size, timeout, prompt-injection safety | Tasks 7–10, 13, 18 |
| vbpl.vn source, lifecycle, versioning, approval, audit | Tasks 3, 5, 6, 17 |
| Current and upcoming provisions | Tasks 3, 5, 12, 14, 16 |
| Deterministic rules plus evidence-first RAG | Tasks 11–14 |
| Exact website evidence and article-level citations | Tasks 9, 12–14, 16 |
| Precision-first high-risk verifier | Tasks 13, 19 |
| Completed/partial/failed outcomes without false clean result | Tasks 10, 14, 16 |
| Vietnamese-English semantic parity | Tasks 14–16, 19 |
| Private seven-day report and deletion | Tasks 14, 16, 18 |
| Cloudflare-first bindings and provider isolation | Tasks 4, 6, 10, 12, 13 |
| Admin protected by Cloudflare Access | Tasks 6, 17, 20 |
| P95 below 60 seconds | Tasks 8, 10, 19, 21 |
| 100% valid citations and ≥90% high-risk precision | Tasks 13, 19, 21 |
| CI, staging, rollback, production release | Tasks 20, 21 |

## Implementation Order and Parallelism

Tasks 1–4 are sequential. After Task 4, Phase 1 legal ingestion and Phase 2 scanning may run in parallel because they own disjoint paths; Task 10 requires Tasks 7–9. Phase 3 requires approved legal fixtures from Task 6 and evidence contracts from Task 9. UI Task 15 can start after Task 2 with mocked contracts, while Tasks 16–17 integrate after Tasks 6, 10, and 14. Hardening Tasks 18–20 may run in parallel after integrated staging exists; Task 21 is the final release gate.

Every implementation task begins in an isolated worktree, uses `superpowers:test-driven-development`, and ends with verification plus review. UI tasks also invoke `hallmark`; compliance, prompt, scoring, corpus, citation, and PII tasks re-load `safelaunch-compliance`. No phase merges while its exit gate is red.
