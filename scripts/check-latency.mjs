#!/usr/bin/env node
/**
 * Latency probe for the SafeLaunch scan endpoint.
 *
 * Submits N concurrent scan requests to `${baseUrl}/v1/scans`, polls
 * each scan until it reaches a terminal state, and reports the wall-clock
 * percentile distribution. The script exits non-zero if any of:
 *  - P95 >= `--max-p95-ms` (default 60 000 ms, the MVP release gate)
 *  - any request fails (HTTP error, scan failure, timeout)
 *
 * Usage:
 *   node scripts/check-latency.mjs --base-url "$STAGING_URL" --samples 100
 *   node scripts/check-latency.mjs --base-url https://api.example.com --samples 25 --category online_game
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

const percentile = (values, p) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower] ?? 0;
  return (sorted[lower] ?? 0) * (upper - rank) + (sorted[upper] ?? 0) * (rank - lower);
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${options.method ?? "GET"} ${url} failed: ${response.status} ${body}`);
  }
  return (await response.json()) ?? {};
};

const postScan = async (baseUrl, category) => {
  return fetchJson(`${baseUrl}/v1/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://example.com/",
      jurisdiction: "VN",
      category,
    }),
  });
};

const pollScan = async (baseUrl, scanId) => {
  const TERMINAL = new Set(["completed", "partial", "failed"]);
  const timeoutMs = 120_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await fetchJson(`${baseUrl}/v1/scans/${scanId}`);
    if (state.state && TERMINAL.has(state.state)) {
      return Date.now() - start;
    }
    await sleep(1000);
  }
  throw new Error(`scan ${scanId} did not reach a terminal state within ${timeoutMs} ms`);
};

const main = async () => {
  const args = parseArgs(process.argv);
  const baseUrl = args["base-url"];
  const samples = Number(args.samples ?? "25");
  const maxP95 = Number(args["max-p95-ms"] ?? "60000");
  const category = args.category ?? "online_game";
  const parallel = Number(args.parallel ?? "5");
  if (!baseUrl) {
    console.error("missing --base-url");
    process.exit(2);
  }

  console.log(
    `Latency probe: baseUrl=${baseUrl} samples=${samples} category=${category} maxP95=${maxP95}ms`,
  );

  const latencies = [];
  let failures = 0;
  const queue = Array.from({ length: samples }, (_, i) => i);
  const workers = Array.from({ length: parallel }, async () => {
    while (queue.length > 0) {
      const i = queue.shift();
      if (i === undefined) return;
      const start = Date.now();
      try {
        const { scanId } = await postScan(baseUrl, category);
        const elapsed = await pollScan(baseUrl, scanId);
        latencies.push(elapsed);
        console.log(`  [${i + 1}/${samples}] ${scanId}: ${elapsed} ms`);
      } catch (cause) {
        failures += 1;
        const elapsed = Date.now() - start;
        console.error(`  [${i + 1}/${samples}] FAILED after ${elapsed} ms: ${cause.message}`);
      }
    }
  });
  await Promise.all(workers);

  if (latencies.length === 0) {
    console.error("no successful samples; aborting");
    process.exit(1);
  }
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const max = Math.max(...latencies);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  console.log(
    `\nLatency summary (n=${latencies.length} failures=${failures}): mean=${mean.toFixed(0)}ms p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms max=${max.toFixed(0)}ms`,
  );
  if (failures > 0) {
    console.error(`${failures} sample(s) failed`);
    process.exit(1);
  }
  if (p95 >= maxP95) {
    console.error(`P95 ${p95.toFixed(0)}ms exceeds gate ${maxP95}ms`);
    process.exit(1);
  }
  console.log("PASS");
};

await main();
