import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { AbuseRateLimiter } from "./abuse-rate-limiter-do";

interface CheckResponse {
  readonly allowed: boolean;
  readonly count: number;
  readonly remaining: number;
  readonly windowStart?: number;
}

const parseCheck = async (response: Response): Promise<CheckResponse> =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  (await response.json()) as unknown as CheckResponse;

/**
 * Integration tests for AbuseRateLimiter Durable Object. Each test gets
 * its own DO instance via `runInDurableObject`-style isolation keyed by
 * the DO name "test" — vitest-pool-workers gives every test its own
 * fresh isolate by default, so storage is naturally isolated.
 */
const getDO = (name: string): DurableObjectStub => {
  const id = env.ABUSE_RATE_LIMITER.idFromName(name);
  return env.ABUSE_RATE_LIMITER.get(id);
};

describe("AbuseRateLimiter DO (integration)", () => {
  it("allows the first request under the cap", async () => {
    const stub = getDO("first-request");
    const res = await stub.fetch(
      "https://abuse-rate-limiter.local/check?key=k1&windowMs=60000&max=3&now=1000",
    );
    expect(res.status).toBe(200);
    const body = await parseCheck(res);
    expect(body.allowed).toBe(true);
    expect(body.count).toBe(1);
    expect(body.remaining).toBe(2);
  });

  it("rejects the request that exceeds the cap", async () => {
    const stub = getDO("exceeds-cap");
    await stub.fetch("https://abuse-rate-limiter.local/check?key=k2&windowMs=60000&max=2&now=1000");
    await stub.fetch("https://abuse-rate-limiter.local/check?key=k2&windowMs=60000&max=2&now=2000");
    const third = await stub.fetch(
      "https://abuse-rate-limiter.local/check?key=k2&windowMs=60000&max=2&now=3000",
    );
    expect(third.status).toBe(429);
    const body = await parseCheck(third);
    expect(body.allowed).toBe(false);
    expect(body.count).toBeGreaterThan(2);
    expect(body.remaining).toBe(0);
  });

  it("resets the window once windowMs has elapsed", async () => {
    const stub = getDO("window-reset");
    await stub.fetch("https://abuse-rate-limiter.local/check?key=k3&windowMs=10000&max=1&now=1000");
    const blocked = await stub.fetch(
      "https://abuse-rate-limiter.local/check?key=k3&windowMs=10000&max=1&now=2000",
    );
    expect(blocked.status).toBe(429);
    const fresh = await stub.fetch(
      "https://abuse-rate-limiter.local/check?key=k3&windowMs=10000&max=1&now=12000",
    );
    expect(fresh.status).toBe(200);
    const body = await parseCheck(fresh);
    expect(body.count).toBe(1);
  });

  it("isolates counters across distinct keys", async () => {
    const stub = getDO("key-isolation");
    await stub.fetch("https://abuse-rate-limiter.local/check?key=A&windowMs=60000&max=1&now=1000");
    const blockedA = await stub.fetch(
      "https://abuse-rate-limiter.local/check?key=A&windowMs=60000&max=1&now=2000",
    );
    expect(blockedA.status).toBe(429);
    const okB = await stub.fetch(
      "https://abuse-rate-limiter.local/check?key=B&windowMs=60000&max=1&now=3000",
    );
    expect(okB.status).toBe(200);
  });

  it("rejects malformed requests with HTTP 400 and 404", async () => {
    const stub = getDO("malformed");
    const noKey = await stub.fetch(
      "https://abuse-rate-limiter.local/check?windowMs=60000&max=3&now=1000",
    );
    expect(noKey.status).toBe(400);
    const badConfig = await stub.fetch(
      "https://abuse-rate-limiter.local/check?key=k&windowMs=0&max=3&now=1000",
    );
    expect(badConfig.status).toBe(400);
    const badPath = await stub.fetch(
      "https://abuse-rate-limiter.local/not-check?key=k&windowMs=60000&max=3&now=1000",
    );
    expect(badPath.status).toBe(404);
  });
});

describe("AbuseRateLimiter.checkAndIncrement (unit)", () => {
  const makeInstance = () => {
    const store = new Map<string, { count: number; windowStart: number }>();
    const fakeState = {
      storage: {
        get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
        put: (key: string, value: { count: number; windowStart: number }): void => {
          store.set(key, value);
        },
      },
    } as unknown as DurableObjectState;
    return new AbuseRateLimiter(fakeState, {});
  };

  it("returns allowed=true when count is at the cap", async () => {
    const limiter = makeInstance();
    const result = await limiter.checkAndIncrement("k", { windowMs: 60_000, max: 3 }, 1_000);
    expect(result).toMatchObject({ allowed: true, count: 1, remaining: 2 });
  });

  it("opens a fresh window after windowMs elapses", async () => {
    const limiter = makeInstance();
    await limiter.checkAndIncrement("k", { windowMs: 1_000, max: 1 }, 0);
    const blocked = await limiter.checkAndIncrement("k", { windowMs: 1_000, max: 1 }, 500);
    expect(blocked.allowed).toBe(false);
    const fresh = await limiter.checkAndIncrement("k", { windowMs: 1_000, max: 1 }, 1_500);
    expect(fresh.allowed).toBe(true);
    expect(fresh.count).toBe(1);
  });
});
