import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowSource = readFileSync(
  resolve(import.meta.dirname, "../src/workflows/scan-workflow.ts"),
  "utf8",
);

const expectedSteps = [
  "parse-params",
  "publish:fetching",
  "fetch:homepage",
  "discover:page-urls",
  "fetch:about",
  "fetch:privacy",
  "fetch:contact",
  "fetch:terms",
  "publish:extracting",
  "phase-2:extract-evidence",
  "phase-3:extract-signals",
  "phase-4:scan-assets-references",
  "phase-5:classify-asset-rights",
  "publish:evaluating",
  "phase-6:evaluate-license",
  "publish:retrieving",
  "phase-7:evaluate-rules",
  "phase-8:aggregate",
  "publish:reporting",
  "phase-9:persist-report",
  "phase-10:persist-terminal",
];

const missing = [];
for (const step of expectedSteps) {
  const escaped = step.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  // Match either `step.do("name"` (direct step.do call) or
  // `runStepWithFallback({ ... name: "name" ...` (the fallback wrapper
  // used for steps that need best-effort retry behaviour).
  const directRe = new RegExp("step\\.do(?:<[^>]+>)?\\(\\s*['\"]" + escaped + "['\"]");
  const fallbackRe = new RegExp(
    "runStepWithFallback\\s*\\(\\s*\\{[^{}]*name\\s*:\\s*['\"]" + escaped + "['\"]",
  );
  if (!directRe.test(workflowSource) && !fallbackRe.test(workflowSource)) {
    missing.push(step);
  }
}
if (missing.length) {
  console.error("Missing workflow steps:", missing.join(", "));
  process.exit(1);
}
console.log("OK: all", expectedSteps.length, "workflow steps are present in the source");
