import { describe, expect, it } from "vitest";
import { domainKey } from "./domain-key";

describe("domainKey", () => {
  it("returns the host for a bare https URL", () => {
    expect(domainKey("https://example.com")).toBe("example.com");
  });

  it("strips www. prefix", () => {
    expect(domainKey("https://www.example.com/")).toBe("example.com");
  });

  it("lowercases and ignores path/query/hash", () => {
    expect(domainKey("https://Example.com/path?x=1#frag")).toBe("example.com");
  });

  it("preserves localhost for dev", () => {
    expect(domainKey("http://localhost:3000")).toBe("localhost");
  });

  it("preserves IPv4 host literals", () => {
    expect(domainKey("http://192.168.1.1/foo")).toBe("192.168.1.1");
  });

  it("throws on invalid URL", () => {
    expect(() => domainKey("not a url")).toThrow();
  });

  it("preserves subdomains other than www", () => {
    expect(domainKey("https://app.example.com")).toBe("app.example.com");
    expect(domainKey("https://api.v2.example.com")).toBe("api.v2.example.com");
  });
});
