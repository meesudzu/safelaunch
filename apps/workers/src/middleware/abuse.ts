/**
 * Anonymous-scan abuse controls.
 *
 * The MVP applies two layers of protection:
 *  1. **Rate limit** by a salted hash of the client IP and a salted hash of
 *     the request hostname. Raw IP and hostname are never written to
 *     logs or counters; only the opaque hash. The counter lives in a
 *     Durable Object (`AbuseRateLimiter`) so it survives across Worker
 *     isolates — a vanilla `Map` would lose state on every cold start
 *     and diverge across isolates.
 *  2. **Turnstile verification** for the `/v1/scans` endpoint when the
 *     Turnstile site key is configured. The token is verified server-side
 *     against Cloudflare's siteverify endpoint and never persisted.
 *
 * Both controls are pure functions over an injected `DurableObjectStub`
 * and a `fetch` implementation, so the same code is exercised by tests
 * with a fake stub and by production with the real DO binding.
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

export const DEFAULT_CONFIG: AbuseConfig = {
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

/**
 * Minimal interface satisfied by `DurableObjectStub` in production and by
 * the fake stub in tests. We deliberately keep the surface narrow so the
 * middleware stays decoupled from the concrete DO binding.
 */
export interface RateLimiterStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

const buildCheckRequest = (
  key: string,
  config: AbuseConfig,
  now: number,
): Request => {
  const url = new URL("https://abuse-rate-limiter.local/check");
  url.searchParams.set("key", key);
  url.searchParams.set("windowMs", `${config.rateLimit.windowMs}`);
  url.searchParams.set("max", `${config.rateLimit.max}`);
  url.searchParams.set("now", `${now}`);
  return new Request(url.toString(), { method: "GET" });
};

const SALT = "safelaunch-rate-limit-v1";

export const buildRateLimitKey = async (
  context: RequestContext,
): Promise<string> => {
  const ipHash = await hashOpaque(context.ip, SALT);
  const hostHash = await hashOpaque(context.hostname, SALT);
  return `${ipHash}::${hostHash}`;
};

export const enforceRateLimit = async (
  context: RequestContext,
  stub: RateLimiterStub,
  config: AbuseConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): Promise<void> => {
  const key = await buildRateLimitKey(context);
  const response = await stub.fetch(buildCheckRequest(key, config, now));
  if (response.status === 429) {
    throw new AbuseError(429, "RATE_LIMITED", "Request rate exceeded; retry later.");
  }
  if (!response.ok) {
    throw new AbuseError(
      502,
      "RATE_LIMIT_BACKEND",
      `Rate-limiter backend returned ${response.status}`,
    );
  }
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
  const data = (await response.json()) as unknown as {
    success: boolean;
    hostname?: unknown;
    "error-codes"?: unknown;
  };
  return {
    success: data.success === true,
    hostname: typeof data.hostname === "string" ? data.hostname : null,
    errorCodes: Array.isArray(data["error-codes"]) ? (data["error-codes"] as string[]) : [],
  };
};

export interface AbuseControlsDeps {
  readonly rateLimiter: RateLimiterStub;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly config?: AbuseConfig;
}

export const enforceAbuseControls = async (
  context: RequestContext,
  deps: AbuseControlsDeps,
): Promise<void> => {
  const config = deps.config ?? DEFAULT_CONFIG;
  const now = deps.now ? deps.now() : Date.now();
  await enforceRateLimit(
    context,
    deps.rateLimiter,
    config,
    now,
  );
  const turnstile = await verifyTurnstile(context, config, deps.fetchImpl ?? fetch);
  if (!turnstile.success) {
    throw new AbuseError(
      403,
      "TURNSTILE_FAILED",
      `Turnstile verification failed (${turnstile.errorCodes.join(",") || "unknown"}).`,
    );
  }
};
