import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  buildRateLimitKey,
  enforceRateLimit,
  type RateLimiterStub,
  type RequestContext,
} from "./abuse";

const baseContext: RequestContext = {
  ip: "203.0.113.7",
  hostname: "example.com",
  turnstileToken: null,
};

class FakeStub implements RateLimiterStub {
  responses: Response[] = [];
  requests: Request[] = [];
  fetch(input: Request | string): Promise<Response> {
    const req = typeof input === "string" ? new Request(input) : input;
    this.requests.push(req);
    const next = this.responses.shift();
    if (!next) throw new Error("FakeStub exhausted");
    return Promise.resolve(next);
  }
}

const okResponse = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ allowed: true, count: 1, remaining: 29, ...overrides }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("enforceRateLimit", () => {
  it("throws AbuseError(429) when the DO returns 429", async () => {
    const stub = new FakeStub();
    stub.responses.push(
      new Response(JSON.stringify({ allowed: false, count: 31, remaining: 0 }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(enforceRateLimit(baseContext, stub)).rejects.toMatchObject({
      name: "AbuseError",
      status: 429,
      code: "RATE_LIMITED",
    });
  });

  it("throws AbuseError(502) when the DO returns a non-OK, non-429 status", async () => {
    const stub = new FakeStub();
    stub.responses.push(new Response("upstream broke", { status: 500 }));
    await expect(enforceRateLimit(baseContext, stub)).rejects.toMatchObject({
      name: "AbuseError",
      status: 502,
      code: "RATE_LIMIT_BACKEND",
    });
  });

  it("resolves when the DO returns 200", async () => {
    const stub = new FakeStub();
    stub.responses.push(okResponse());
    await expect(enforceRateLimit(baseContext, stub)).resolves.toBeUndefined();
  });

  it("builds a key from hashed ip + hostname (no plaintext in the URL)", async () => {
    const stub = new FakeStub();
    stub.responses.push(okResponse());
    await enforceRateLimit(baseContext, stub, DEFAULT_CONFIG, 1_700_000_000_000);
    expect(stub.requests).toHaveLength(1);
    const url = new URL(stub.requests[0]!.url);
    const key = url.searchParams.get("key") ?? "";
    expect(key).toMatch(/^[0-9a-f]+::[0-9a-f]+$/);
    expect(key).not.toContain("203.0.113.7");
    expect(key).not.toContain("example.com");
    expect(url.searchParams.get("windowMs")).toBe(`${DEFAULT_CONFIG.rateLimit.windowMs}`);
    expect(url.searchParams.get("max")).toBe(`${DEFAULT_CONFIG.rateLimit.max}`);
    expect(url.searchParams.get("now")).toBe("1700000000000");
  });
});

describe("buildRateLimitKey", () => {
  it("returns a stable key for identical inputs", async () => {
    const a = await buildRateLimitKey(baseContext);
    const b = await buildRateLimitKey(baseContext);
    expect(a).toBe(b);
  });

  it("differs when the IP differs", async () => {
    const a = await buildRateLimitKey(baseContext);
    const b = await buildRateLimitKey({ ...baseContext, ip: "198.51.100.1" });
    expect(a).not.toBe(b);
  });

  it("differs when the hostname differs", async () => {
    const a = await buildRateLimitKey(baseContext);
    const b = await buildRateLimitKey({ ...baseContext, hostname: "other.test" });
    expect(a).not.toBe(b);
  });
});
