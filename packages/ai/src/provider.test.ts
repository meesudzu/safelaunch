import { describe, expect, it } from "vitest";
import {
  createEvaluationProvider,
  DEFAULT_EVALUATION_MODEL,
  type ProviderDeps,
  type ProviderInput,
} from "./provider";
import type { GatewayConfig } from "./gateway";

/**
 * Tests for the AI Gateway provider boundary.
 *
 * These tests protect against the Cloudflare model-deprecation footgun
 * that took the evaluation pipeline down on 2026-05-30 when
 * `@cf/meta/llama-3.1-8b-instruct` was retired. The default id is a
 * literal in the source, so any future model swap must update BOTH
 * `provider.ts` AND this test.
 */

// Models that were once used by SafeLaunch but are now retired.
// If you find yourself adding to this set, double-check that
// `provider.ts` no longer references the retired id before bumping
// `DEFAULT_EVALUATION_MODEL` to the next canonical id.
const DEPRECATED_MODEL_IDS = [
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3-8b-instruct",
  "@cf/meta/llama-3-8b-instruct-awq",
] as const;

const fakeDraftJson = JSON.stringify({
  severity: "pass",
  rationale: "ok",
  evidenceIds: ["ev-1"],
  provisionIds: ["prov-1"],
  legalQuotes: ["quote"],
  confidence: 0.5,
  recommendedAction: "none",
});

interface FakeAiCall {
  readonly model: string;
  readonly messages: { role: string; content: string }[];
  readonly gateway: unknown;
}

const fakeAi = (): { ai: Ai; calls: FakeAiCall[] } => {
  const calls: FakeAiCall[] = [];
  const ai = {
    run: (
      model: string,
      payload: { messages: { role: string; content: string }[] },
      opts?: { gateway?: unknown },
    ): Promise<{ response: string; aiGatewayLogId: string | null }> => {
      calls.push({ model, messages: payload.messages, gateway: opts?.gateway });
      return Promise.resolve({
        response: fakeDraftJson,
        aiGatewayLogId: "log-1",
      });
    },
  };
  return { ai: ai as unknown as Ai, calls };
};

const gateway: GatewayConfig = { id: "default" };

const baseInput: ProviderInput = {
  category: "electronic_press",
  websiteContent: "Chính sách bảo mật dữ liệu cá nhân",
};

describe("DEFAULT_EVALUATION_MODEL", () => {
  it("is exported", () => {
    expect(typeof DEFAULT_EVALUATION_MODEL).toBe("string");
    expect(DEFAULT_EVALUATION_MODEL.startsWith("@cf/")).toBe(true);
  });

  it("points at a currently-supported Workers AI catalog id", () => {
    // When the team migrates to a different model, update both this
    // expectation AND `provider.ts`. CI will fail otherwise.
    expect(DEFAULT_EVALUATION_MODEL).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("is not any id SafeLaunch has previously retired", () => {
    expect(DEPRECATED_MODEL_IDS.length).toBeGreaterThan(0);
    expect(DEPRECATED_MODEL_IDS).not.toContain(DEFAULT_EVALUATION_MODEL);
  });
});

describe("createEvaluationProvider", () => {
  it("uses DEFAULT_EVALUATION_MODEL when no model override is given", async () => {
    const { ai, calls } = fakeAi();
    const deps: ProviderDeps = { ai, gateway };
    const provider = createEvaluationProvider(deps);
    const result = await provider(baseInput);
    expect(result.draft.severity).toBe("pass");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe(DEFAULT_EVALUATION_MODEL);
  });

  it("lets the caller override the model id", async () => {
    const { ai, calls } = fakeAi();
    const deps: ProviderDeps = {
      ai,
      gateway,
      model: "@cf/meta/llama-3.2-3b-instruct",
    };
    const provider = createEvaluationProvider(deps);
    await provider(baseInput);
    expect(calls[0]!.model).toBe("@cf/meta/llama-3.2-3b-instruct");
  });

  it("sends system rules and website content in separate messages", async () => {
    const { ai, calls } = fakeAi();
    const deps: ProviderDeps = {
      ai,
      gateway,
      systemRules: "CUSTOM-RULES",
    };
    const provider = createEvaluationProvider(deps);
    await provider(baseInput);
    const messages = calls[0]!.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toBe("CUSTOM-RULES");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain(baseInput.websiteContent);
    // Prompt-injection guard: website content stays wrapped in untrusted tags.
    expect(messages[1]!.content).toContain("<untrusted_website_content>");
    expect(messages[0]!.content).not.toContain(baseInput.websiteContent);
  });

  it("threads the gateway config into the ai.run options", async () => {
    const { ai, calls } = fakeAi();
    const customGateway: GatewayConfig = { id: "safelaunch-legal", cacheTtl: 300 };
    const deps: ProviderDeps = { ai, gateway: customGateway };
    const provider = createEvaluationProvider(deps);
    await provider(baseInput);
    expect(calls[0]!.gateway).toEqual({ id: "safelaunch-legal", cacheTtl: 300 });
  });
});
