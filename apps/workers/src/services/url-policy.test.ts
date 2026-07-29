import { describe, expect, it } from "vitest";
import { UnsafeUrlError, validatePublicUrl } from "./url-policy";

interface DnsRecords {
  [hostname: string]: readonly string[];
}

const makeDns = (records: DnsRecords = {}) => {
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (hostname: string) => {
    const match = records[hostname];
    if (!match) {
      throw new Error(`no dns record for ${hostname}`);
    }
    return match;
  };
};

const fakeResolve = makeDns({
  "vbpl.vn": ["203.113.147.10"],
  "example.com": ["93.184.216.34"],
  "api.example.com": ["93.184.216.40"],
});

describe("validatePublicUrl", () => {
  it.each([
    "http://127.0.0.1",
    "https://localhost/api",
    "http://[::1]",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "http://user:pass@example.com",
    "https://0.0.0.0",
    "https://0.1.2.3",
    "https://10.0.0.1",
    "https://172.16.5.4",
    "https://192.168.0.1",
  ])("rejects %s", async (url) => {
    await expect(validatePublicUrl(url, fakeResolve)).rejects.toThrow(UnsafeUrlError);
  });

  it("accepts a public https destination and returns the resolved addresses", async () => {
    const result = await validatePublicUrl("https://example.com", fakeResolve);
    expect(result.url.hostname).toBe("example.com");
    expect(result.url.protocol).toBe("https:");
    expect(result.addresses).toEqual(["93.184.216.34"]);
  });

  it("rejects dns results that resolve to a loopback address", async () => {
    const resolve = makeDns({ "evil.example.com": ["127.0.0.1"] });
    await expect(validatePublicUrl("https://evil.example.com", resolve)).rejects.toThrow(
      /loopback|blocked address/,
    );
  });

  it("rejects malformed urls", async () => {
    await expect(validatePublicUrl("not a url", fakeResolve)).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects hostnames whose dns resolves to a private address", async () => {
    const resolve = makeDns({ "private.example.com": ["10.0.0.1"] });
    await expect(validatePublicUrl("https://private.example.com", resolve)).rejects.toThrow(
      /blocked address/,
    );
  });

  it("rejects hostnames with no dns records", async () => {
    await expect(validatePublicUrl("https://missing.example.com", fakeResolve)).rejects.toThrow(
      /dns lookup failed/,
    );
  });
});
