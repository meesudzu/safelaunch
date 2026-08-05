import type { WorkflowStepConfig } from "cloudflare:workers";

import type { DigitalAssetCollection } from "../services/digital-assets";

/**
 * The fallback result returned when a workflow step exhausts its retries
 * (typically because of a Worker CPU time limit, a step timeout, or a
 * transient platform failure). The downstream phases must be able to
 * consume this shape without throwing — that is the contract that keeps
 * the scan workflow from stopping when one phase blows up.
 *
 * Treat this as a "we have no signal for this phase" sentinel, not a
 * successful empty result. Operators should look for `scan.step_fallback`
 * log entries in observability to detect when this fires.
 */
export const EMPTY_DIGITAL_ASSET_COLLECTION: DigitalAssetCollection = {
  assets: [] as DigitalAssetCollection["assets"],
  findings: [] as DigitalAssetCollection["findings"],
  summary: { total: 0, byKind: {}, flagged: 0 },
};

/**
 * Subset of the Cloudflare `WorkflowStep` interface we depend on. Defined
 * locally so the helper can be unit-tested with a mock without pulling in
 * the runtime-only `cloudflare:workers` module. The real `WorkflowStep`
 * from that module is an abstract class which the eslint type checker
 * reports as "error", so callers should pass a `WorkflowStep` cast to
 * this interface (or use the real `step.do` directly when they want the
 * full type information).
 */

/**
 * Default `WorkflowStepConfig` applied to every scan-workflow step.
 *
 * Cloudflare Workers Paid gives each invocation a 5 minute (300 000 ms)
 * CPU ceiling. Setting the per-step timeout to the same value means a
 * step can run as long as its CPU budget allows without being killed
 * prematurely by a tighter per-step timeout. Phases that want a tighter
 * bound can still pass an explicit `timeout` in their own config — the
 * default is the floor, not the ceiling.
 *
 * Mirrored on the Worker side via `limits.cpu_ms` in wrangler.jsonc so
 * HTTP handlers and step closures see the same envelope.
 */
export const DEFAULT_SCAN_STEP_CONFIG: WorkflowStepConfig = {
  timeout: "5 minutes",
};

export interface WorkflowStepLike {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  do<T>(name: string, config: WorkflowStepConfig, callback: () => Promise<T>): Promise<T>;
}

export interface RunStepWithFallbackOptions<T> {
  readonly step: WorkflowStepLike;
  readonly name: string;
  readonly fallback: T;
  readonly fn: () => Promise<T>;
  readonly config?: WorkflowStepConfig;
  /**
   * Optional structured logger — receives a warning entry when the
   * fallback is used. The shape mirrors the entries emitted by the
   * workflow's `log` helper so they show up consistently in dashboards.
   */
  readonly log?: (entry: Record<string, unknown>) => void;
}

/**
 * Wraps a `step.do` call so that any failure (CPU time limit exceeded,
 * step timeout, exhausted retries, uncaught exception) is converted into
 * the supplied `fallback` value. The workflow continues to the next phase
 * instead of aborting the entire scan.
 *
 * Why this exists: a small fraction of scans produce enough asset
 * references that the `phase-5:classify-asset-rights` step blows past
 * the per-Worker CPU budget. Without this guard, the workflow runtime
 * retries the step 5 times (default config, exponential backoff) and
 * still throws — taking 5+ minutes before the user sees a failure.
 * With this guard, the workflow records a warning, returns the empty
 * collection, and the remaining phases (license evaluation, rule
 * evaluation, aggregation, report persistence) still complete.
 */
export const runStepWithFallback = async <T>(
  options: RunStepWithFallbackOptions<T>,
): Promise<T> => {
  const { step, name, fallback, fn, config, log } = options;
  try {
    const mergedConfig: WorkflowStepConfig = config
      ? { ...DEFAULT_SCAN_STEP_CONFIG, ...config }
      : DEFAULT_SCAN_STEP_CONFIG;
    return await step.do(name, mergedConfig, fn);
  } catch (cause) {
    const reason =
      cause instanceof Error
        ? cause.message || cause.name || "unknown error"
        : typeof cause === "string"
          ? cause
          : "unknown error";
    if (log) {
      log({
        level: "warn",
        event: "scan.step_fallback",
        step: name,
        reason,
        at: new Date().toISOString(),
      });
    }
    return fallback;
  }
};
