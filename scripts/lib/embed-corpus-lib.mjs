// Pure logic extracted from scripts/embed-legal-corpus.mjs so it can be
// unit-tested without spinning up Workers AI / Vectorize / D1.
//
// Keep this file dependency-free (no fetch, no child_process) — everything
// here is a pure function over its inputs.

/**
 * Matches each `('id', 'doc-id', 'article', NULL,\n   'text',\n   NULL, '[categories]')`
 * tuple in the VALUES lists of scripts/seed-legal-corpus.sql.
 *
 * Captures: 1 = id, 2 = text, 3 = categories JSON string.
 */
export const PROVISION_PATTERN =
  /\(\s*'([^']+)'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*,\s*NULL\s*,\s*\n\s*'((?:[^'\\]|\\.)*)'\s*,\s*\n\s*NULL\s*,\s*'(\[[^\]]*\])'\s*\)/g;

/**
 * Parse provision tuples from a seed SQL file.
 * Returns an array of { id, text, categories } where `categories` is parsed
 * from the trailing JSON string (e.g. '["online_game"]').
 *
 * Throws nothing: an empty result means the regex didn't match — the caller
 * should fail loudly with the offending file path.
 */
export const parseProvisions = (sql) => {
  const provisions = [];
  for (const match of sql.matchAll(PROVISION_PATTERN)) {
    provisions.push({
      id: match[1],
      text: match[2],
      categories: JSON.parse(match[3]),
    });
  }
  return provisions;
};

/**
 * Build the request body for a batch Workers AI embedding call.
 *
 * Workers AI's `@cf/baai/bge-base-en-v1.5` model accepts `{ text: string[] }`
 * and returns a vector per element, in order. We send all texts in one
 * request so the round-trip cost is amortised (and so a single Gateway
 * log records the whole batch).
 */
export const buildBatchRequest = (texts) => ({ text: texts });

/**
 * Parse the response body from a Workers AI batch embedding call and return
 * the vectors in the same order as the input texts.
 *
 * Throws if `success` is false or the result has fewer vectors than inputs.
 * The latter is a contract violation worth surfacing instead of silently
 * mis-aligning ids to vectors.
 */
export const parseBatchResponse = (body, expectedCount) => {
  if (!body.success) {
    throw new Error(`Workers AI embedding failed: ${JSON.stringify(body.errors)}`);
  }
  const vectors = body.result?.data ?? [];
  if (vectors.length === 0) {
    throw new Error("Workers AI returned an empty embedding vector");
  }
  if (vectors.length < expectedCount) {
    throw new Error(
      `Workers AI returned ${vectors.length} vectors but ${expectedCount} were expected`,
    );
  }
  return vectors.slice(0, expectedCount);
};

/**
 * Build one Vectorize record per (provision, vector) pair in the shape
 * `wrangler vectorize insert --file` expects:
 *
 *   {"id":"<provision-id>","values":[...],"metadata":{"categories":[...]}}
 *
 * Order matches `provisions` order, so the caller can detect drift if
 * Workers AI reordered anything.
 */
export const buildVectorizeRecords = (provisions, vectors) => {
  if (provisions.length !== vectors.length) {
    throw new Error(
      `Cannot build Vectorize records: ${provisions.length} provisions vs ${vectors.length} vectors`,
    );
  }
  return provisions.map((provision, index) => ({
    id: provision.id,
    values: vectors[index],
    metadata: { categories: provision.categories },
  }));
};

/**
 * Build the `legal_provisions.vector_id` UPDATE SQL for the given provision
 * ids. Sets `vector_id = id` for each row so D1 has a back-reference to
 * the Vectorize namespace (the spec'd deliverable for Tier 1.2).
 *
 * Single CASE expression to keep the round-trip to D1 to one batch
 * statement — the corpus is small but the pattern is what the production
 * ingest pipeline (apps/workers/src/queues/vbpl-docx.ts) will use too.
 */
export const buildVectorIdUpdateSql = (provisionIds) => {
  if (provisionIds.length === 0) return null;
  const escape = (id) => id.replace(/'/g, "''");
  const cases = provisionIds
    .map((id) => `WHEN id = '${escape(id)}' THEN '${escape(id)}'`)
    .join("\n        ");
  const idList = provisionIds.map((id) => `'${escape(id)}'`).join(", ");
  return `UPDATE legal_provisions
   SET vector_id = CASE ${cases}
       ELSE vector_id
   END
 WHERE id IN (${idList});`;
};

/**
 * Build the Workers AI run URL.
 *
 * AI Gateway routing for Workers AI happens via the `cf-aig-gateway-id`
 * request header (see {@link buildGatewayHeaders}), NOT via the URL path.
 * The path is the standard `/ai/run/<model>` endpoint that the Cloudflare
 * API exposes for every Workers AI model; with the header set, the request
 * is logged + cached via the gateway, without it the same endpoint goes
 * straight to Workers AI.
 *
 * This is the same endpoint `packages/ai/src/gateway.ts` reaches under the
 * hood — `env.AI.run(model, body, { gateway: { id } })` just attaches the
 * header server-side. We hit it directly so a one-shot script doesn't
 * need a Worker context.
 *
 * Reference: https://developers.cloudflare.com/ai-gateway/usage/rest-api/
 */
export const buildEmbeddingUrl = ({ accountId, model = "@cf/baai/bge-base-en-v1.5" }) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

/**
 * Build the request headers for a Workers AI inference call, optionally
 * routed through an AI Gateway.
 *
 * - `cf-aig-gateway-id: <gatewayId>` opts the request into AI Gateway
 *   logging/caching. Omit it (pass `gatewayId: undefined`) to make a direct
 *   call — useful as a fallback when the gateway is unconfigured.
 * - Authorization is the same Cloudflare API token used elsewhere; the
 *   required scope is `Account.Workers AI: Read`.
 */
export const buildGatewayHeaders = ({ apiToken, gatewayId }) => {
  const headers = {
    authorization: `Bearer ${apiToken}`,
    "content-type": "application/json",
  };
  if (gatewayId) {
    headers["cf-aig-gateway-id"] = gatewayId;
  }
  return headers;
};
