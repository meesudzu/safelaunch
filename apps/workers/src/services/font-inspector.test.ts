import { describe, expect, it } from "vitest";
import {
  assessFontLicense,
  parseFontBytes,
  type FontRegistry,
} from "./font-inspector";
import fontRegistry from "../data/font-registry.json";
import {
  robotoRegularBytes,
  robotoRegularSha256,
  robotoBoldBytes,
  robotoBoldSha256,
  robotoItalicBytes,
  robotoItalicSha256,
} from "./__fixtures__/font-fixtures";

const REGISTRY: FontRegistry = {
  version: fontRegistry.registryVersion,
  fonts: fontRegistry.fonts,
  commercialNameHints: fontRegistry.commercialNameHints,
  citation: fontRegistry.registryCitation,
};

const REGISTRY_CITATION = fontRegistry.registryCitation;

describe("parseFontBytes", () => {
  it("parses Roboto Regular WOFF2 (real fixture) and returns stable metadata", () => {
    const info = parseFontBytes(robotoRegularBytes, "font/woff2");
    expect(info).not.toBeNull();
    expect(info!.familyName).toBe("Roboto");
    expect(info!.postscriptName).toBe("Roboto-Regular");
    expect(info!.format).toBe("WOFF2");
    expect(info!.fileSize).toBe(robotoRegularBytes.byteLength);
    // OpenType fsType for Roboto is 0 (installable embedding).
    expect(info!.fsType).toBe("installable");
  });

  it("parses Roboto Bold (real fixture) with postscriptName=Roboto-Bold", () => {
    const info = parseFontBytes(robotoBoldBytes, "font/woff2");
    expect(info).not.toBeNull();
    expect(info!.postscriptName).toBe("Roboto-Bold");
  });

  it("parses Roboto Italic (real fixture) with postscriptName=Roboto-Italic", () => {
    const info = parseFontBytes(robotoItalicBytes, "font/woff2");
    expect(info).not.toBeNull();
    expect(info!.postscriptName).toBe("Roboto-Italic");
  });

  it("returns null for a 4-byte garbage buffer without throwing", () => {
    const info = parseFontBytes(new Uint8Array([0, 1, 0, 0]), null);
    expect(info).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    const info = parseFontBytes(new Uint8Array(0), null);
    expect(info).toBeNull();
  });

  it("returns a non-empty familyName for Roboto Regular", () => {
    const info = parseFontBytes(robotoRegularBytes, "font/woff2");
    expect(info).not.toBeNull();
    expect(info!.familyName).not.toBe("");
  });
});

