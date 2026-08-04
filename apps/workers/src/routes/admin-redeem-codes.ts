import { Hono } from "hono";
import { z } from "zod";
import { RedeemRepository } from "@safelaunch/db";
import { generateRedeemCode, hashRedeemCode } from "../services/redeem-codes";

const CreateBody = z.object({
  label: z.string().min(1).max(200),
  expiresAt: z.string().datetime(),
});

const ACTOR = (req: Request): string =>
  req.headers.get("cf-access-authenticated-user-email") ?? "local-dev-reviewer";

export const adminRedeemCodesRouter = new Hono<{ Bindings: { DB: D1Database } }>();

adminRedeemCodesRouter.post("/v1/admin/redeem-codes", async (context) => {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ code: "INVALID_JSON" }, 400);
  }
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return context.json({ code: "INVALID_INPUT", issues: parsed.error.issues }, 400);
  }
  const repo = new RedeemRepository(context.env.DB);
  const plaintext = generateRedeemCode();
  const codeHash = await hashRedeemCode(plaintext);
  const id = `rc_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const actor = ACTOR(context.req.raw);
  await repo.createCode({
    id,
    codeHash,
    label: parsed.data.label,
    createdBy: actor,
    createdAt: now,
    expiresAt: parsed.data.expiresAt,
  });
  console.log(
    JSON.stringify({
      level: "info",
      event: "redeem.code_created",
      codeId: id,
      codeHashPrefix: codeHash.slice(0, 8),
      actor,
      labelLength: parsed.data.label.length,
    }),
  );
  return context.json(
    {
      id,
      code: plaintext,
      codeHashPrefix: codeHash.slice(0, 8),
      label: parsed.data.label,
      expiresAt: parsed.data.expiresAt,
      createdAt: now,
      createdBy: actor,
    },
    200,
  );
});

adminRedeemCodesRouter.get("/v1/admin/redeem-codes", async (context) => {
  const repo = new RedeemRepository(context.env.DB);
  const codes = await repo.listCodes({ limit: 100, offset: 0 });
  return context.json(
    codes.map((c) => ({
      id: c.id,
      codeHashPrefix: c.codeHash.slice(0, 8),
      label: c.label,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      revokedAt: c.revokedAt,
    })),
  );
});

adminRedeemCodesRouter.delete("/v1/admin/redeem-codes/:id", async (context) => {
  const id = context.req.param("id");
  if (!id || id.length > 256) return context.json({ code: "INVALID_ID" }, 400);
  const repo = new RedeemRepository(context.env.DB);
  await repo.softRevoke(id, new Date().toISOString());
  return context.json({ ok: true, id, revokedAt: new Date().toISOString() });
});

adminRedeemCodesRouter.get("/v1/admin/redeem-codes/:id/grants", async (context) => {
  const id = context.req.param("id");
  if (!id || id.length > 256) return context.json({ code: "INVALID_ID" }, 400);
  const repo = new RedeemRepository(context.env.DB);
  const grants = await repo.listGrantsForCode(id);
  return context.json(grants);
});
