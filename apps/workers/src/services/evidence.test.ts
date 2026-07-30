import { describe, expect, it } from "vitest";
import { extractEvidence, sanitizePageText } from "./evidence";

import onlineGameHtml from "../../../../tests/fixtures/sites/online-game/index.html?raw";
import electronicPressHtml from "../../../../tests/fixtures/sites/electronic-press/index.html?raw";
import digitalEntertainmentHtml from "../../../../tests/fixtures/sites/digital-entertainment/index.html?raw";
import promptInjectionHtml from "../../../../tests/fixtures/sites/prompt-injection/index.html?raw";
import emptyHtml from "../../../../tests/fixtures/sites/empty/index.html?raw";

interface Fixture {
  sourceUrl: string;
  html: string;
}

const onlineGameFixture: Fixture = {
  sourceUrl: "https://game.test/about",
  html: onlineGameHtml as string,
};
const pressFixture: Fixture = {
  sourceUrl: "https://press.test/about",
  html: electronicPressHtml as string,
};
const entertainmentFixture: Fixture = {
  sourceUrl: "https://entertainment.test/about",
  html: digitalEntertainmentHtml as string,
};
const promptInjectionFixture: Fixture = {
  sourceUrl: "https://injection.test/help",
  html: promptInjectionHtml as string,
};
const emptyFixture: Fixture = {
  sourceUrl: "https://empty.test/",
  html: emptyHtml as string,
};

describe("extractEvidence", () => {
  it("preserves the exact source excerpt for operator identity on the Vietnamese game site", () => {
    const items = extractEvidence(onlineGameFixture);
    const operator = items.find((evidence) => evidence.type === "operator_identity");
    expect(operator).toBeDefined();
    expect(operator?.sourceUrl).toBe("https://game.test/about");
    expect(operator?.excerpt).toContain("Công ty");
    expect(operator?.excerpt).toEqual(expect.stringContaining("0306748546"));
  });

  it("captures the editorial email verbatim on the bilingual press site", () => {
    const items = extractEvidence(pressFixture);
    const emailContact = items.find(
      (evidence) =>
        evidence.type === "contact" && evidence.value.toLowerCase().includes("toasoan@dantri.test"),
    );
    expect(emailContact).toBeDefined();
    expect(emailContact?.sourceUrl).toBe("https://press.test/about");
    expect(emailContact?.excerpt.toLowerCase()).toContain("toasoan@dantri.test");
  });

  it("extracts a payment signal from the English entertainment site", () => {
    const items = extractEvidence(entertainmentFixture);
    const payment = items.find(
      (evidence) =>
        evidence.type === "payment" &&
        /stripe|visa|mastercard|master\s*card|apple\s+pay/i.test(evidence.excerpt),
    );
    expect(payment).toBeDefined();
    expect(payment?.sourceUrl).toBe("https://entertainment.test/about");
    expect(payment?.excerpt).toMatch(/stripe|visa|mastercard|master\s*card|apple\s+pay/i);
  });

  it("treats adversarial system instructions as untrusted content rather than instructions", () => {
    const items = extractEvidence(promptInjectionFixture);
    expect(items).not.toContainEqual(expect.objectContaining({ value: "ignore system" }));
    expect(items).not.toContainEqual(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ value: expect.stringContaining("sendMoney") }),
    );
    expect(items.some((evidence) => /SYSTEM/i.test(evidence.value))).toBe(false);
  });

  it("returns an empty evidence list when the page contains no extractable signals", () => {
    const items = extractEvidence(emptyFixture);
    expect(items).toEqual([]);
  });

  it("always returns a non-empty excerpt that is contained in the sanitized page text", () => {
    const fixtures = [onlineGameFixture, pressFixture, entertainmentFixture];
    for (const fixture of fixtures) {
      const sanitized = sanitizePageText(fixture.html);
      const items = extractEvidence(fixture);
      for (const evidence of items) {
        expect(evidence.excerpt.length).toBeGreaterThan(0);
        expect(sanitized).toContain(evidence.excerpt);
      }
    }
  });

  it("clamps confidence into the 0..1 range and tags bilingual pages", () => {
    const items = extractEvidence(onlineGameFixture);
    for (const evidence of items) {
      expect(evidence.confidence).toBeGreaterThanOrEqual(0);
      expect(evidence.confidence).toBeLessThanOrEqual(1);
    }
    const ugc = items.find((evidence) => evidence.type === "ugc");
    expect(ugc).toBeDefined();
  });
});
