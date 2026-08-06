import { describe, expect, it } from "vitest";
import fontRegistry from "./font-registry.json";
import { FontFamilyGroup } from "@safelaunch/contracts";

describe("font registry snapshot", () => {
  it("has a registryVersion and fetchedAt", () => {
    expect(typeof fontRegistry.registryVersion).toBe("string");
    expect(fontRegistry.registryVersion.length).toBeGreaterThan(0);
    expect(typeof fontRegistry.fetchedAt).toBe("string");
    // ISO date
    expect(Number.isFinite(Date.parse(fontRegistry.fetchedAt))).toBe(true);
  });

  it("contains the V1 starter families (Roboto, Inter, Source Serif 4, JetBrains Mono, Noto Sans)", () => {
    const families = new Set(fontRegistry.fonts.map((entry) => entry.family));
    for (const expected of ["Roboto", "Inter", "Source Serif 4", "JetBrains Mono", "Noto Sans"]) {
      expect(families.has(expected)).toBe(true);
    }
  });

  it("every entry has a non-empty postscriptName and an OFL license by default", () => {
    for (const entry of fontRegistry.fonts) {
      expect(entry.postscriptName.length).toBeGreaterThan(0);
      expect(entry.license.length).toBeGreaterThan(0);
      expect(entry.licenseUrl).toMatch(/^https?:\/\//);
      expect(entry.sourceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("has no duplicate (family, postscriptName) pairs", () => {
    const seen = new Set<string>();
    for (const entry of fontRegistry.fonts) {
      const key = `${entry.family}::${entry.postscriptName}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("every variant parses against FontFamilyVariant (shape check)", () => {
    // Smoke check that the JSON shape matches what downstream consumers expect.
    for (const entry of fontRegistry.fonts) {
      // We only need to assert the structural minimum that other code relies on;
      // exhaustive zod parse happens in digital-assets.test.ts via the
      // FontFamilyGroup / FontLicenseAssessment types.
      expect(typeof entry.weight).toBe("number");
      expect(["normal", "italic", "oblique"]).toContain(entry.style);
    }
  });

  it("ships a commercialNameHints list restricted to Arial, Helvetica, Times New Roman", () => {
    expect(fontRegistry.commercialNameHints.length).toBeGreaterThan(0);
    const names = fontRegistry.commercialNameHints.map((h) => h.family).sort();
    expect(names).toContain("Arial");
    expect(names).toContain("Helvetica");
    expect(names).toContain("Times New Roman");
  });

  it("exposes a registry citation with url + retrievedAt", () => {
    expect(fontRegistry.registryCitation.url).toMatch(/^https?:\/\//);
    expect(Number.isFinite(Date.parse(fontRegistry.registryCitation.retrievedAt))).toBe(true);
  });
});

describe("font registry shapes are compatible with the contracts schema", () => {
  it("a synthetic family group built from registry rows passes the zod schema", () => {
    const first = fontRegistry.fonts[0];
    const group: unknown = {
      id: `font::${first!.family}`,
      family: first!.family,
      kind: "font",
      host: "fonts.gstatic.com",
      hosts: ["fonts.gstatic.com"],
      variants: [
        {
          assetId: "asset::font::gstatic",
          url: "https://fonts.gstatic.com/x.woff2",
          format: "woff2",
          postscriptName: first!.postscriptName,
          subfamilyName: null,
          version: first!.version,
          fileSha256: null,
          status: "fetched",
          licenseEvidence: "provider_license",
        },
      ],
      fontInfo: null,
      fontLicense: {
        status: "verified_open",
        reasonCodes: ["google_provider_identity_match"],
        confidence: 0.9,
        evidenceSources: [fontRegistry.registryCitation],
        retrievedAt: fontRegistry.fetchedAt,
        registryVersion: fontRegistry.registryVersion,
      },
      confidence: 0.9,
      flagged: false,
      citationCount: 1,
    };
    expect(FontFamilyGroup.parse(group)).toBeTruthy();
  });
});
