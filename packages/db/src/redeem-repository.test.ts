import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { RedeemRepository, DuplicateGrantError } from "./redeem-repository";

let mf: Miniflare;
let db: D1Database;

const migrations = async (): Promise<string[]> => {
  const dir = new URL("../migrations/", import.meta.url);
  const initial = await readFile(new URL("0001_initial.sql", dir), "utf8");
  const quota = await readFile(new URL("0002_daily_quota.sql", dir), "utf8");
  return [initial, quota];
};

// Split SQL into statements, ignoring semicolons inside line comments so
// "-- note; with semicolon" does not break the parser.
const splitStatements = (sql: string): string[] => {
  const stripped = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
};

beforeEach(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
  });
  db = await mf.getD1Database("DB");
  for (const sql of await migrations()) {
    for (const stmt of splitStatements(sql)) {
      await db.prepare(stmt).run();
    }
  }
});

afterEach(async () => await mf.dispose());

describe("RedeemRepository", () => {
  it("creates a code and looks it up by hash", async () => {
    const repo = new RedeemRepository(db);
    const code = await repo.createCode({
      id: "rc_1",
      codeHash: "abc123",
      label: "Pilot",
      createdBy: "reviewer@safelaunch.app",
      createdAt: "2026-08-03T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
    expect(code.codeHash).toBe("abc123");
    const found = await repo.findByHash("abc123");
    expect(found?.id).toBe("rc_1");
    expect(found?.label).toBe("Pilot");
  });

  it("returns null for unknown hash", async () => {
    const repo = new RedeemRepository(db);
    expect(await repo.findByHash("nope")).toBeNull();
  });

  it("soft-revokes a code", async () => {
    const repo = new RedeemRepository(db);
    await repo.createCode({
      id: "rc_2",
      codeHash: "h2",
      label: "l",
      createdBy: "a",
      createdAt: "2026-08-03T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
    await repo.softRevoke("rc_2", "2026-08-04T00:00:00.000Z");
    const found = await repo.findByHash("h2");
    expect(found?.revokedAt).toBe("2026-08-04T00:00:00.000Z");
  });

  it("applies a grant and rejects a duplicate (code, domain, day)", async () => {
    const repo = new RedeemRepository(db);
    await repo.createCode({
      id: "rc_3",
      codeHash: "h3",
      label: "l",
      createdBy: "a",
      createdAt: "2026-08-03T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
    const grant = await repo.applyGrant({
      id: "rg_1",
      codeId: "rc_3",
      domainKey: "example.com",
      quotaDay: "2026-08-03",
      grantedAt: "2026-08-03T10:00:00.000Z",
    });
    expect(grant.id).toBe("rg_1");
    await expect(
      repo.applyGrant({
        id: "rg_2",
        codeId: "rc_3",
        domainKey: "example.com",
        quotaDay: "2026-08-03",
        grantedAt: "2026-08-03T10:01:00.000Z",
      }),
    ).rejects.toBeInstanceOf(DuplicateGrantError);
  });

  it("allows the same code on a different domain the same day", async () => {
    const repo = new RedeemRepository(db);
    await repo.createCode({
      id: "rc_4",
      codeHash: "h4",
      label: "l",
      createdBy: "a",
      createdAt: "2026-08-03T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
    await repo.applyGrant({
      id: "rg_a",
      codeId: "rc_4",
      domainKey: "a.com",
      quotaDay: "2026-08-03",
      grantedAt: "2026-08-03T10:00:00.000Z",
    });
    await repo.applyGrant({
      id: "rg_b",
      codeId: "rc_4",
      domainKey: "b.com",
      quotaDay: "2026-08-03",
      grantedAt: "2026-08-03T10:01:00.000Z",
    });
    const grants = await repo.listGrantsForCode("rc_4");
    expect(grants.map((g) => g.domainKey).sort()).toEqual(["a.com", "b.com"]);
  });
});
