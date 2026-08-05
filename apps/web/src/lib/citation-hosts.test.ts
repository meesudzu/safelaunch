import { describe, expect, it } from "vitest";
import { APPROVED_CITATION_HOSTS, isApprovedCitationUrl } from "./citation-hosts";

describe("citation host allow-list", () => {
  it("accepts vbpl.vn URLs (the primary legal corpus)", () => {
    expect(isApprovedCitationUrl("https://vbpl.vn/tim-kiem?SearchIn=all&q=test")).toBe(true);
    expect(isApprovedCitationUrl("https://www.vbpl.vn/foo")).toBe(true);
    expect(isApprovedCitationUrl("HTTPS://VBPL.VN/bar")).toBe(true);
  });

  it("accepts hoidapphapluat.vn and thuvienphapluat.vn URLs", () => {
    expect(isApprovedCitationUrl("https://hoidapphapluat.vn/q/123")).toBe(true);
    expect(isApprovedCitationUrl("https://thuvienphapluat.vn/van-ban/abc")).toBe(true);
  });

  it("rejects hosts outside the allow-list", () => {
    expect(isApprovedCitationUrl("https://example.com/abc")).toBe(false);
    expect(isApprovedCitationUrl("https://vbpl.vn.evil.example/abc")).toBe(false);
    expect(isApprovedCitationUrl("https://notvbpl.vn/abc")).toBe(false);
  });

  it("rejects malformed URLs without throwing", () => {
    expect(isApprovedCitationUrl("not a url")).toBe(false);
    expect(isApprovedCitationUrl("")).toBe(false);
  });

  it("exports a frozen-typed list of approved hosts", () => {
    expect(APPROVED_CITATION_HOSTS).toContain("vbpl.vn");
    expect(APPROVED_CITATION_HOSTS.length).toBeGreaterThan(0);
  });
});
