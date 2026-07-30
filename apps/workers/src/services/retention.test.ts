import { describe, expect, it, vi } from "vitest";
import { purgeExpired, type RetentionDeps } from "./retention";

class FakeD1 {
  execCalls: string[] = [];
  bindCalls: Array<{ sql: string; bindings: unknown[] }> = [];
  prepared: Map<string, { firstReturn: unknown; allReturn: unknown[] }> = new Map();

  constructor(rows: Array<{ sql: string; firstReturn: unknown; allReturn: unknown[] }> = []) {
    for (const row of rows) {
      this.prepared.set(row.sql, { firstReturn: row.firstReturn, allReturn: row.allReturn });
    }
  }

  prepare(sql: string) {
    const stmt = {
      bind: (...bindings: unknown[]) => {
        this.bindCalls.push({ sql, bindings });
        const row = this.prepared.get(sql) ?? { firstReturn: null, allReturn: [] };
        return {
          first: async <T>(): Promise<T | null> => {
            await Promise.resolve();
            return row.firstReturn as T | null;
          },
          all: async <T>(): Promise<{ results: readonly T[]; success: boolean; meta: unknown }> => {
            await Promise.resolve();
            return { results: row.allReturn as readonly T[], success: true, meta: {} };
          },
          run: async (): Promise<D1Result> => {
            await Promise.resolve();
            return {
              success: true,
              meta: {
                duration: 0,
                changes: 1,
                last_row_id: 0,
                size_after: 0,
                rows_read: 0,
                rows_written: 0,
                changed_db: true,
              },
            };
          },
        };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  }

  exec(_sql: string): Promise<D1ExecResult> {
    this.execCalls.push(_sql);
    return Promise.resolve({ count: 0, duration: 0 });
  }
  async batch<T>(_statements: readonly D1PreparedStatement[]): Promise<T[]> {
    await Promise.resolve();
    void _statements;
    return [];
  }
  async dump(): Promise<ArrayBuffer> {
    await Promise.resolve();
    return new ArrayBuffer(0);
  }
  withSession(): D1DatabaseSession {
    return {} as D1DatabaseSession;
  }
}

class FakeR2 {
  deleted: string[] = [];
  listResult: { objects: Array<{ key: string }> } = { objects: [] };

  async list(options?: { prefix?: string }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }> {
    const filtered = this.listResult.objects.filter(
      (obj) =>
        !this.deleted.includes(obj.key) &&
        (!options?.prefix || obj.key.startsWith(options.prefix)),
    );
    return Promise.resolve({ objects: filtered, truncated: false });
  }
  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    return Promise.resolve();
  }
}

const makeDeps = (overrides: Partial<RetentionDeps> = {}): {
  deps: RetentionDeps;
  db: FakeD1;
  r2: FakeR2;
  log: ReturnType<typeof vi.fn>;
} => {
  const db = new FakeD1();
  const r2 = new FakeR2();
  const log = vi.fn();
  return {
    deps: {
      db,
      r2: r2 as R2Bucket,
      now: () => "2026-07-29T12:00:00.000Z",
      log: log as RetentionDeps["log"],
      ...overrides,
    },
    db,
    r2,
    log,
  };
};

describe("purgeExpired", () => {
  it("deletes scans whose expires_at is in the past", async () => {
    const { deps, db } = makeDeps();
    const summary = await purgeExpired("2026-07-29T12:00:00.000Z", deps);
    expect(summary.scansDeleted).toBeGreaterThan(0);
    expect(
      db.bindCalls.some(
        (c) =>
          c.sql.toLowerCase().includes("delete from scans") &&
          c.bindings[0] === "2026-07-29T12:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("deletes reports and their R2 artifacts past expiry", async () => {
    const { deps, r2 } = makeDeps();
    r2.listResult = {
      objects: [
        { key: "scans/expired/home.html" },
        { key: "scans/expired/contact.html" },
      ],
    };
    const summary = await purgeExpired("2026-07-29T12:00:00.000Z", deps);
    expect(summary.r2ObjectsDeleted).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect(r2.deleted.toSorted()).toEqual([
      "scans/expired/contact.html",
      "scans/expired/home.html",
    ]);
  });

  it("emits a structured log event with the deletion counts but no PII", async () => {
    const { deps, log } = makeDeps();
    await purgeExpired("2026-07-29T12:00:00.000Z", deps);
    expect(log).toHaveBeenCalled();
    const event = (log.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(event).toMatchObject({
      event: "retention.purge",
    });
    expect(event.path).toBeUndefined();
    expect(event.url).toBeUndefined();
    expect(event.token).toBeUndefined();
    expect(event.scanId).toBeUndefined();
  });

  it("is idempotent — a second call deletes zero new artifacts", async () => {
    const { deps, r2 } = makeDeps();
    r2.listResult = { objects: [{ key: "scans/expired/home.html" }] };
    const first = await purgeExpired("2026-07-29T12:00:00.000Z", deps);
    r2.listResult = { objects: [] };
    const second = await purgeExpired("2026-07-29T12:00:01.000Z", deps);
    expect(first.r2ObjectsDeleted).toBe(1);
    expect(second.r2ObjectsDeleted).toBe(0);
  });
});
