import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { LegalRepository } from "./legal-repository";
import { ReportRepository, ScanRepository } from "./scan-repository";

let mf: Miniflare;
let db: D1Database;

beforeEach(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
  });
  db = await mf.getD1Database("DB");
  // Apply every migration in lexical order so schema changes
  // (e.g. 0003_reports_nullable_token_hash) are reflected in tests.
  const migrationsDir = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const raw = await readFile(new URL(file, migrationsDir), "utf8");
    // Strip line comments so the first ";"-delimited chunk in a file
    // that starts with a header comment does not become an empty
    // statement that SQLite rejects.
    const sql = raw
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    for (const statement of sql
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
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

    await scans.updateTerminal({
      id: "scan-1",
      state: "failed",
      coverage: { fetched: [], failed: ["homepage"], skipped: [] },
    });
    expect(await scans.get("scan-1")).toMatchObject({
      state: "failed",
      coverage: { fetched: [], failed: ["homepage"], skipped: [] },
    });
  });

  it("ReportRepository: upserts and looks up by token hash, then burns", async () => {
    // reports.scan_id has a FK to scans.id, so seed the scan first.
    const scans = new ScanRepository(db);
    await scans.create({
      id: "scan-9",
      url: "https://example.com",
      jurisdiction: "VN",
      category: "online_game",
      analysisVersion: "v1",
      now: "2026-07-28T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const reports = new ReportRepository(db);
    const tokenHash =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await reports.upsert({
      scanId: "scan-9",
      tokenHash,
      payloadJson: JSON.stringify({ scanId: "scan-9", status: "high_risk" }),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    // Lookup by token hash returns the report.
    const found = await reports.getByTokenHash(tokenHash);
    expect(found).not.toBeNull();
    expect(found?.scanId).toBe("scan-9");
    expect(found?.tokenHash).toBe(tokenHash);

    // Unknown hash returns null.
    const missing = await reports.getByTokenHash("0".repeat(64));
    expect(missing).toBeNull();

    // Burn the token: subsequent hash lookup must return null.
    await reports.burnToken("scan-9");
    const afterBurn = await reports.getByTokenHash(tokenHash);
    expect(afterBurn).toBeNull();

    // But the row still exists when looked up by scanId.
    const stillThere = await reports.get("scan-9");
    expect(stillThere).not.toBeNull();
    expect(stillThere?.tokenHash).toBeNull();
  });
});
