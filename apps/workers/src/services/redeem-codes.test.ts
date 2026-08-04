import { describe, expect, it } from "vitest";
import {
  generateRedeemCode,
  hashRedeemCode,
  REDEEM_CODE_PATTERN,
  isValidRedeemCodeShape,
} from "./redeem-codes";

describe("redeem code generator", () => {
  it("matches the SL-XXXX-XXXX pattern", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRedeemCode();
      expect(code).toMatch(REDEEM_CODE_PATTERN);
    }
  });

  it("never produces ambiguous chars in the payload (0/O/1/I/L)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRedeemCode();
      // Strip the "SL-" prefix before checking (the prefix itself contains an L).
      const payload = code.slice(3);
      expect(payload).not.toMatch(/[OIL01]/);
      // Also: the prefix itself is SL- (always includes an L). The pattern
      // is enforced by REDEEM_CODE_PATTERN; the body must be safe.
      expect(code).toMatch(REDEEM_CODE_PATTERN);
    }
  });

  it("isValidRedeemCodeShape accepts valid codes and rejects malformed", () => {
    expect(isValidRedeemCodeShape("SL-A2K9-7X4P")).toBe(true);
    expect(isValidRedeemCodeShape("  SL-A2K9-7X4P  ")).toBe(true); // trimmed
    expect(isValidRedeemCodeShape("SL-A2K9-7X4")).toBe(false); // missing last block
    expect(isValidRedeemCodeShape("XX-A2K9-7X4P")).toBe(false); // wrong prefix
    expect(isValidRedeemCodeShape("sl-a2k9-7x4p")).toBe(false); // lowercase
    expect(isValidRedeemCodeShape("SL-A209-7X4P")).toBe(false); // forbidden 0
    expect(isValidRedeemCodeShape("SL-A2I9-7X4P")).toBe(false); // forbidden I
  });

  it("hash is deterministic and 64 hex chars", async () => {
    const h = await hashRedeemCode("SL-A2K9-7X4P");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(await hashRedeemCode("SL-A2K9-7X4P"));
  });

  it("hash differs for different inputs", async () => {
    const a = await hashRedeemCode("SL-A2K9-7X4P");
    const b = await hashRedeemCode("SL-A2K9-7X4Q");
    expect(a).not.toBe(b);
  });
});
