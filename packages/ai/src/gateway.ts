import type { GatewayOptions } from "@cloudflare/workers-types";

/**
 * Cloudflare AI Gateway wrapper.
 *
 * Every model call (embedding, completion) routes through `env.AI.run(...)`
 * with a `gateway` option so that:
 *   - cache hits are observable in the AI Gateway dashboard;
 *   - request rate limits and retries are centralized;
 *   - prompts and metadata flow through AI Gateway logs.
 *
 * The `safelaunch-legal` gateway identifier is the same across every model
 * call so analytics aggregate by jurisdiction topic, not by model.
 */
export const DEFAULT_GATEWAY_ID = "safelaunch-legal";
export const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

export interface GatewayConfig {
  readonly id: string;
  readonly cacheTtl?: number;
  readonly skipCache?: boolean;
  readonly collectLog?: boolean;
  readonly retries?: {
    maxAttempts: 1 | 2 | 3 | 4 | 5;
    backoff?: "constant" | "linear" | "exponential";
  };
}

export const gatewayOptionsFor = (config: GatewayConfig): { gateway: GatewayOptions } => {
  const options: GatewayOptions = { id: config.id };
  if (config.cacheTtl !== undefined) options.cacheTtl = config.cacheTtl;
  if (config.skipCache !== undefined) options.skipCache = config.skipCache;
  if (config.collectLog !== undefined) options.collectLog = config.collectLog;
  if (config.retries !== undefined) options.retries = config.retries;
  return { gateway: options };
};

export interface EmbeddingDeps {
  readonly ai: Ai;
  readonly gateway: GatewayConfig;
  readonly model?: string;
}

export interface EmbeddingResult {
  readonly vector: readonly number[];
  readonly logId: string | null;
  readonly cached: boolean;
}

interface AiRunResponse {
  readonly data?: readonly (readonly number[])[];
  readonly aiGatewayLogId?: string | null;
  readonly cached?: boolean;
}

/**
 * Embed a single text via Workers AI through Cloudflare AI Gateway.
 * The returned `vector` is what we hand to Vectorize.
 */
export const embedText = async (text: string, deps: EmbeddingDeps): Promise<EmbeddingResult> => {
  const model = deps.model ?? DEFAULT_EMBEDDING_MODEL;
  const response = (await deps.ai.run(
    model,
    { text: [text] },
    gatewayOptionsFor(deps.gateway),
  )) as AiRunResponse;
  const vector = response.data?.[0] ?? [];
  if (vector.length === 0) {
    throw new Error(`embedding model ${model} returned an empty vector`);
  }
  return {
    vector,
    logId: response.aiGatewayLogId ?? null,
    cached: response.cached === true,
  };
};

/**
 * Embed a batch of texts in a single AI Gateway call.
 */
export const embedBatch = async (
  texts: readonly string[],
  deps: EmbeddingDeps,
): Promise<readonly EmbeddingResult[]> => {
  if (texts.length === 0) return [];
  const model = deps.model ?? DEFAULT_EMBEDDING_MODEL;
  const response = (await deps.ai.run(
    model,
    { text: [...texts] },
    gatewayOptionsFor(deps.gateway),
  )) as AiRunResponse;
  const vectors = response.data ?? [];
  return texts.map((_, index) => {
    const vector = vectors[index] ?? [];
    if (vector.length === 0) {
      throw new Error(`embedding model ${model} returned an empty vector at index ${index}`);
    }
    return { vector, logId: response.aiGatewayLogId ?? null, cached: response.cached === true };
  });
};
