import { describe, expect, it } from "vitest";
import { evaluateLicenseRequirements } from "./licensing";
import { InMemoryLicenseRegistry, vbplLicenseRegistry } from "./license-registry";
import type { ServiceSignal } from "@safelaunch/contracts";

const signal = (kind: ServiceSignal["kind"]): ServiceSignal => ({
  id: `signal::${kind}`,
  kind,
  observed: true,
  confidence: 0.9,
  sourceUrl: "https://example.com/community",
  excerpt: kind,
  evidenceId: `signal::${kind}`,
});

const socialRegistry = async (): Promise<ReturnType<InMemoryLicenseRegistry["lookup"]>> =>
  new InMemoryLicenseRegistry().lookup({ jurisdiction: "VN", licenseType: "social_network" });

describe("in-memory license registry", () => {
  it("looks up an approved entry and reports a verified license", async () => {
    const registry = new InMemoryLicenseRegistry({
      online_game: [
        {
          licenseNumber: "123",
          subject: "Công ty An Toàn",
          validFrom: "2025-01-01",
          validTo: "2030-12-31",
        },
      ],
    });
    const result = await registry.lookup({
      jurisdiction: "VN",
      licenseType: "online_game",
      licenseNumber: "123",
      operatorName: "Công ty An Toàn",
    });
    expect(result.status).toBe("verified");
    expect(result.sourceUrl).toBe("https://vbpl.vn/van-ban/trung-uong/nghi-dinh-72-2013-nd-cp");
  });

  it("reports not_found when the license number is missing", async () => {
    const registry = new InMemoryLicenseRegistry({ online_game: [] });
    const result = await registry.lookup({
      jurisdiction: "VN",
      licenseType: "online_game",
      licenseNumber: "999",
    });
    expect(result.status).toBe("not_found");
  });
});

describe("vbpl license registry", () => {
  it("falls back to unavailable when the vbpl gateway is unreachable", async () => {
    const registry = vbplLicenseRegistry({
      fetchImpl: (() => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    const result = await registry.lookup({
      jurisdiction: "VN",
      licenseType: "online_game",
    });
    expect(result.status).toBe("unavailable");
    expect(result.rationale).toMatch(/vbpl/i);
  });
});

describe("evaluator wires through the registry", () => {
  it("returns a pass for a verified registry match", async () => {
    const registry = new InMemoryLicenseRegistry({
      online_game: [{ licenseNumber: "123", subject: "Công ty An Toàn" }],
    });
    const result = await registry.lookup({
      jurisdiction: "VN",
      licenseType: "online_game",
      licenseNumber: "123",
      operatorName: "Công ty An Toàn",
    });
    const checks = evaluateLicenseRequirements({
      jurisdiction: "VN",
      category: "online_game",
      signals: [],
      licenseClaims: [
        {
          value: "Giấy phép 123",
          evidenceId: "license_claim::1",
          sourceUrl: "https://example.com/about",
        },
      ],
      registry: result,
      on: "2026-08-05",
    });
    expect(checks[0]).toMatchObject({ status: "required_verified", severity: "pass" });
  });

  it("ignores login signal alone but flags social network with UGC plus interaction", async () => {
    const social = await socialRegistry();
    const login = evaluateLicenseRequirements({
      jurisdiction: "VN",
      category: "digital_entertainment",
      signals: [signal("login")],
      licenseClaims: [],
      registry: social,
      on: "2026-08-05",
    });
    expect(login).toEqual([]);

    const socialChecks = evaluateLicenseRequirements({
      jurisdiction: "VN",
      category: "digital_entertainment",
      signals: [signal("ugc"), signal("comment")],
      licenseClaims: [],
      registry: social,
      on: "2026-08-05",
    });
    expect(socialChecks[0]?.licenseType).toBe("social_network");
  });
});
