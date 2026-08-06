import { describe, expect, it } from "vitest";
import {
  collectDigitalAssets,
  collectAssetReferences,
  pageHasAssetCandidates,
  type AssetFetcher,
} from "./digital-assets";
import { FontFamilyGroup, FontLicenseAssessment } from "@safelaunch/contracts";
import {
  robotoRegularBytes,
  robotoRegularSha256,
  robotoBoldBytes,
  robotoItalicBytes,
} from "./__fixtures__/font-fixtures";

describe("digital asset collection (font-only scope)", () => {
  it("collects only font references — drops image/audio/video", () => {
    const html = `
      <meta property="og:image" content="https://cdn.example.com/hero.jpg?token=secret" />
      <img src="/hero.png" srcset="/hero-2x.png 2x" />
      <audio><source src="/sound.mp3" type="audio/mpeg" /></audio>
      <video><source src="/trailer.mp4" type="video/mp4" /></video>
      <link rel="preload" as="font" href="https://fonts.gstatic.com/font.woff2?auth=secret" />
      <style>@font-face { src: url('/brand.woff2') format('woff2'); } .hero { background-image: url('/bg.webp'); }</style>
    `;
    const refs = collectAssetReferences("https://example.com/", html);
    const kinds = refs.map((ref) => ref.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === "font")).toBe(true);
    // Token redaction still applied.
    expect(refs.some((ref) => ref.url.includes("token"))).toBe(false);
    // Google Fonts CDN recognized as font source.
    expect(refs.some((ref) => ref.kind === "font" && ref.url.includes("fonts.gstatic.com"))).toBe(
      true,
    );
  });

  it("drops CSS background-image references (image kind) even when found in inline styles", () => {
    const html = `
      <style>
        .hero { background: url('/bg.webp'); background-image: url('/banner.png'); }
        .icon { background: url('/icon.svg'); }
      </style>
    `;
    const refs = collectAssetReferences("https://example.com/", html);
    expect(refs.some((ref) => ref.kind === "image")).toBe(false);
    expect(refs.some((ref) => ref.url.endsWith("/bg.webp"))).toBe(false);
    expect(refs.some((ref) => ref.url.endsWith("/banner.png"))).toBe(false);
  });

  it("blocks private hosts and classifies missing font license evidence as review", async () => {
    const fetcher: AssetFetcher = {
      fetch: async (url) => {
        await Promise.resolve();
        return {
          status: 200,
          bytes: new TextEncoder().encode("font bytes"),
          contentType: "font/woff2",
          finalUrl: url,
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<link rel="preload" as="font" href="http://127.0.0.1/private.woff2" /><link rel="preload" as="font" href="/public.woff2" />',
      fetcher,
    });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      status: "fetched",
      kind: "font",
      licenseEvidence: "no_license_evidence",
      url: "https://example.com/public.woff2",
    });
    expect(result.findings[0]).toMatchObject({ severity: "review", domain: "digital-rights" });
  });

  it("recognizes Creative Commons page markers for fonts without downloading originals", async () => {
    const requested: string[] = [];
    const fetcher: AssetFetcher = {
      fetch: async (url) => {
        await Promise.resolve();
        requested.push(url);
        return {
          status: 200,
          bytes: new TextEncoder().encode("font bytes"),
          contentType: "font/woff2",
          finalUrl: url,
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<p>Creative Commons attribution required</p><link rel="preload" as="font" href="/free.woff2" />',
      fetcher,
    });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.kind).toBe("font");
    expect(result.assets[0]?.licenseEvidence).toBe("open_license_marker");
    expect(requested).toEqual(["https://example.com/free.woff2"]);
    expect(result.assets[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("treats fonts.gstatic.com as a provider-licensed source (no flag)", async () => {
    const fetcher: AssetFetcher = {
      fetch: async (url) => {
        await Promise.resolve();
        return {
          status: 200,
          bytes: new TextEncoder().encode("font bytes"),
          contentType: "font/woff2",
          finalUrl: url,
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<link rel="preload" as="font" href="https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbWmT.ttf" />',
      fetcher,
    });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.licenseEvidence).toBe("provider_license");
    expect(result.findings).toHaveLength(0);
  });

  it("follows an external stylesheet once to discover referenced fonts only (image kind dropped)", async () => {
    const fetcher: AssetFetcher = {
      fetch: async (url) => {
        await Promise.resolve();
        return {
          status: 200,
          bytes: new TextEncoder().encode(
            url.endsWith("styles.css")
              ? "@font-face { src: url('/licensed.woff2'); } .hero { background: url('/hero.webp'); }"
              : "asset",
          ),
          contentType: url.endsWith("styles.css") ? "text/css" : "font/woff2",
          finalUrl: url,
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<link rel="stylesheet" href="/styles.css" />',
      fetcher,
    });
    expect(result.assets.length).toBeGreaterThan(0);
    expect(result.assets.every((a) => a.kind === "font")).toBe(true);
  });

  it("uses vbpl.vn search URL for COPYRIGHT_CITATION so the link stays reachable", async () => {
    const fetcher: AssetFetcher = {
      fetch: async (url) => {
        await Promise.resolve();
        return {
          status: 200,
          bytes: new TextEncoder().encode("font bytes"),
          contentType: "font/woff2",
          finalUrl: url,
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<link rel="preload" as="font" href="/plain.woff2" />',
      fetcher,
    });
    expect(result.findings[0]?.citations[0]?.url).toMatch(/^https:\/\/vbpl\.vn\/tim-kiem/);
    expect(result.findings[0]?.citations[0]?.url).toContain("Lu%E1%BA%ADt");
  });
});

describe("pageHasAssetCandidates", () => {
  it("returns true when at least one page contains a font reference", () => {
    const pages = [
      {
        url: "https://example.com/",
        html: '<link rel="preload" as="font" href="https://fonts.gstatic.com/x.woff2" />',
      },
      { url: "https://example.com/about", html: "<p>no fonts here</p>" },
    ];
    expect(pageHasAssetCandidates(pages)).toBe(true);
  });

  it("returns false when no page contains any font reference", () => {
    const pages = [
      { url: "https://example.com/", html: "<p>no fonts here</p>" },
      { url: "https://example.com/about", html: "<img src='/hero.png' />" },
    ];
    expect(pageHasAssetCandidates(pages)).toBe(false);
  });
});

describe("font binary inspection (V1)", () => {
  it("parses a Roboto Regular WOFF2 served from fonts.gstatic.com and reports verified_open", async () => {
    const fetcher: AssetFetcher = {
      fetch: async () => {
        await Promise.resolve();
        return {
          status: 200,
          bytes: robotoRegularBytes,
          contentType: "font/woff2",
          finalUrl: "",
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<link rel="preload" as="font" href="https://fonts.gstatic.com/s/roboto/regular.woff2" />',
      fetcher,
    });
    const asset = result.assets[0]!;
    expect(asset.sha256).toBe(robotoRegularSha256);
    expect(asset.fontInfo?.postscriptName).toBe("Roboto-Regular");
    expect(asset.fontLicense?.status).toBe("verified_open");
    expect(result.fontInventory.totals.families).toBe(1);
    expect(result.fontInventory.groups[0]!.family).toBe("Roboto");
  });

  it("groups multiple Roboto variants into one family in fontInventory", async () => {
    let counter = 0;
    const fetcher: AssetFetcher = {
      fetch: async (url) => {
        await Promise.resolve();
        const bytes = [robotoRegularBytes, robotoBoldBytes, robotoItalicBytes][counter++]!;
        return {
          status: 200,
          bytes,
          contentType: "font/woff2",
          finalUrl: url,
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: `
        <link rel="preload" as="font" href="https://fonts.gstatic.com/s/roboto/regular.woff2" />
        <link rel="preload" as="font" href="https://fonts.gstatic.com/s/roboto/bold.woff2" />
        <link rel="preload" as="font" href="https://fonts.gstatic.com/s/roboto/italic.woff2" />
      `,
      fetcher,
    });
    expect(result.assets).toHaveLength(3);
    expect(result.fontInventory.totals.families).toBe(1);
    expect(result.fontInventory.totals.files).toBe(3);
    expect(result.fontInventory.groups[0]!.variants).toHaveLength(3);
  });

  it("reports parse_failed when font bytes are garbage", async () => {
    const fetcher: AssetFetcher = {
      fetch: async () => {
        await Promise.resolve();
        return {
          status: 200,
          bytes: new Uint8Array([0, 1, 0, 0]),
          contentType: "font/woff2",
          finalUrl: "",
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<link rel="preload" as="font" href="https://cdn.example.com/garbage.woff2" />',
      fetcher,
    });
    const asset = result.assets[0]!;
    expect(asset.fontInfo).toBeNull();
    expect(asset.fontLicense?.status).toBe("unavailable");
    expect(asset.fontLicense?.reasonCodes).toContain("parse_failed");
  });

  it("exposes FontFamilyGroup + FontLicenseAssessment shapes that match the contracts schema", async () => {
    const fetcher: AssetFetcher = {
      fetch: async () => {
        await Promise.resolve();
        return {
          status: 200,
          bytes: robotoRegularBytes,
          contentType: "font/woff2",
          finalUrl: "",
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<link rel="preload" as="font" href="https://fonts.gstatic.com/s/roboto/r.woff2" />',
      fetcher,
    });
    const group = result.fontInventory.groups[0];
    expect(group).toBeDefined();
    expect(FontFamilyGroup.parse(group)).toBeTruthy();
    if (result.assets[0]?.fontLicense) {
      expect(FontLicenseAssessment.parse(result.assets[0]?.fontLicense)).toBeTruthy();
    }
  });
});
