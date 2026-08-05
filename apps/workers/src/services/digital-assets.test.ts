import { describe, expect, it } from "vitest";
import { collectDigitalAssets, collectAssetReferences, type AssetFetcher } from "./digital-assets";

describe("digital asset collection", () => {
  it("collects image, audio, font and CDN references with redacted URLs", () => {
    const html = `
      <meta property="og:image" content="https://cdn.example.com/hero.jpg?token=secret" />
      <img src="/hero.png" srcset="/hero-2x.png 2x" />
      <audio><source src="/sound.mp3" type="audio/mpeg" /></audio>
      <link rel="preload" as="font" href="https://fonts.gstatic.com/font.woff2?auth=secret" />
      <style>@font-face { src: url('/brand.woff2') format('woff2'); } .hero { background-image: url('/bg.webp'); }</style>
    `;
    const refs = collectAssetReferences("https://example.com/", html);
    expect(refs.map((ref) => ref.kind)).toEqual(expect.arrayContaining(["image", "audio", "font"]));
    expect(refs.some((ref) => ref.url.includes("token"))).toBe(false);
    expect(refs.some((ref) => ref.kind === "font" && ref.url.includes("fonts.gstatic.com"))).toBe(
      true,
    );
  });

  it("blocks private hosts and classifies missing license evidence as a high-priority asset", async () => {
    const fetcher: AssetFetcher = {
      fetch: async (url) => {
        await Promise.resolve();
        return {
          status: 200,
          bytes: new TextEncoder().encode("asset bytes"),
          contentType: url.endsWith(".png") ? "image/png" : "font/woff2",
          finalUrl: url,
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<img src="http://127.0.0.1/private.png" /><img src="/public.png" />',
      fetcher,
    });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      status: "fetched",
      licenseEvidence: "no_license_evidence",
      url: "https://example.com/public.png",
    });
    expect(result.findings[0]).toMatchObject({ severity: "high", domain: "digital-rights" });
  });

  it("recognizes open-license and provider markers without downloading originals", async () => {
    const requested: string[] = [];
    const fetcher: AssetFetcher = {
      fetch: async (url) => {
        await Promise.resolve();
        requested.push(url);
        return {
          status: 200,
          bytes: new TextEncoder().encode("asset bytes"),
          contentType: "image/jpeg",
          finalUrl: url,
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<p>Creative Commons attribution required</p><img src="https://images.unsplash.com/photo.jpg" />',
      fetcher,
    });
    expect(result.assets[0]?.licenseEvidence).toBe("open_license_marker");
    expect(requested).toEqual(["https://images.unsplash.com/photo.jpg"]);
    expect(result.assets[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("follows an external stylesheet once to discover referenced fonts and backgrounds", async () => {
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
          contentType: url.endsWith("styles.css") ? "text/css" : "image/webp",
          finalUrl: url,
        };
      },
    };
    const result = await collectDigitalAssets({
      sourceUrl: "https://example.com/",
      html: '<link rel="stylesheet" href="/styles.css" />',
      fetcher,
    });
    expect(result.assets.map((asset) => asset.kind)).toEqual(
      expect.arrayContaining(["font", "image"]),
    );
  });
});
