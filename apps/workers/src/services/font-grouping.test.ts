import { describe, expect, it } from "vitest";
import {
  extractFontFamilyFromCss,
  groupAssetsIntoFamilies,
} from "./font-grouping";
import type {
  DigitalAsset,
  FontLicenseAssessment,
  FontLicenseStatus,
} from "@safelaunch/contracts";

const baseFontInfo = {
  familyName: "Roboto",
  subfamilyName: "Regular",
  fullName: "Roboto Regular",
  postscriptName: "Roboto-Regular",
  version: "3.015",
  copyright: "Copyright 2011 The Roboto Project Authors",
  vendorId: "GOOG",
  fsType: "installable" as const,
  format: "WOFF2" as const,
  fileSize: 17372,
};

const assessmentFor = (status: FontLicenseStatus): FontLicenseAssessment => ({
  status,
  reasonCodes: status === "verified_open" ? ["registry_hash_match"] : ["no_license_metadata"],
  confidence: 0.8,
  evidenceSources: [],
  retrievedAt: "2026-08-06T00:00:00.000Z",
  registryVersion: "test",
});

const makeAsset = (
  overrides: Partial<DigitalAsset> & { id: string; url: string; host: string },
): DigitalAsset => ({
  kind: "font",
  sourceUrl: "https://example.com/",
  contentType: "font/woff2",
  sha256: "6d6be3a7d40feb9b785e62c4b629a0e5949e50cbbbad06eea4800a4c311e9898",
  status: "fetched",
  licenseEvidence: "provider_license",
  licenseExcerpt: null,
  confidence: 0.8,
  ...overrides,
});

describe("extractFontFamilyFromCss", () => {
  it("returns an empty map for empty CSS", () => {
    const map = extractFontFamilyFromCss("", "");
    expect(map.size).toBe(0);
  });

  it("extracts a family from a single @font-face rule", () => {
    const css = `@font-face { font-family: "Roboto"; src: url('/brand.woff2') format('woff2'); }`;
    const map = extractFontFamilyFromCss(css, "");
    expect(map.get("Roboto")).toEqual(["/brand.woff2"]);
  });

  it("extracts multiple families and merges their urls", () => {
    const css = `
      @font-face { font-family: "Roboto"; src: url('/r.woff2') format('woff2'); }
      @font-face { font-family: "Inter"; src: url('/i.woff2') format('woff2'); }
    `;
    const map = extractFontFamilyFromCss(css, "");
    expect(map.get("Roboto")).toEqual(["/r.woff2"]);
    expect(map.get("Inter")).toEqual(["/i.woff2"]);
  });

  it("accepts unquoted family names", () => {
    const css = `@font-face { font-family: Helvetica; src: url('/h.woff2'); }`;
    const map = extractFontFamilyFromCss(css, "");
    expect(map.get("Helvetica")).toEqual(["/h.woff2"]);
  });
});

