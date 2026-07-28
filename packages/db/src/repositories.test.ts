import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { LegalRepository } from "./legal-repository";
import { ScanRepository } from "./scan-repository";

let mf: Miniflare;
let db: D1Database;

beforeEach(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
  });
  db = await mf.getD1Database("DB");
  const migration = await readFile(
    new URL("../migrations/0001_initial.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await db.prepare(statement).run();
  }
});

afterEach(async () => mf.dispose());

describe("D1 repositories", () => {
  it("keeps unapproved provisions out of retrieval", async () => {
    const legal = new LegalRepository(db);
    await legal.createDocument({
      id: "doc-1",
      sourceUrl: "https://vbpl.vn/doc-1",
      title: "Test law",
      retrievedAt: "2026-07-28T00:00:00.000Z",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      sourceHash: "hash-1",
    });
    await legal.addProvision({
      id: "provision-1",
      documentId: "doc-1",
      article: "1",
      clause: null,
      text: "Requirement",
      categories: ["online_game"],
    });
    expect(
      await legal.listRetrievable({
        jurisdiction: "VN",
        category: "online_game",
        on: "2026-07-28",
      }),
    ).toEqual([]);
    await legal.approve("doc-1", "admin@example.com", "source verified");
    expect(
      await legal.listRetrievable({
        jurisdiction: "VN",
        category: "online_game",
        on: "2026-07-28",
      }),
    ).toHaveLength(1);
  });

  it("creates and retrieves a versioned scan", async () => {
    const scans = new ScanRepository(db);
    await scans.create({
      id: "scan-1",
      url: "https://example.com",
      jurisdiction: "VN",
      category: "online_game",
      analysisVersion: "v1",
      now: "2026-07-28T00:00:00.000Z",
      expiresAt: "2026-08-04T00:00:00.000Z",
    });
    expect(await scans.get("scan-1")).toMatchObject({
      id: "scan-1",
      state: "queued",
      analysisVersion: "v1",
    });
  });
});
