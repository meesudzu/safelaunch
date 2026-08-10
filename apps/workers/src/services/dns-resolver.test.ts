import { describe, expect, it } from "vitest";
import { createDohResolver } from "./dns-resolver";

const dohJson = (answers: Array<{ type: number; data: string }>) =>
  new Response(JSON.stringify({ Answer: answers }), {
    status: 200,
    headers: { "content-type": "application/dns-json" },
  });

const asFetch = (handler: (url: string) => Response): typeof fetch =>
  ((url: string) => Promise.resolve(handler(url))) as unknown as typeof fetch;

describe("createDohResolver", () => {
  it("returns combined A and AAAA addresses", async () => {
    const fetchImpl = asFetch((url) => {
      if (url.includes("type=1")) {
        return dohJson([{ type: 1, data: "93.184.216.34" }]);
      }
      if (url.includes("type=28")) {
        return dohJson([{ type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" }]);
      }
      throw new Error(`unexpected query ${url}`);
    });

    const resolve = createDohResolver(fetchImpl);
    const addresses = await resolve("example.com");
    expect(addresses).toContain("93.184.216.34");
    expect(addresses).toContain("2606:2800:220:1:248:1893:25c8:1946");
  });

  it("returns an empty list for a hostname with no records instead of throwing", async () => {
    const fetchImpl = asFetch(() => dohJson([]));
    const resolve = createDohResolver(fetchImpl);
    await expect(resolve("no-such-host.example.invalid")).resolves.toEqual([]);
  });

  it("throws when both A and AAAA lookups fail", async () => {
    const fetchImpl = asFetch(() => new Response("bad gateway", { status: 502 }));
    const resolve = createDohResolver(fetchImpl);
    await expect(resolve("example.com")).rejects.toThrow(/DNS-over-HTTPS lookup failed/);
  });

  it("still resolves if only one of A/AAAA succeeds", async () => {
    const fetchImpl = asFetch((url) => {
      if (url.includes("type=1")) {
        return dohJson([{ type: 1, data: "93.184.216.34" }]);
      }
      return new Response("bad gateway", { status: 502 });
    });

    const resolve = createDohResolver(fetchImpl);
    await expect(resolve("example.com")).resolves.toEqual(["93.184.216.34"]);
  });
});
