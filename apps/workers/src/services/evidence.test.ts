import { describe, expect, it } from "vitest";
import { extractEvidence, sanitizePageText, sanitizePageTextSafe } from "./evidence";

import onlineGameHtml from "../../../../tests/fixtures/sites/online-game/index.html?raw";
import electronicPressHtml from "../../../../tests/fixtures/sites/electronic-press/index.html?raw";
import digitalEntertainmentHtml from "../../../../tests/fixtures/sites/digital-entertainment/index.html?raw";
import promptInjectionHtml from "../../../../tests/fixtures/sites/prompt-injection/index.html?raw";
import emptyHtml from "../../../../tests/fixtures/sites/empty/index.html?raw";
import oversizedHtml from "../../../../tests/fixtures/sites/oversized/index.html?raw";
import dantriStyleHtml from "../../../../tests/fixtures/sites/dantri-style-footer/index.html?raw";

interface Fixture {
  sourceUrl: string;
  html: string;
}

const onlineGameFixture: Fixture = {
  sourceUrl: "https://game.test/about",
  html: onlineGameHtml,
};
const pressFixture: Fixture = {
  sourceUrl: "https://press.test/about",
  html: electronicPressHtml,
};
const entertainmentFixture: Fixture = {
  sourceUrl: "https://entertainment.test/about",
  html: digitalEntertainmentHtml,
};
const promptInjectionFixture: Fixture = {
  sourceUrl: "https://injection.test/help",
  html: promptInjectionHtml,
};
const emptyFixture: Fixture = {
  sourceUrl: "https://empty.test/",
  html: emptyHtml,
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

describe("sanitizePageText chunked path", () => {
  it("does not throw when html exceeds 800_000 characters; concatenates sanitized chunks", () => {
    // F1: a 1 MB payload (typical of large Vietnamese news sites) used to
    // throw SanitizationError and terminate phase-2. Now it must return a
    // non-empty string by sanitizing chunks independently and joining.
    const oversized = "<div>" + "x".repeat(1_000_000) + "</div>";
    expect(() => sanitizePageText(oversized)).not.toThrow();
    const out = sanitizePageText(oversized);
    expect(out.length).toBeGreaterThan(0);
    // No HTML tags should survive sanitization.
    expect(out).not.toMatch(/<[^>]+>/);
    // The repeating payload character must still be present after sanitization.
    expect(out.replace(/\s+/g, "")).toContain("x");
  });

  it("strips dangerous blocks independently inside each chunk", () => {
    // A <script> tag whose body crosses the 400K chunk boundary must still
    // be removed (defense-in-depth: prompt-injection / script execution
    // vectors cannot hide in mid-HTML by sitting across a chunk boundary).
    // Total payload must exceed 800K so chunked path is exercised.
    const padding = "<p>" + "y".repeat(850_000) + "</p>";
    const crossBoundaryScript = padding + "<script>alert('xss')</script>" + "z".repeat(10_000);
    const out = sanitizePageText(crossBoundaryScript);
    expect(out.toLowerCase()).not.toContain("alert('xss')");
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).toContain("y");
    expect(out).toContain("z");
  });

  it("returns truncated: true for oversized payloads via sanitizePageTextSafe", () => {
    const small = "<p>hello</p>";
    const large = "<div>" + "a".repeat(1_000_000) + "</div>";
    expect(sanitizePageTextSafe(small)).toEqual({ text: "hello", truncated: false });
    const r = sanitizePageTextSafe(large);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeGreaterThan(0);
  });
});


describe("evidence fixtures (real files)", () => {
  it("sanitizes the dantri-style footer fixture and still finds extractable signals", () => {
    // The fixture is a Vietnamese news site with a real footer. The
    // homepage must round-trip through sanitization without throwing,
    // and extractEvidence must produce at least one operator-identity
    // or contact signal from the body.
    const items = extractEvidence({ sourceUrl: "https://dantri.com.vn/", html: dantriStyleHtml });
    expect(items.length).toBeGreaterThan(0);
    // No HTML tags survive in any excerpt.
    for (const item of items) {
      expect(item.excerpt).not.toMatch(/<[^>]+>/);
    }
  });

  it("survives the 1.1 MB oversized fixture via the chunked path", () => {
    // 1.16 MB fixture — well over MAX_HTML_BYTES. Previously this
    // terminated the workflow at phase-2. With the chunked path it
    // returns a non-empty sanitized string with no <script> residue.
    expect(oversizedHtml.length).toBeGreaterThan(800_000);
    expect(() => sanitizePageText(oversizedHtml)).not.toThrow();
    const result = sanitizePageTextSafe(oversizedHtml);
    expect(result.truncated).toBe(true);
    expect(result.text.toLowerCase()).not.toContain("xss-payload");
    expect(result.text.toLowerCase()).not.toContain("<script");
  });
});

