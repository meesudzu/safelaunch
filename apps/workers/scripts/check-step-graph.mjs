import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowSource = readFileSync(
  resolve(import.meta.dirname, "../src/workflows/scan-workflow.ts"),
  "utf8",
);

const expectedSteps = [
  "parse-params",
  "fetch:homepage",
  "fetch:about",
  "fetch:privacy",
  "fetch:contact",
  "fetch:terms",
  "phase-2:extract-evidence",
  "phase-3:extract-signals",
  "phase-4:scan-assets-references",
  "phase-5:classify-asset-rights",
  "phase-6:evaluate-license",
  "phase-7:evaluate-rules",
  "phase-8:aggregate",
  "phase-9:persist-report",
  "phase-10:persist-terminal",
];

const missing = [];
for (const step of expectedSteps) {
  const escaped = step.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp("step\\.do(?:<[^>]+>)?\\(\\s*['\"]" + escaped + "['\"]");
  if (!re.test(workflowSource)) {
    missing.push(step);
  }
}
if (missing.length) {
  console.error("Missing workflow steps:", missing.join(", "));
  process.exit(1);
}
console.log("OK: all", expectedSteps.length, "workflow steps are present in the source");
