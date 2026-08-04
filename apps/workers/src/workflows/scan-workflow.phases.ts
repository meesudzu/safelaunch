/**
 * Pure per-phase helpers extracted from `scan-workflow.runScan`.
 *
 * Each helper takes its dependencies as parameters (no global state) so it is
 * unit-testable in isolation. The Cloudflare Workflow entrypoint calls these
 * helpers inside `step.do(name, fn)` boundaries so the dashboard can render a
 * step-level Graph and the durable runtime can retry individual phases.
 */

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hex(new Uint8Array(digest));
};

/**
 * Deterministic report token derived from the scan id.
 * Stable across retries because the input (scanId) does not change between
 * attempts. Format: `rpt_<64 hex chars>` — 256 bits of entropy.
 */
export const deterministicReportToken = async (scanId: string): Promise<string> => {
  const inner = await sha256Hex(scanId);
  return `rpt_${inner}`;
};

/**
 * Token hash that `ReportRepository.upsert` persists, derived from the
 * deterministic token. Stable across retries, so a replay of `step.do(...)`
 * rewrites the same row instead of producing a duplicate.
 */
export const deterministicTokenHash = async (scanId: string): Promise<string> => {
  const token = await deterministicReportToken(scanId);
  return sha256Hex(token);
};
