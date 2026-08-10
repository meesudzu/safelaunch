// Unit tests for scripts/lib/embed-corpus-lib.mjs.
//
// Run from the repo root:  pnpm exec vitest run scripts/lib
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  PROVISION_PATTERN,
  buildBatchRequest,
  buildEmbeddingUrl,
  buildVectorIdUpdateSql,
  buildVectorizeRecords,
  parseBatchResponse,
  parseProvisions,
} from "./embed-corpus-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedSql = readFileSync(path.resolve(__dirname, "..", "seed-legal-corpus.sql"), "utf8");

describe("parseProvisions", () => {
  it("extracts all 12 provisions from the seed SQL file", () => {
    const provisions = parseProvisions(seedSql);
    expect(provisions).toHaveLength(12);
  });

  it("captures the provision id as the first match group", () => {
    const provisions = parseProvisions(seedSql);
    expect(provisions.map((p) => p.id)).toEqual([
      "vn-pd-2025-privacy-notice",
      "prov-pd13-art14",
      "prov-pd13-art20",
      "vn-pd-2025-operator-identity",
      "prov-pd72-art5",
      "prov-pd72-art6",
      "vn-pd-2025-contact-channel",
      "prov-law-attm-art18",
      "prov-law-attm-art19",
      "vn-pd-72-2013-game-license",
      "prov-pd72-art22",
      "prov-pd72-art23",
    ]);
  });

  it("parses the categories JSON string into an array", () => {
    const provisions = parseProvisions(seedSql);
    expect(provisions[0].categories).toEqual([
      "online_game",
      "electronic_press",
      "digital_entertainment",
    ]);
    // R-OPID-1 is online_game-only.
    expect(provisions[3].categories).toEqual(["online_game"]);
  });

  it("captures the Vietnamese provision text", () => {
    const provisions = parseProvisions(seedSql);
    expect(provisions[0].text).toContain("Tổ chức, cá nhân xử lý dữ liệu cá nhân");
  });

  it("returns an empty array for input that has no provision tuples", () => {
    expect(parseProvisions("-- nothing to see here\n")).toEqual([]);
  });

  it("exposes PROVISION_PATTERN as a stable exported constant", () => {
    // Other tooling (lint rules, debug scripts) can import the pattern
    // without going through parseProvisions — keep it accessible.
    expect(PROVISION_PATTERN).toBeInstanceOf(RegExp);
    expect(PROVISION_PATTERN.flags).toContain("g");
  });
});

describe("buildBatchRequest", () => {
  it("wraps the input texts in the Workers AI batch shape", () => {
    expect(buildBatchRequest(["a", "b", "c"])).toEqual({ text: ["a", "b", "c"] });
  });

  it("produces an empty batch for an empty input array", () => {
    expect(buildBatchRequest([])).toEqual({ text: [] });
  });
});

describe("parseBatchResponse", () => {
  it("returns the vectors in order when the API reports success", () => {
    const body = {
      success: true,
      result: {
        data: [
          [0.1, 0.2],
          [0.3, 0.4],
          [0.5, 0.6],
        ],
      },
    };
    expect(parseBatchResponse(body, 3)).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.6],
    ]);
  });

  it("throws on a Workers AI error response (success: false)", () => {
    const body = { success: false, errors: [{ code: 1001, message: "bad" }] };
    expect(() => parseBatchResponse(body, 1)).toThrow(/Workers AI embedding failed/);
  });

  it("throws when the result has no vectors at all", () => {
    expect(() => parseBatchResponse({ success: true, result: { data: [] } }, 1)).toThrow(
      /empty embedding vector/,
    );
  });

  it("throws when fewer vectors are returned than requested", () => {
    const body = { success: true, result: { data: [[0.1]] } };
    expect(() => parseBatchResponse(body, 3)).toThrow(/returned 1 vectors but 3 were expected/);
  });

  it("silently truncates when MORE vectors are returned than requested", () => {
    // Workers AI can theoretically return extras if the input was longer
    // than what we asked to count. We only need the first N.
    const body = {
      success: true,
      result: { data: [[0.1], [0.2], [0.3], [0.4]] },
    };
    expect(parseBatchResponse(body, 3)).toEqual([[0.1], [0.2], [0.3]]);
  });
});

describe("buildVectorizeRecords", () => {
  it("zips provisions with vectors in order and wraps in the Vectorize shape", () => {
    const provisions = [
      { id: "p1", text: "x", categories: ["online_game"] },
      { id: "p2", text: "y", categories: ["electronic_press"] },
    ];
    const vectors = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];
    expect(buildVectorizeRecords(provisions, vectors)).toEqual([
      { id: "p1", values: [0.1, 0.2], metadata: { categories: ["online_game"] } },
      { id: "p2", values: [0.3, 0.4], metadata: { categories: ["electronic_press"] } },
    ]);
  });

  it("throws if the two arrays have different lengths", () => {
    expect(() =>
      buildVectorizeRecords([{ id: "p1", text: "x", categories: [] }], [[0.1], [0.2]]),
    ).toThrow(/1 provisions vs 2 vectors/);
  });
});

describe("buildVectorIdUpdateSql", () => {
  it("produces a single UPDATE with a CASE expression covering all ids", () => {
    const sql = buildVectorIdUpdateSql(["p1", "p2"]);
    expect(sql).toMatch(/^UPDATE legal_provisions/);
    expect(sql).toMatch(/WHEN id = 'p1' THEN 'p1'/);
    expect(sql).toMatch(/WHEN id = 'p2' THEN 'p2'/);
    expect(sql).toMatch(/WHERE id IN \('p1', 'p2'\)/);
  });

  it("preserves vector_id for ids not in the batch via the ELSE branch", () => {
    const sql = buildVectorIdUpdateSql(["p1"]);
    expect(sql).toMatch(/ELSE vector_id/);
  });

  it("escapes single quotes in provision ids defensively", () => {
    const sql = buildVectorIdUpdateSql(["a'b"]);
    expect(sql).toMatch(/WHEN id = 'a''b' THEN 'a''b'/);
  });

  it("returns null for an empty id list (caller can skip the D1 round-trip)", () => {
    expect(buildVectorIdUpdateSql([])).toBeNull();
  });
});

describe("buildEmbeddingUrl", () => {
  it("builds the Cloudflare AI Gateway URL with the default gateway id", () => {
    expect(buildEmbeddingUrl({ accountId: "acc-123" })).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc-123/default/workers-ai/@cf/baai/bge-base-en-v1.5",
    );
  });

  it("honours a custom gateway id (for staging / per-feature gateways)", () => {
    expect(buildEmbeddingUrl({ accountId: "acc-123", gatewayId: "safelaunch-embed" })).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc-123/safelaunch-embed/workers-ai/@cf/baai/bge-base-en-v1.5",
    );
  });

  it("uses the bge-base-en-v1.5 model by default — must match the Vectorize index dimensions", () => {
    const url = buildEmbeddingUrl({ accountId: "x" });
    expect(url).toContain("@cf/baai/bge-base-en-v1.5");
  });
});
