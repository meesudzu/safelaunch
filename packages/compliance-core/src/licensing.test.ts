import { describe, expect, it } from "vitest";
import type { ServiceSignal } from "@safelaunch/contracts";
import { evaluateLicenseRequirements, hasSocialNetworkSignals } from "./licensing";

const signal = (kind: ServiceSignal["kind"]): ServiceSignal => ({
  id: `signal::${kind}`,
  kind,
  observed: true,
  confidence: 0.9,
  sourceUrl: "https://example.com/community",
  excerpt: kind,
  evidenceId: `signal::${kind}`,
});

describe("license requirements", () => {
  it("does not treat login alone as a social network", () => {
    expect(hasSocialNetworkSignals([signal("login")])).toBe(false);
    expect(
      evaluateLicenseRequirements({
        jurisdiction: "VN",
        category: "digital_entertainment",
        signals: [signal("login")],
        licenseClaims: [],
        registry: undefined,
        on: "2026-08-04",
      }),
    ).toEqual([]);
  });

  it("requires a social-network review for UGC plus an interaction signal", () => {
    expect(hasSocialNetworkSignals([signal("ugc"), signal("public_profile")])).toBe(true);
    const checks = evaluateLicenseRequirements({
      jurisdiction: "VN",
      category: "digital_entertainment",
      signals: [signal("ugc"), signal("public_profile")],
      licenseClaims: [],
      registry: undefined,
      on: "2026-08-04",
    });
    expect(checks[0]).toMatchObject({
      licenseType: "social_network",
      status: "required_unavailable",
      severity: "high",
    });
    expect(checks[0]?.citations[0]?.url).toBe(
      "https://vbpl.vn/van-ban/trung-uong/luat-an-toan-thong-tin-mang-2015",
    );
  });

  it("marks a declared and verified license as pass", () => {
    const checks = evaluateLicenseRequirements({
      jurisdiction: "VN",
      category: "electronic_press",
      signals: [signal("editorial_publishing")],
      licenseClaims: [
        {
          value: "Giấy phép số 123",
          evidenceId: "license_claim::1",
          sourceUrl: "https://example.com/about",
        },
      ],
      registry: {
        licenseType: "electronic_press",
        status: "verified",
        sourceUrl: "https://registry.example.gov.vn/license/123",
        retrievedAt: "2026-08-04T00:00:00.000Z",
        rationale: "Matched",
      },
      on: "2026-08-04",
    });
    expect(checks[0]).toMatchObject({ status: "required_verified", severity: "pass" });
  });
});
