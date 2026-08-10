#!/usr/bin/env node
// One-shot: embed each provision in scripts/seed-legal-corpus.sql via
// Workers AI (@cf/baai/bge-base-en-v1.5, 768 dims) and upsert the vectors
// into a Vectorize index. This closes docs/remaining.md Tier 1.2 — without
// it, retrieveLegalContext() (packages/ai/src/retrieval.ts) always gets
// zero matches and every rule falls back to "needs_review".
//
// The full flow is:
//   1. Parse provision tuples from scripts/seed-legal-corpus.sql.
//   2. Batch-embed all provision texts via the AI Gateway
//      (packages/ai/src/gateway.ts uses the same Gateway in production).
//   3. Write the (id, vector, metadata) triples to a temp NDJSON file and
//      upsert them via `wrangler vectorize insert`.
//   4. UPDATE legal_provisions.vector_id for every provision so D1 has a
//      back-reference to the Vectorize namespace (the spec'd deliverable
//      for Tier 1.2 — production ingest in apps/workers/src/queues/vbpl-docx.ts
//      relies on it).
//
// We read provisions straight from the SQL seed file (source of truth for
// the MVP corpus) rather than querying D1 — the only thing that has to
// match is the `id`, which retrieval uses to join a Vectorize match back
// to the legal_provisions row (packages/db/src/legal-repository.ts:listRetrievable).
//
// This is a plain Node + fetch script (no workerd), so it runs directly on
// the host — no Docker needed even on hosts with an old glibc.
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
//   [CLOUDFLARE_AI_GATEWAY_ID=default] \
//     node scripts/embed-legal-corpus.mjs --index safelaunch-legal-dev \
//       [--config apps/workers/wrangler.local.jsonc] \
//       [--skip-vector-id-update]

import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildBatchRequest,
  buildEmbeddingUrl,
  buildVectorIdUpdateSql,
  buildVectorizeRecords,
  parseBatchResponse,
  parseProvisions,
} from "./lib/embed-corpus-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(name);

const indexName = flag("--index");
const configPath = flag("--config");
const skipVectorIdUpdate = hasFlag("--skip-vector-id-update");

if (!indexName) {
  console.error(
    "Usage: node scripts/embed-legal-corpus.mjs --index <vectorize-index-name> [--config <wrangler-config>] [--skip-vector-id-update]",
  );
  process.exit(1);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the environment.");
  process.exit(1);
}

const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID ?? "default";
const embeddingUrl = buildEmbeddingUrl({ accountId, gatewayId });

const embedBatch = async (texts) => {
  const response = await fetch(embeddingUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
    body: JSON.stringify(buildBatchRequest(texts)),
  });
  const body = await response.json();
  return parseBatchResponse(body, texts.length);
};

const main = async () => {
  const sqlPath = path.join(repoRoot, "scripts", "seed-legal-corpus.sql");
  const sql = await readFile(sqlPath, "utf8");
  const provisions = parseProvisions(sql);
  if (provisions.length === 0) {
    throw new Error(
      `No provisions parsed from ${sqlPath} — check PROVISION_PATTERN still matches its format.`,
    );
  }
  console.log(`Parsed ${provisions.length} provisions from seed-legal-corpus.sql`);

  console.log(`Embedding ${provisions.length} provisions via AI Gateway '${gatewayId}'...`);
  const vectors = await embedBatch(provisions.map((p) => p.text));
  console.log(`ok (${vectors[0].length} dims × ${vectors.length})`);

  const records = buildVectorizeRecords(provisions, vectors);
  const outPath = path.join(repoRoot, "scripts", ".vectors.ndjson");
  await writeFile(outPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  console.log(`Wrote ${records.length} vectors to ${outPath}`);

  const wranglerArgs = ["exec", "wrangler", "vectorize", "insert", indexName, "--file", outPath];
  if (configPath) wranglerArgs.push("--config", path.resolve(repoRoot, configPath));
  console.log(`Running: pnpm ${wranglerArgs.join(" ")}`);
  try {
    execFileSync("pnpm", wranglerArgs, {
      stdio: "inherit",
      cwd: path.join(repoRoot, "apps/workers"),
    });
  } finally {
    // Always clean up the temp file — even if wrangler fails — so we don't
    // leave 12x768 floats on disk between attempts.
    await unlink(outPath).catch(() => undefined);
  }

  if (skipVectorIdUpdate) {
    console.log(
      `Done — upserted ${records.length} vectors into '${indexName}' (vector_id UPDATE skipped).`,
    );
    return;
  }

  const updateSql = buildVectorIdUpdateSql(provisions.map((p) => p.id));
  if (!updateSql) {
    console.log("No provisions to UPDATE; skipping D1 round-trip.");
    return;
  }
  const d1Args = ["exec", "wrangler", "d1", "execute", "DB", "--command", updateSql];
  if (configPath) d1Args.push("--config", path.resolve(repoRoot, configPath));
  console.log(`Updating legal_provisions.vector_id for ${provisions.length} rows...`);
  execFileSync("pnpm", d1Args, {
    stdio: "inherit",
    cwd: path.join(repoRoot, "apps/workers"),
  });

  console.log(
    `Done — upserted ${records.length} vectors into '${indexName}' and set legal_provisions.vector_id for all ${provisions.length} rows.`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
