#!/usr/bin/env node
/**
 * scripts/build-font-registry.mjs
 *
 * Regenerate apps/workers/src/data/font-registry.json from authoritative
 * sources. Intended to be run locally + in CI to refresh the snapshot.
 *
 * Sources:
 *   - Google Fonts METADATA.pb (textproto) under
 *     https://github.com/google/fonts/tree/main/ofl/
 *   - SIL Open Font License official text (https://openfontlicense.org).
 *
 * The resulting JSON is loaded at runtime via dynamic `import` so the
 * snapshot is bundled into the Worker — no runtime HTTP fetches.
 *
 * Usage:  pnpm -F @safelaunch/workers run build:font-registry
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../apps/workers/src/data/font-registry.json");

const SNAPSHOT_COMMIT = "main@2026-08-01";
const SNAPSHOT_RETRIEVED_AT = "2026-08-06T00:00:00.000Z";
const REGISTRY_VERSION = `google-fonts-manual-snapshot-2026-08-06`;

// Hand-curated subset. Real builds would walk the full Google Fonts tree
// (tree API + textproto METADATA.pb), but V1 keeps the registry small and
// auditable. Each entry MUST include a `sourceUrl` and `retrievedAt` so
// downstream consumers can re-verify provenance.
const FAMILIES = [
  "roboto",
  "inter",
  "sourceserif4",
  "jetbrainsmono",
  "notosans",
];

const FONT_NAMES = {
  roboto: "Roboto",
  inter: "Inter",
  sourceserif4: "Source Serif 4",
  jetbrainsmono: "JetBrains Mono",
  notosans: "Noto Sans",
};

const COMMERCIAL_NAME_HINTS = [
  { family: "Arial", note: "Commonly known commercial font (Monotype)", sourceUrl: "https://en.wikipedia.org/wiki/Arial" },
  { family: "Helvetica", note: "Commonly known commercial font (Monotype)", sourceUrl: "https://en.wikipedia.org/wiki/Helvetica" },
  { family: "Times New Roman", note: "Commonly known commercial font (Monotype)", sourceUrl: "https://en.wikipedia.org/wiki/Times_New_Roman" },
];

// Minimal textproto reader: returns the first `key: "value"` pair found.
// We only need name, version, license, copyright, fonts { name post_script_name }.
const readField = (text, key) => {
  const re = new RegExp(`${key}\\s*:\\s*"(.*?)"`, "i");
  const m = text.match(re);
  return m ? m[1] : null;
};

const readFontBlocks = (text) => {
  const blocks = [];
  const re = /fonts\\s*\\{[\\s\\S]*?\\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push(m[0]);
  }
  return blocks;
};

async function loadFamily(slug) {
  const url = `https://raw.githubusercontent.com/google/fonts/${SNAPSHOT_COMMIT}/ofl/${slug}/METADATA.pb`;
  const res = await fetch(url, { headers: { "user-agent": "SafeBuildFontRegistry/1.0" } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  const text = await res.text();
  const name = readField(text, "name") ?? FONT_NAMES[slug];
  const license = readField(text, "license") ?? "OFL";
  const version = readField(text, "version") ?? "unknown";
  const copyright = readField(text, "copyright") ?? null;
  const sourceUrl = url;
  const licenseUrl = "https://openfontlicense.org";
  const blocks = readFontBlocks(text);
  const variants = [];
  for (const block of blocks) {
    const variantName = readField(block, "name");
    const postScriptName = readField(block, "post_script_name");
    if (!postScriptName) continue;
    variants.push({
      family: name,
      postscriptName: postScriptName,
      weight: Number((readField(block, "weight") ?? "400").replace(/[^0-9]/g, "")) || 400,
      style: readField(block, "style") ?? "normal",
      license,
      licenseUrl,
      version,
      copyright,
      sourceUrl,
      sha256: null,
    });
  }
  return variants;
}

async function main() {
  const all = [];
  for (const slug of FAMILIES) {
    try {
      const variants = await loadFamily(slug);
      all.push(...variants);
    } catch (cause) {
      console.error(`! skipping ${slug}:`, cause.message);
    }
  }
  all.sort((a, b) =>
    a.family.localeCompare(b.family) ||
    a.postscriptName.localeCompare(b.postscriptName),
  );
  const out = {
    registryVersion: REGISTRY_VERSION,
    fetchedAt: SNAPSHOT_RETRIEVED_AT,
    sourceCommit: SNAPSHOT_COMMIT,
    fonts: all,
    commercialNameHints: COMMERCIAL_NAME_HINTS,
    registryCitation: {
      provisionId: "google-fonts-snapshot-2026-08",
      source: "Google Fonts OFL snapshot",
      url: "https://github.com/google/fonts/tree/main/ofl",
      retrievedAt: SNAPSHOT_RETRIEVED_AT,
      excerpt:
        "Open-source fonts published by Google Fonts under SIL Open Font License 1.1. The registry exposes a PostScript-name and version index, never a copyrighted binary.",
    },
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${OUT_PATH} (${all.length} variants)`);
}

main().catch((cause) => {
  console.error("build-font-registry failed:", cause);
  process.exit(1);
});
