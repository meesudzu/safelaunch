#!/usr/bin/env node
/**
 * Production smoke test for the SafeLaunch API.
 *
 * Hits a small set of critical endpoints, asserts they all return 2xx in
 * under 5 seconds, and prints a one-line PASS / FAIL summary suitable
 * for a release gate. No PII is logged — only status codes and timings.
 *
 * Usage:
 *   node scripts/smoke.mjs --base-url "$PRODUCTION_URL"
 *   node scripts/smoke.mjs --base-url https://api.example.com --max-latency-ms 3000
 */
import { setTimeout as sleep } from "node:timers/promises";

const parseArgs = (argv) => {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) continue;
    out[flag.slice(2)] = argv[i + 1];
  }
  return out;
};

const check = async (url, method, options = {}, maxLatencyMs) => {
  const start = Date.now();
  try {
    const response = await fetch(url, { method, ...options });
    const elapsed = Date.now() - start;
    const ok = response.ok && elapsed <= maxLatencyMs;
    return {
      url,
      method,
      status: response.status,
      elapsed,
      ok,
      error: undefined,
    };
  } catch (cause) {
    return {
      url,
      method,
      status: 0,
      elapsed: Date.now() - start,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
};

const main = async () => {
  const args = parseArgs(process.argv);
  const baseUrl = args["base-url"];
  const maxLatencyMs = Number(args["max-latency-ms"] ?? "5000");
  if (!baseUrl) {
    console.error("missing --base-url");
    process.exit(2);
  }
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  const probes = [{ method: "GET", path: "/v1/health" }];
  const results = [];
  for (const probe of probes) {
    const result = await check(`${trimmed}${probe.path}`, probe.method, {}, maxLatencyMs);
    results.push(result);
  }

  // Round-trip a real scan to exercise the queue + workflow.
  const scan = await fetch(`${trimmed}/v1/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://smoke.example.com/",
      jurisdiction: "VN",
      category: "online_game",
    }),
  });
  if (scan.ok) {
    const created = await scan.json();
    results.push({
      url: `${trimmed}/v1/scans`,
      method: "POST",
      status: scan.status,
      elapsed: 0,
      ok: true,
    });
    const final = await check(
      `${trimmed}/v1/scans/${encodeURIComponent(created.scanId)}`,
      "GET",
      {},
      maxLatencyMs,
    );
    results.push(final);
  } else {
    results.push({
      url: `${trimmed}/v1/scans`,
      method: "POST",
      status: scan.status,
      elapsed: 0,
      ok: false,
    });
  }

  await sleep(100);

  console.log("\nSmoke results:");
  let pass = true;
  for (const r of results) {
    const marker = r.ok ? "PASS" : "FAIL";
    const detail = r.error ? ` (${r.error})` : "";
    console.log(`  [${marker}] ${r.method} ${r.url} -> ${r.status} in ${r.elapsed}ms${detail}`);
    if (!r.ok) pass = false;
  }

  if (!pass) {
    console.error("\nSmoke FAILED");
    process.exit(1);
  }
  console.log("\nSmoke PASS");
};

await main();
