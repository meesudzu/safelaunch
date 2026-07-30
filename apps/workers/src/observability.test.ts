import { describe, expect, it } from "vitest";
import { toLogEvent, hashOpaque } from "./observability";

const baseRequest = {
  method: "POST",
  url: "https://api.example.com/v1/scans",
  ip: "203.0.113.42",
  userAgent: "SafeLaunchBot/1.0",
  body: { url: "https://game.test/about", token: "rpt_abc" },
};

describe("toLogEvent", () => {
  it("redacts raw URL paths and never carries tokens", async () => {
    const event = await toLogEvent(baseRequest);
    expect(event.path).toBeUndefined();
    expect(event.url).toBeUndefined();
    expect(event.body).toBeUndefined();
    expect(event.token).toBeUndefined();
  });

  it("emits a host hash and a salted IP hash, never raw values", async () => {
    const event = await toLogEvent(baseRequest);
    expect(event.hostHash).toMatch(/^[0-9a-f]{8,}$/);
    expect(event.ipHash).toMatch(/^[0-9a-f]{8,}$/);
    expect(event.hostHash).not.toContain("example.com");
    expect(event.ipHash).not.toContain("203.0.113.42");
  });

  it("produces a stable hash for the same host + salt", async () => {
    const a = await hashOpaque("example.com", "salt-v1");
    const b = await hashOpaque("example.com", "salt-v1");
    expect(a).toBe(b);
  });

  it("produces a different hash for a different salt", async () => {
    const a = await hashOpaque("example.com", "salt-v1");
    const b = await hashOpaque("example.com", "salt-v2");
    expect(a).not.toBe(b);
  });

  it("includes a stable event name and timestamp", async () => {
    const event = await toLogEvent(baseRequest, { event: "scan.created", now: "2026-07-29T00:00:00.000Z" });
    expect(event.event).toBe("scan.created");
    expect(event.at).toBe("2026-07-29T00:00:00.000Z");
  });
});
