/**
 * Durable Object: AbuseRateLimiter
 *
 * Owns the per-IP+per-hostname sliding-window rate-limit counter for the
 * anonymous scan endpoint. State lives in DO storage (not in the calling
 * Worker isolate's memory) so counters are consistent across isolates and
 * across multiple Worker invocations of the API.
 *
 * The DO accepts a single request shape:
 *   GET /check?key=<ipHash::hostHash>&windowMs=<ms>&max=<n>&now=<epochMs>
 *
 * Response JSON:
 *   { "allowed": boolean, "count": number, "windowStart": epochMs, "remaining": number }
 *
 * The DO never receives, stores, or returns the plaintext client IP or
 * hostname. The caller (the API Worker) hashes both fields with a
 * per-process salt before constructing `key`, so the DO cannot reverse
 * the identity even if its storage is inspected.
 */

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly max: number;
}

interface RateLimitEntry {
  readonly count: number;
  readonly windowStart: number;
}

export class AbuseRateLimiter {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Record<string, never>,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/check") {
      return new Response("Not found", { status: 404 });
    }
    const key = url.searchParams.get("key") ?? "";
    const windowMs = Number(url.searchParams.get("windowMs") ?? "60000");
    const max = Number(url.searchParams.get("max") ?? "30");
    const now = Number(url.searchParams.get("now") ?? `${Date.now()}`);
    if (!key || key.includes("..") || key.includes("/")) {
      await Promise.resolve();
      return jsonResponse({ allowed: false, error: "invalid key" }, 400);
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(max) || max <= 0) {
      await Promise.resolve();
      return jsonResponse({ allowed: false, error: "invalid config" }, 400);
    }
    const result = await this.checkAndIncrement(key, { windowMs, max }, now);
    return jsonResponse(result, result.allowed ? 200 : 429);
  }

  /**
   * Sliding window with the window anchored at the first hit in the window.
   * If the current time exceeds `windowStart + windowMs`, the window resets
   * and the new request becomes the first hit of a fresh window.
   */
  async checkAndIncrement(
    key: string,
    config: RateLimitConfig,
    now: number,
  ): Promise<{
    allowed: boolean;
    count: number;
    windowStart: number;
    remaining: number;
  }> {
    const existing = await this.state.storage.get<RateLimitEntry>(key);
    const fresh = existing === undefined || now - existing.windowStart > config.windowMs;
    const next: RateLimitEntry = fresh
      ? { count: 1, windowStart: now }
      : { count: existing.count + 1, windowStart: existing.windowStart };
    await this.state.storage.put(key, next);
    const remaining = Math.max(0, config.max - next.count);
    return {
      allowed: next.count <= config.max,
      count: next.count,
      windowStart: next.windowStart,
      remaining,
    };
  }
}

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
