import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/v1/health", (context) => context.json({ ok: true, service: "safelaunch-api" } as const));

app.onError((error, context) => {
  const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();
  console.error(JSON.stringify({ level: "error", requestId, errorName: error.name }));
  return context.json({ code: "INTERNAL_ERROR", requestId }, 500);
});

export default app;