describe("assessFontLicense", () => {
  it("returns verified_open via registry_hash_match when SHA matches a Google Fonts entry", () => {
    const fontInfo = parseFontBytes(robotoRegularBytes, "font/woff2")!;
    const assessment = assessFontLicense({
      fontInfo,
      host: "fonts.gstatic.com",
      contextHtml: "",
      sha256: robotoRegularSha256,
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("verified_open");
    expect(assessment.reasonCodes).toContain("registry_hash_match");
    expect(assessment.evidenceSources).toContainEqual(
      expect.objectContaining({ url: REGISTRY_CITATION.url }),
    );
    expect(assessment.registryVersion).toBe(REGISTRY.version);
  });

  it("returns verified_open via google_provider_identity_match when host is gstatic but SHA not in registry", () => {
    const fontInfo = parseFontBytes(robotoRegularBytes, "font/woff2")!;
    const assessment = assessFontLicense({
      fontInfo,
      host: "fonts.gstatic.com",
      contextHtml: "",
      sha256: "f".repeat(64), // not in registry
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("verified_open");
    expect(assessment.reasonCodes).toContain("google_provider_identity_match");
  });

  it("returns requires_license_proof when fsType is restricted (synthetic input)", () => {
    const fontInfo = {
      familyName: "Acme Sans",
      subfamilyName: "Bold",
      fullName: "Acme Sans Bold",
      postscriptName: "AcmeSans-Bold",
      version: "Version 1.0",
      copyright: "(c) Acme Foundry",
      vendorId: "ACME",
      fsType: "restricted" as const,
      format: "WOFF2" as const,
      fileSize: 1000,
    };
    const assessment = assessFontLicense({
      fontInfo,
      host: "cdn.example.com",
      contextHtml: "",
      sha256: "a".repeat(64),
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("requires_license_proof");
    expect(assessment.reasonCodes).toContain("fs_type_restricted_embedding");
    expect(assessment.confidence).toBeLessThanOrEqual(0.7);
  });

  it("returns requires_license_proof with commercial_catalog_name_hint for Helvetica on a non-Google host", () => {
    const fontInfo = {
      familyName: "Helvetica",
      subfamilyName: "Regular",
      fullName: "Helvetica Regular",
      postscriptName: "Helvetica",
      version: "Version 1.0",
      copyright: null,
      vendorId: "MONOTYPE",
      fsType: "installable" as const,
      format: "WOFF2" as const,
      fileSize: 1000,
    };
    const assessment = assessFontLicense({
      fontInfo,
      host: "fonts.cdn.example",
      contextHtml: "",
      sha256: "a".repeat(64),
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("requires_license_proof");
    expect(assessment.reasonCodes).toContain("commercial_catalog_name_hint");
    expect(assessment.confidence).toBeLessThanOrEqual(0.4);
  });

  it("returns declared_open when the page text contains a CC marker", () => {
    const fontInfo = {
      familyName: "Acme",
      subfamilyName: null,
      fullName: null,
      postscriptName: "Acme",
      version: null,
      copyright: null,
      vendorId: null,
      fsType: "installable" as const,
      format: "WOFF2" as const,
      fileSize: 1000,
    };
    const assessment = assessFontLicense({
      fontInfo,
      host: "cdn.example.com",
      contextHtml: "<p>Creative Commons attribution required</p>",
      sha256: "a".repeat(64),
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("declared_open");
    expect(assessment.reasonCodes).toContain("page_open_license_marker");
  });

  it("returns unknown when no metadata and no markers are present", () => {
    const fontInfo = {
      familyName: "Mystery",
      subfamilyName: null,
      fullName: null,
      postscriptName: "Mystery",
      version: null,
      copyright: null,
      vendorId: null,
      fsType: "installable" as const,
      format: "WOFF2" as const,
      fileSize: 1000,
    };
    const assessment = assessFontLicense({
      fontInfo,
      host: "example.com",
      contextHtml: "<p>hello world</p>",
      sha256: "a".repeat(64),
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("unknown");
    expect(assessment.reasonCodes).toContain("no_license_metadata");
  });

  it("returns conflicting when the SHA differs from a registered Google Fonts entry for the same PostScript name", () => {
    const fontInfo = parseFontBytes(robotoRegularBytes, "font/woff2")!;
    const assessment = assessFontLicense({
      fontInfo,
      // Host is NOT Google Fonts, but PostScript name matches registry.
      // SHA differs from the registered hash → registry_hash_mismatch.
      host: "cdn.example.com",
      contextHtml: "",
      sha256: 'a'.repeat(64),
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("conflicting");
    expect(assessment.reasonCodes).toContain("registry_hash_mismatch");
  });

  it("returns unavailable when fontInfo is null", () => {
    const assessment = assessFontLicense({
      fontInfo: null,
      host: "cdn.example.com",
      contextHtml: "",
      sha256: null,
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("unavailable");
    expect(assessment.reasonCodes).toContain("parse_failed");
  });

  it("returns verified_open with the registry citation when SHA matches Roboto Bold", () => {
    const fontInfo = parseFontBytes(robotoBoldBytes, "font/woff2")!;
    const assessment = assessFontLicense({
      fontInfo,
      host: "fonts.gstatic.com",
      contextHtml: "",
      sha256: robotoBoldSha256,
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("verified_open");
    expect(assessment.reasonCodes).toContain("registry_hash_match");
  });

  it("returns verified_open with the registry citation when SHA matches Roboto Italic", () => {
    const fontInfo = parseFontBytes(robotoItalicBytes, "font/woff2")!;
    const assessment = assessFontLicense({
      fontInfo,
      host: "fonts.gstatic.com",
      contextHtml: "",
      sha256: robotoItalicSha256,
      registry: REGISTRY,
    });
    expect(assessment.status).toBe("verified_open");
    expect(assessment.reasonCodes).toContain("registry_hash_match");
  });
});
