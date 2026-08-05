import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_DIGITAL_ASSET_COLLECTION,
  runStepWithFallback,
  type WorkflowStepLike,
} from "./scan-workflow.steps";

/**
 * Test stub. We force the mock's `.do` to a generic so each test can
 * pass whatever shape it wants without the type system complaining
 * about DigitalAssetCollection vs. the test's return type.
 */
const makeStep = <T = unknown>(impl: () => Promise<T>): WorkflowStepLike => {
  // The double cast through `unknown` is required: the generic .do
  // signatures on WorkflowStepLike are overloaded and vi.fn's return
  // type is a single generic — TypeScript cannot reconcile the two
  // without help.
  return { do: vi.fn(impl) } as WorkflowStepLike;
};

describe("runStepWithFallback", () => {
  it("returns the step result when step.do resolves", async () => {
    const step = makeStep<typeof EMPTY_DIGITAL_ASSET_COLLECTION>(() =>
      Promise.resolve(EMPTY_DIGITAL_ASSET_COLLECTION),
    );
    const result = await runStepWithFallback({
      step,
      name: "phase-5:classify-asset-rights",
      fallback: EMPTY_DIGITAL_ASSET_COLLECTION,
      fn: () => Promise.resolve(EMPTY_DIGITAL_ASSET_COLLECTION),
    });
    expect(result).toBe(EMPTY_DIGITAL_ASSET_COLLECTION);
  });

  it("returns the fallback and logs a warning when step.do throws (simulated CPU timeout)", async () => {
    const cpuError = new Error("Worker exceeded CPU time limit.");
    const step = makeStep<typeof EMPTY_DIGITAL_ASSET_COLLECTION>(() => {
      throw cpuError;
    });
    const warnings: { level: string; event: string; step: string; reason: string }[] = [];
    const result = await runStepWithFallback({
      step,
      name: "phase-5:classify-asset-rights",
      fallback: EMPTY_DIGITAL_ASSET_COLLECTION,
      fn: () => Promise.resolve(EMPTY_DIGITAL_ASSET_COLLECTION),
      log: (entry) => {
        warnings.push(entry as { level: string; event: string; step: string; reason: string });
      },
    });
    expect(result).toBe(EMPTY_DIGITAL_ASSET_COLLECTION);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      level: "warn",
      event: "scan.step_fallback",
      step: "phase-5:classify-asset-rights",
    });
    expect(warnings[0]?.reason).toContain("CPU time limit");
  });

  it("returns the fallback when step.do rejects with a non-Error value", async () => {
    // Force a non-Error throw so the helper's typeof-string branch is
    // covered. The eslint rule `only-throw-error` is suppressed in
    // this block because that is exactly the behavior under test.
    /* eslint-disable @typescript-eslint/only-throw-error */
    const step = makeStep<unknown>(() => {
      throw "string error";
    });
    /* eslint-enable @typescript-eslint/only-throw-error */
    const result = await runStepWithFallback<unknown>({
      step,
      name: "phase-4:scan-assets-references",
      fallback: [] as never,
      fn: () => Promise.resolve([]),
    });
    expect(result).toEqual([]);
  });

  it("passes the step config (retries + timeout) through to step.do", async () => {
    const step = makeStep<typeof EMPTY_DIGITAL_ASSET_COLLECTION>(() =>
      Promise.resolve(EMPTY_DIGITAL_ASSET_COLLECTION),
    );
    await runStepWithFallback({
      step,
      name: "phase-5:classify-asset-rights",
      fallback: EMPTY_DIGITAL_ASSET_COLLECTION,
      config: { retries: { limit: 2, delay: 5_000, backoff: "constant" }, timeout: "3 minutes" },
      fn: () => Promise.resolve(EMPTY_DIGITAL_ASSET_COLLECTION),
    });
    const calls = (step.do as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    // step.do is called with (name, config, fn) when config is provided.
    expect(calls[0]?.[0]).toBe("phase-5:classify-asset-rights");
    expect(calls[0]?.[1]).toEqual({
      retries: { limit: 2, delay: 5_000, backoff: "constant" },
      timeout: "3 minutes",
    });
    expect(typeof calls[0]?.[2]).toBe("function");
  });
});

describe("EMPTY_DIGITAL_ASSET_COLLECTION", () => {
  it("is a well-formed empty collection", () => {
    expect(EMPTY_DIGITAL_ASSET_COLLECTION).toEqual({
      assets: [],
      findings: [],
      summary: { total: 0, byKind: {}, flagged: 0 },
    });
  });
});
