import { describe, expect, it } from "vitest";
import {
  createEvaluationProvider,
  DEFAULT_EVALUATION_MODEL,
  parseModelOutput,
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

// Regression tests for the 2026-08-10 defensive LLM output parser.
// The 70B Workers AI model frequently:
//   (a) wraps its JSON in a markdown code fence (```json ... ```),
//   (b) uses field aliases ("reason" instead of "rationale"),
//   (c) omits fields that have empty defaults for severity 'review'/'pass'.
// parseModelOutput must recover gracefully from all three.
// See docs/superpowers/specs/2026-08-10-defensive-llm-parser.md.
describe("parseModelOutput", () => {
  it("strips a ```json markdown fence and parses the inner JSON", () => {
    const raw =
      "```json\n" +
      '{"severity":"review","rationale":"x","evidenceIds":[],"provisionIds":[],"legalQuotes":[],"confidence":0.5,"recommendedAction":"none"}\n' +
      "```";
    const out = parseModelOutput(raw);
    expect(out).not.toBeNull();
    expect(out!.severity).toBe("review");
    expect(out!.rationale).toBe("x");
  });

  it("strips a ``` fence without the 'json' language hint", () => {
    const raw =
      "```\n" +
      '{"severity":"review","rationale":"x","evidenceIds":[],"provisionIds":[],"legalQuotes":[],"confidence":0.5,"recommendedAction":"none"}\n' +
      "```";
    const out = parseModelOutput(raw);
    expect(out).not.toBeNull();
    expect(out!.severity).toBe("review");
  });

  it("parses plain JSON without fences", () => {
    const raw =
      '{"severity":"review","rationale":"x","evidenceIds":[],"provisionIds":[],"legalQuotes":[],"confidence":0.5,"recommendedAction":"none"}';
    const out = parseModelOutput(raw);
    expect(out!.severity).toBe("review");
  });

  it("returns null when the text contains no parseable JSON object", () => {
    expect(parseModelOutput("not json at all")).toBeNull();
    expect(parseModelOutput("")).toBeNull();
  });

  it("maps the 'reason' alias to 'rationale'", () => {
    const raw = '{"severity":"review","reason":"insufficient evidence","confidence":0.5}';
    const out = parseModelOutput(raw);
    expect(out).not.toBeNull();
    expect(out!.rationale).toBe("insufficient evidence");
  });

  it("maps other common aliases (citations->legalQuotes, action->recommendedAction)", () => {
    const raw =
      '{"severity":"review","rationale":"x","evidenceIds":["ev1"],"citations":["q1"],"action":"do thing"}';
    const out = parseModelOutput(raw);
    expect(out!.legalQuotes).toEqual(["q1"]);
    expect(out!.recommendedAction).toBe("do thing");
  });

  it("strips unknown keys (e.g. the model's stray 'category' field)", () => {
    const raw = '{"category":"online_game","severity":"review","rationale":"x","confidence":0.5}';
    const out = parseModelOutput(raw);
    expect(out).not.toBeNull();
    // unknown key 'category' must not appear in the parsed draft
    expect((out as unknown as Record<string, unknown>)["category"]).toBeUndefined();
  });

  it("recovers a review draft with the exact production shape (markdown fence + missing required keys)", () => {
    // Verbatim from the production log the user pasted on 2026-08-10.
    const raw =
      "```json\n" +
      '{"category":"electronic_press","severity":"review","confidence":0.5,"reason":"Insufficient evidence to evaluate compliance"}\n' +
      "```";
    const out = parseModelOutput(raw);
    expect(out).not.toBeNull();
    expect(out!.severity).toBe("review");
    expect(out!.rationale).toBe("Insufficient evidence to evaluate compliance");
    expect(out!.confidence).toBe(0.5);
    // Missing required arrays are filled with empty defaults (legal for
    // severity 'review' under the relaxed schema).
    expect(out!.evidenceIds).toEqual([]);
    expect(out!.provisionIds).toEqual([]);
    expect(out!.legalQuotes).toEqual([]);
    expect(typeof out!.recommendedAction).toBe("string");
    expect(out!.recommendedAction.length).toBeGreaterThan(0);
  });

  it("fills defaults for severity 'pass' the same way as 'review'", () => {
    const raw = '{"severity":"pass","rationale":"all good","confidence":1}';
    const out = parseModelOutput(raw);
    expect(out).not.toBeNull();
    expect(out!.severity).toBe("pass");
    expect(out!.evidenceIds).toEqual([]);
    expect(out!.legalQuotes).toEqual([]);
  });

  it("does NOT fill defaults for severity 'high' with missing legalQuotes (defensive-only for review/pass)", () => {
    // 'high' without legalQuotes must NOT be recovered; the caller's
    // fallback (or the schema's superRefine) handles it.
    const raw =
      '{"severity":"high","rationale":"...","evidenceIds":["ev1"],"provisionIds":["p1"],"confidence":0.95}';
    const out = parseModelOutput(raw);
    expect(out).toBeNull();
  });

  it("accepts an already-parsed object (idempotent)", () => {
    const raw = {
      severity: "review" as const,
      rationale: "x",
      evidenceIds: [],
      provisionIds: [],
      legalQuotes: [],
      confidence: 0.5,
      recommendedAction: "none",
    };
    const out = parseModelOutput(raw);
    expect(out).toEqual(raw);
  });
});
