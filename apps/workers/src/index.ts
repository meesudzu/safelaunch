import { Hono } from "hono";
import { scansRouter } from "./routes/scans";
import { reportsRouter } from "./routes/reports";
import { adminRouter } from "./routes/admin";
import { ScanWorkflowEntrypoint } from "./workflows/scan-workflow";
import { AbuseRateLimiter } from "./services/abuse-rate-limiter-do";

export type Env = {
  DB: D1Database;
  AI?: Ai;
  LEGAL_INGESTION_QUEUE?: Queue;
  LEGAL_INDEX?: VectorizeIndex;
  ARTIFACTS?: R2Bucket;
  WEB_ORIGIN?: string;
  SCAN_WORKFLOW?: Workflow;
  ABUSE_RATE_LIMITER?: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/v1/health", (context) => context.json({ ok: true, service: "safelaunch-api" } as const));

app.route("/", scansRouter);
app.route("/", reportsRouter);
app.route("/v1/admin", adminRouter);

app.onError((error, context) => {
  const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();
  console.error(JSON.stringify({ level: "error", requestId, errorName: error.name }));
  return context.json({ code: "INTERNAL_ERROR", requestId }, 500);
});

export default app;
export { ScanWorkflowEntrypoint, AbuseRateLimiter };
