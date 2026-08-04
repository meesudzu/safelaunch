#!/usr/bin/env node
// One-shot: embed each provision in scripts/seed-legal-corpus.sql via
// Workers AI (@cf/baai/bge-base-en-v1.5, 768 dims) and upsert the vectors
// into a Vectorize index. This is the missing piece from
// docs/remaining.md Tier 1.2 — without it, retrieveLegalContext()
// (packages/ai/src/retrieval.ts) always gets zero matches and every rule
// falls back to "needs_review".
//
// Reads provisions straight from the SQL seed file (source of truth for the
// MVP corpus) rather than querying D1 — the only thing that has to match is
// the `id`, which retrieval uses to join a Vectorize match back to the
// legal_provisions row (packages/db/src/legal-repository.ts:listRetrievable).
//
// This is a plain Node + fetch script (no workerd), so it runs directly on
// the host — no Docker needed even on hosts with an old glibc.
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
//     node scripts/embed-legal-corpus.mjs --index safelaunch-legal-dev [--config apps/workers/wrangler.local.jsonc]

import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};

const indexName = flag("--index");
const configPath = flag("--config");

if (!indexName) {
  console.error(
    "Usage: node scripts/embed-legal-corpus.mjs --index <vectorize-index-name> [--config <wrangler-config>]",
  );
  process.exit(1);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the environment.");
  process.exit(1);
}

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

// Matches each `('id', 'doc-id', 'article', NULL,\n   'text',\n   NULL, '[categories]')`
// tuple in the VALUES lists of scripts/seed-legal-corpus.sql.
const PROVISION_PATTERN =
  /\(\s*'([^']+)'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*,\s*NULL\s*,\s*\n\s*'((?:[^'\\]|\\.)*)'\s*,\s*\n\s*NULL\s*,\s*'(\[[^\]]*\])'\s*\)/g;

const parseProvisions = (sql) => {
  const provisions = [];
  for (const match of sql.matchAll(PROVISION_PATTERN)) {
    provisions.push({ id: match[1], text: match[2], categories: JSON.parse(match[3]) });
  }
  return provisions;
};

const embed = async (text) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ text: [text] }),
    },
  );
  const body = await response.json();
  if (!body.success) {
    throw new Error(`Workers AI embedding failed: ${JSON.stringify(body.errors)}`);
  }
  const vector = body.result?.data?.[0];
  if (!vector || vector.length === 0) {
    throw new Error("Workers AI returned an empty embedding vector");
  }
  return vector;
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

  const lines = [];
  for (const provision of provisions) {
    process.stdout.write(`Embedding ${provision.id}... `);
    const values = await embed(provision.text);
    console.log(`ok (${values.length} dims)`);
    lines.push(
      JSON.stringify({ id: provision.id, values, metadata: { categories: provision.categories } }),
    );
  }

  const outPath = path.join(repoRoot, "scripts", ".vectors.ndjson");
  await writeFile(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${lines.length} vectors to ${outPath}`);

  const wranglerArgs = ["exec", "wrangler", "vectorize", "upsert", indexName, "--file", outPath];
  if (configPath) wranglerArgs.push("--config", path.resolve(repoRoot, configPath));
  console.log(`Running: pnpm ${wranglerArgs.join(" ")}`);
  execFileSync("pnpm", wranglerArgs, {
    stdio: "inherit",
    cwd: path.join(repoRoot, "apps/workers"),
  });

  await unlink(outPath);
  console.log(`Done — upserted ${lines.length} vectors into '${indexName}'.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