describe("groupAssetsIntoFamilies", () => {
  it("groups multiple Roboto variants into a single family", () => {
    const assets: DigitalAsset[] = [
      makeAsset({
        id: "asset::font::1",
        url: "https://cdn.example.com/Roboto-Regular.woff2",
        host: "cdn.example.com",
        fontInfo: { ...baseFontInfo, subfamilyName: "Regular", postscriptName: "Roboto-Regular" },
      }),
      makeAsset({
        id: "asset::font::2",
        url: "https://cdn.example.com/Roboto-Bold.woff2",
        host: "cdn.example.com",
        fontInfo: { ...baseFontInfo, subfamilyName: "Bold", postscriptName: "Roboto-Bold" },
      }),
      makeAsset({
        id: "asset::font::3",
        url: "https://cdn.example.com/Roboto-Italic.woff2",
        host: "cdn.example.com",
        fontInfo: { ...baseFontInfo, subfamilyName: "Italic", postscriptName: "Roboto-Italic" },
      }),
    ];
    const inv = groupAssetsIntoFamilies(assets, "");
    expect(inv.totals.families).toBe(1);
    expect(inv.totals.files).toBe(3);
    expect(inv.groups).toHaveLength(1);
    expect(inv.groups[0]!.family).toBe("Roboto");
    expect(inv.groups[0]!.variants).toHaveLength(3);
    // Sorted by PostScript name
    expect(inv.groups[0]!.variants[0]!.postscriptName).toBe("Roboto-Bold");
    expect(inv.groups[0]!.variants[1]!.postscriptName).toBe("Roboto-Italic");
    expect(inv.groups[0]!.variants[2]!.postscriptName).toBe("Roboto-Regular");
  });

  it("uses the most common host when the same family appears on multiple hosts", () => {
    const assets: DigitalAsset[] = [
      makeAsset({
        id: "asset::font::1",
        url: "https://cdn-a.example.com/Roboto-Regular.woff2",
        host: "cdn-a.example.com",
        fontInfo: { ...baseFontInfo, postscriptName: "Roboto-Regular" },
      }),
      makeAsset({
        id: "asset::font::2",
        url: "https://cdn-b.example.com/Roboto-Bold.woff2",
        host: "cdn-b.example.com",
        fontInfo: { ...baseFontInfo, subfamilyName: "Bold", postscriptName: "Roboto-Bold" },
      }),
    ];
    const inv = groupAssetsIntoFamilies(assets, "");
    expect(inv.groups[0]!.host).toBe("cdn-a.example.com");
    expect(inv.groups[0]!.hosts.sort()).toEqual(["cdn-a.example.com", "cdn-b.example.com"]);
  });

  it("falls back to CSS @font-face family when binary parse failed", () => {
    const css = `@font-face { font-family: "Roboto"; src: url('/r.woff2'); }`;
    const assets: DigitalAsset[] = [
      // No fontInfo → falls back to CSS @font-face.
      makeAsset({ id: "asset::font::1", url: "https://example.com/r.woff2", host: "example.com" }),
    ];
    const inv = groupAssetsIntoFamilies(assets, "", css);
    expect(inv.groups[0]!.family).toBe("Roboto");
  });

  it("puts assets with no metadata into a single 'Unknown' group", () => {
    const assets: DigitalAsset[] = [
      makeAsset({ id: "asset::font::1", url: "https://example.com/garbage.woff2", host: "example.com" }),
      makeAsset({ id: "asset::font::2", url: "https://example.com/garbage2.woff2", host: "example.com" }),
    ];
    const inv = groupAssetsIntoFamilies(assets, "");
    expect(inv.groups).toHaveLength(1);
    expect(inv.groups[0]!.family).toBe("Unknown");
    expect(inv.groups[0]!.variants).toHaveLength(2);
  });

  it("separates Arial from Roboto", () => {
    const assets: DigitalAsset[] = [
      makeAsset({
        id: "asset::font::1",
        url: "https://example.com/r.woff2",
        host: "example.com",
        fontInfo: { ...baseFontInfo },
      }),
      makeAsset({
        id: "asset::font::2",
        url: "https://example.com/a.woff2",
        host: "example.com",
        fontInfo: { ...baseFontInfo, familyName: "Arial", postscriptName: "ArialMT", subfamilyName: "Regular", fullName: "Arial Regular" },
      }),
    ];
    const inv = groupAssetsIntoFamilies(assets, "");
    expect(inv.groups).toHaveLength(2);
    const families = inv.groups.map((g) => g.family).sort();
    expect(families).toEqual(["Arial", "Roboto"]);
  });

  it("merges mixed status within a family into conflicting with family_status_mismatch", () => {
    const assets: DigitalAsset[] = [
      makeAsset({
        id: "asset::font::1",
        url: "https://example.com/r1.woff2",
        host: "example.com",
        fontInfo: { ...baseFontInfo },
        fontLicense: assessmentFor("verified_open"),
      }),
      makeAsset({
        id: "asset::font::2",
        url: "https://example.com/r2.woff2",
        host: "example.com",
        fontInfo: { ...baseFontInfo, postscriptName: "Roboto-Bold", subfamilyName: "Bold" },
        fontLicense: assessmentFor("unknown"),
      }),
    ];
    const inv = groupAssetsIntoFamilies(assets, "");
    expect(inv.groups).toHaveLength(1);
    expect(inv.groups[0]!.fontLicense?.status).toBe("conflicting");
    expect(inv.groups[0]!.fontLicense?.reasonCodes).toContain("family_status_mismatch");
    expect(inv.groups[0]!.flagged).toBe(true);
    expect(inv.totals.flagged).toBe(1);
  });

  it("flagged becomes true when any variant has isFlagged licenseEvidence", () => {
    const assets: DigitalAsset[] = [
      makeAsset({
        id: "asset::font::1",
        url: "https://example.com/r1.woff2",
        host: "example.com",
        fontInfo: { ...baseFontInfo },
        fontLicense: assessmentFor("verified_open"),
        licenseEvidence: "no_license_evidence",
      }),
    ];
    const inv = groupAssetsIntoFamilies(assets, "");
    expect(inv.groups[0]!.flagged).toBe(true);
    expect(inv.totals.flagged).toBe(1);
  });

  it("sorts groups alphabetically (case-insensitive) for stable rendering", () => {
    const assets: DigitalAsset[] = [
      makeAsset({
        id: "asset::font::1",
        url: "https://example.com/r.woff2",
        host: "example.com",
        fontInfo: { ...baseFontInfo },
      }),
      makeAsset({
        id: "asset::font::2",
        url: "https://example.com/i.woff2",
        host: "example.com",
        fontInfo: { ...baseFontInfo, familyName: "Inter", postscriptName: "Inter-Regular", fullName: "Inter Regular" },
      }),
    ];
    const inv = groupAssetsIntoFamilies(assets, "");
    expect(inv.groups.map((g) => g.family)).toEqual(["Inter", "Roboto"]);
  });

  it("ignores non-font assets", () => {
    const assets: DigitalAsset[] = [
      makeAsset({ id: "asset::image::1", url: "https://cdn.example.com/hero.jpg", host: "cdn.example.com", kind: "image" }),
    ];
    const inv = groupAssetsIntoFamilies(assets, "");
    expect(inv.groups).toHaveLength(0);
    expect(inv.totals.families).toBe(0);
  });
});
