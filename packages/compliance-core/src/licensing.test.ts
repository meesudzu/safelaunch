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

  it("requires a social-network review for UGC plus another community behavior", () => {
    // Per Nghị định 27/2018/NĐ-CP amending Nghị định 72/2013/NĐ-CP, any two
    // distinct non-login community/sharing behaviors qualify. UGC (criterion 2)
    // plus a profile (criterion 1) is one common combination.
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
      "https://vbpl.vn/van-ban/trung-uong/nghi-dinh-27-2018-nd-cp",
    );
  });

  it("flags a pure forum pattern (content_feed + comment) as a social network", () => {
    // Criterion 3 (interaction) + criterion 4 (forum/group) per the decree.
    expect(hasSocialNetworkSignals([signal("content_feed"), signal("comment")])).toBe(true);
    const checks = evaluateLicenseRequirements({
      jurisdiction: "VN",
      category: "digital_entertainment",
      signals: [signal("login"), signal("content_feed"), signal("comment")],
      licenseClaims: [],
      registry: undefined,
      on: "2026-08-04",
    });
    expect(checks[0]).toMatchObject({ licenseType: "social_network", severity: "high" });
  });

  it("flags a social-discovery pattern (profile + follow) as a social network", () => {
    // Criterion 1 (profile) + criterion 3 (interaction) per the decree.
    expect(hasSocialNetworkSignals([signal("public_profile"), signal("follow_or_friend")])).toBe(
      true,
    );
  });

  it("does not flag a single community behavior as a social network", () => {
    // Just a profile, just publishing, just commenting — each on its own
    // is not enough; login alone is also not enough.
    expect(hasSocialNetworkSignals([signal("login"), signal("public_profile")])).toBe(false);
    expect(hasSocialNetworkSignals([signal("login"), signal("ugc")])).toBe(false);
    expect(hasSocialNetworkSignals([signal("login"), signal("comment")])).toBe(false);
    expect(hasSocialNetworkSignals([signal("login"), signal("content_feed")])).toBe(false);
    expect(hasSocialNetworkSignals([signal("login"), signal("share")])).toBe(false);
    expect(hasSocialNetworkSignals([signal("login"), signal("follow_or_friend")])).toBe(false);
  });

  it("counts editorial publishing plus UGC as a social-network gate", () => {
    // An editorial press product that also enables user publishing is a
    // social network per the decree.
    expect(hasSocialNetworkSignals([signal("editorial_publishing"), signal("ugc")])).toBe(false); // editorial_publishing is not in the social-network set
    expect(
      hasSocialNetworkSignals([signal("editorial_publishing"), signal("ugc"), signal("comment")]),
    ).toBe(true);
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

  it("explains the login-alone exclusion in the rationale when no other behavior is present", () => {
    // No license checks are emitted (login alone is not a social network),
    // so the rationale we care about lives in the empty-checks path.
    const checks = evaluateLicenseRequirements({
      jurisdiction: "VN",
      category: "digital_entertainment",
      signals: [signal("login")],
      licenseClaims: [],
      registry: undefined,
      on: "2026-08-04",
    });
    expect(checks).toEqual([]);
  });
});
