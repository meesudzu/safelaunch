import { describe, expect, it } from "vitest";
import { DigitalAsset, LicenseCheck, ServiceSignal } from "./digital-rights";

describe("digital rights contracts", () => {
  it("accepts a source-backed service signal", () => {
    expect(
      ServiceSignal.parse({
        id: "signal::ugc",
        kind: "ugc",
        observed: true,
        confidence: 0.92,
        sourceUrl: "https://example.com/community",
        excerpt: "Đăng bài và bình luận",
        evidenceId: "service_signal::ugc",
      }),
    ).toMatchObject({ kind: "ugc", observed: true });
  });

  it("requires a citation-backed license check", () => {
    expect(
      LicenseCheck.parse({
        id: "license::social-network",
        licenseType: "social_network",
        status: "required_not_found",
        severity: "high",
        rationale: "Chưa tìm thấy bằng chứng giấy phép.",
        confidence: 0.8,
        evidenceIds: ["service_signal::ugc"],
        citations: [
          {
            provisionId: "vn-social-license",
            source: "Quy định chính thức",
            url: "https://vbpl.vn/",
            retrievedAt: "2026-08-04T00:00:00.000Z",
            excerpt: "Quy định về giấy phép.",
          },
        ],
        recommendedAction: "Kiểm tra giấy phép.",
      }),
    ).toBeTruthy();
  });

  it("keeps asset URLs redacted and license evidence explicit", () => {
    expect(
      DigitalAsset.parse({
        id: "asset::image::1",
        kind: "image",
        url: "https://cdn.example.com/image.jpg?redacted=1",
        host: "cdn.example.com",
        sourceUrl: "https://example.com/",
        contentType: "image/jpeg",
        sha256: "a".repeat(64),
        status: "fetched",
        licenseEvidence: "no_license_evidence",
        licenseExcerpt: null,
        confidence: 0.55,
      }),
    ).toBeTruthy();
  });
});
