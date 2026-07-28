import { describe, expect, it } from "vitest";
import { CreateScanInput, Finding } from "./index";

describe("public contracts", () => {
  it("accepts only the enabled MVP jurisdiction and categories", () => {
    expect(
      CreateScanInput.parse({
        url: "https://example.com",
        jurisdiction: "VN",
        category: "online_game",
      }),
    ).toBeTruthy();
    expect(() =>
      CreateScanInput.parse({
        url: "https://example.com",
        jurisdiction: "US",
        category: "online_game",
      }),
    ).toThrow();
  });

  it("requires evidence and a citation for high risk", () => {
    expect(() =>
      Finding.parse({
        id: "f1",
        severity: "high",
        rationale: "risk",
        confidence: 0.95,
        evidenceIds: [],
        citations: [],
        recommendedAction: "review",
        applicability: "current",
      }),
    ).toThrow();
  });
});
