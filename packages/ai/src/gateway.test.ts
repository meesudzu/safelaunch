import { describe, expect, it } from "vitest";
import { DEFAULT_GATEWAY_ID, gatewayOptionsFor } from "./gateway";

describe("gatewayOptionsFor", () => {
  it("uses Cloudflare's reserved default gateway id", () => {
    expect(DEFAULT_GATEWAY_ID).toBe("default");
  });

  it("passes through a configured gateway id", () => {
    expect(gatewayOptionsFor({ id: "safelaunch-legal" })).toEqual({
      gateway: { id: "safelaunch-legal" },
    });
  });
});
