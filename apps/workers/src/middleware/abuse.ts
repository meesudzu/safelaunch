/**
 * Anonymous-scan abuse controls.
 *
 * The MVP applies two layers of protection:
 *  1. **Rate limit** by a salted hash of the client IP and a salted hash of
 *     the request hostname. Raw IP and hostname are never written to
 *     logs or counters; only the opaque hash.
 *  2. **Turnstile verification** for the `/v1/scans` endpoint when the
 *     Turnstile site key is configured. The token is verified server-side
 *     against Cloudflare's siteverify endpoint and never persisted.
 */

import { hashOpaque } from "../observability";

export interface AbuseConfig {
  readonly rateLimit: {
    /** Max number of requests per IP-hash within the window. */
    readonly max: number;
    /** Sliding window duration in milliseconds. */
    readonly windowMs: number;
  };
  readonly turnstile: {
    /** Cloudflare Turnstile site key. When empty, Turnstile is skipped. */
    readonly siteKey: string;
    /** Cloudflare Turnstile secret. When empty, Turnstile is skipped. */
    readonly secret: string;
    /** Cloudflare siteverify endpoint. */
    readonly verifyUrl: string;
  };
}

const DEFAULT_CONFIG: AbuseConfig = {
  rateLimit: { max: 30, windowMs: 60_000 },
  turnstile: {
    siteKey: "",
    secret: "",
    verifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  },
};

export interface RequestContext {
  readonly ip: string;
  readonly hostname: string;
  readonly turnstileToken: string | null;
}

interface RateLimitState {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitState>();

export class AbuseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AbuseError";
  }
}

export const resetAbuseState = (): void => {
  rateLimitStore.clear();
};

const purgeExpiredEntries = (now: number, windowMs: number): void => {
  for (const [key, state] of rateLimitStore.entries()) {
    if (now - state.windowStart > windowMs) {
      rateLimitStore.delete(key);
    }
  }
};

export const enforceRateLimit = async (
  context: RequestContext,
  config: AbuseConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): Promise<void> => {
  purgeExpiredEntries(now, config.rateLimit.windowMs);
  const salt = "safelaunch-rate-limit-v1";
  const ipHash = await hashOpaque(context.ip, salt);
  const hostHash = await hashOpaque(context.hostname, salt);
  const key = `${ipHash}::${hostHash}`;
  const existing = rateLimitStore.get(key);
  if (!existing || now - existing.windowStart > config.rateLimit.windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return;
  }
  if (existing.count + 1 > config.rateLimit.max) {
    throw new AbuseError(
      429,
      "RATE_LIMITED",
      "Request rate exceeded; retry later.",
    );
  }
  existing.count += 1;
};

export interface TurnstileVerifyResult {
  readonly success: boolean;
  readonly hostname: string | null;
  readonly errorCodes: readonly string[];
}

export const verifyTurnstile = async (
  context: RequestContext,
  config: AbuseConfig = DEFAULT_CONFIG,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileVerifyResult> => {
  if (!config.turnstile.secret) {
    return { success: true, hostname: context.hostname, errorCodes: [] };
  }
  if (!context.turnstileToken) {
    return { success: false, hostname: context.hostname, errorCodes: ["missing-input-response"] };
  }
  const body = new URLSearchParams({
    secret: config.turnstile.secret,
    response: context.turnstileToken,
  });
  const response = await fetchImpl(config.turnstile.verifyUrl, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    return { success: false, hostname: context.hostname, errorCodes: ["siteverify-unreachable"] };
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const data = (await response.json()) as { success: boolean; hostname?: string; "error-codes"?: string[] };
  return {
    success: data.success === true,
    hostname: data.hostname ?? null,
    errorCodes: data["error-codes"] ?? [],
  };
};

export const enforceAbuseControls = async (
  context: RequestContext,
  config: AbuseConfig = DEFAULT_CONFIG,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  await enforceRateLimit(context, config);
  const turnstile = await verifyTurnstile(context, config, fetchImpl);
  if (!turnstile.success) {
    throw new AbuseError(
      403,
      "TURNSTILE_FAILED",
      `Turnstile verification failed (${turnstile.errorCodes.join(",") || "unknown"}).`,
    );
  }
};
