import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "./index";

it("returns build metadata without leaking bindings", async () => {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request("http://local/v1/health"), env, context);
  await waitOnExecutionContext(context);

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, service: "safelaunch-api" });
});
