import { describe, expect, it } from "vitest";
import {
  type RetrievalDeps,
  type RetrievalQuery,
  type RetrievalResult,
  retrieveLegalContext,
} from "./retrieval";
import type { RetrievableProvision } from "@safelaunch/db";

interface FakeVectorMatch {
  id: string;
  score: number;
}

class FakeVectorIndex {
  constructor(
    private readonly ranking: readonly FakeVectorMatch[],
    public readonly calls: { vector: readonly number[]; options: unknown }[] = [],
  ) {}

  async query(
    vector: readonly number[],
    options: unknown,
  ): Promise<{
    matches: FakeVectorMatch[];
    count: number;
  }> {
    await Promise.resolve();
    this.calls.push({ vector: [...vector], options });
    return { matches: [...this.ranking], count: this.ranking.length };
  }
}

class FakeLegalRepository {
  constructor(public readonly provisions: readonly RetrievableProvision[]) {}

  async listRetrievable(input: {
    jurisdiction: string;
    category: string;
    on: string;
  }): Promise<readonly RetrievableProvision[]> {
    await Promise.resolve();
    return this.provisions.filter(
      (provision) =>
        provision.title.length > 0 &&
        input.jurisdiction === "VN" &&
        input.category === "online_game",
    );
  }
}

const provision = (overrides: Partial<RetrievableProvision>): RetrievableProvision => ({
  id: "p_default",
  documentId: "d_default",
  article: "Điều 1",
  clause: null,
  text: "Default provision text",
  categories: ["online_game"],
  sourceUrl: "https://vbpl.vn/default",
  title: "Default",
  retrievedAt: "2025-01-01T00:00:00.000Z",
  effectiveFrom: null,
  effectiveTo: null,
  ...overrides,
});

const makeDeps = (overrides: {
  vector: FakeVectorIndex;
  legal: FakeLegalRepository;
  embed?: (text: string) => Promise<number[]>;
  topK?: number;
  limit?: number;
}): RetrievalDeps => ({
  legal: overrides.legal,
  vector: overrides.vector,
  embed:
    overrides.embed ??
    (async (): Promise<number[]> => {
      await Promise.resolve();
      return [0.1, 0.2, 0.3];
    }),
  topK: overrides.topK ?? 12,
  limit: overrides.limit ?? 6,
});

const baseQuery: RetrievalQuery = {
  jurisdiction: "VN",
  category: "online_game",
  on: "2026-01-01T00:00:00.000Z",
  text: "quy định về giấy phép trò chơi điện tử",
};

describe("retrieveLegalContext", () => {
  it("excludes pending, expired, and wrong-category provisions before vector ranking", async () => {
    const eligible = [
      provision({ id: "approved-current", documentId: "d1", title: "Game publishing" }),
      provision({
        id: "approved-upcoming",
        documentId: "d2",
        title: "Game future",
        effectiveFrom: "2027-01-01T00:00:00.000Z",
        effectiveTo: null,
      }),
    ];
    const legal = new FakeLegalRepository(eligible);
    const vector = new FakeVectorIndex([
      { id: "approved-current", score: 0.95 },
      { id: "approved-upcoming", score: 0.9 },
      // These should already be filtered out by the metadata guard, so they
      // shouldn't appear in the index. We test the guard by verifying the
      // retrieval never produces them even if they slipped through.
      { id: "pending-doc", score: 0.99 },
      { id: "expired-doc", score: 0.97 },
      { id: "wrong-category", score: 0.96 },
    ]);
    const result = await retrieveLegalContext(baseQuery, makeDeps({ vector, legal }));
    expect(result.map((item: RetrievalResult) => item.provisionId).sort()).toEqual(
      ["approved-current", "approved-upcoming"].sort(),
    );
  });

  it("never returns more than six results per evidence topic", async () => {
    const eligible = Array.from({ length: 10 }, (_, index) =>
      provision({ id: `approved-${index}`, documentId: `d${index}` }),
    );
    const vector = new FakeVectorIndex(
      eligible.map((provision, index) => ({ id: provision.id, score: 1 - index / 100 })),
    );
    const result = await retrieveLegalContext(
      baseQuery,
      makeDeps({ vector, legal: new FakeLegalRepository(eligible) }),
    );
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it("returns metadata for every hit so the verifier can confirm provenance", async () => {
    const eligible = [
      provision({
        id: "approved-current",
        documentId: "d1",
        title: "Game publishing",
        sourceUrl: "https://vbpl.vn/abc",
        effectiveFrom: "2025-01-01T00:00:00.000Z",
        effectiveTo: "2030-01-01T00:00:00.000Z",
      }),
    ];
    const vector = new FakeVectorIndex([{ id: "approved-current", score: 0.85 }]);
    const result = await retrieveLegalContext(
      baseQuery,
      makeDeps({ vector, legal: new FakeLegalRepository(eligible) }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.documentId).toBe("d1");
    expect(result[0]?.source).toBe("https://vbpl.vn/abc");
    expect(result[0]?.effectiveFrom).toBe("2025-01-01T00:00:00.000Z");
    expect(result[0]?.effectiveTo).toBe("2030-01-01T00:00:00.000Z");
    expect(result[0]?.score).toBe(0.85);
  });

  it("passes the embedding through to the vector store", async () => {
    const eligible = [provision({ id: "approved-current" })];
    const vector = new FakeVectorIndex([{ id: "approved-current", score: 0.9 }]);
    const embed = async (): Promise<number[]> => {
      await Promise.resolve();
      return [0.4, 0.5, 0.6];
    };
    const deps: RetrievalDeps = makeDeps({
      vector,
      legal: new FakeLegalRepository(eligible),
      embed,
    });
    await retrieveLegalContext(baseQuery, deps);
    expect(vector.calls).toHaveLength(1);
    expect(vector.calls[0]?.vector).toEqual([0.4, 0.5, 0.6]);
    expect(vector.calls[0]?.options).toMatchObject({ topK: 12 });
  });

  it("never returns a hit whose id is not in the eligibility set", async () => {
    const eligible = [provision({ id: "approved-current" })];
    const vector = new FakeVectorIndex([
      { id: "approved-current", score: 0.9 },
      { id: "rogue-hit", score: 0.99 },
    ]);
    const result = await retrieveLegalContext(
      baseQuery,
      makeDeps({ vector, legal: new FakeLegalRepository(eligible) }),
    );
    expect(result.map((item) => item.provisionId)).toEqual(["approved-current"]);
  });

  it("returns an empty list when the metadata guard rejects every provision", async () => {
    const vector = new FakeVectorIndex([{ id: "approved-current", score: 0.95 }]);
    const result = await retrieveLegalContext(
      baseQuery,
      makeDeps({ vector, legal: new FakeLegalRepository([]) }),
    );
    expect(result).toEqual([]);
  });

  it("defaults to topK=12 and limit=6 when the caller omits them", async () => {
    const eligible = Array.from({ length: 8 }, (_, index) =>
      provision({ id: `approved-${index}` }),
    );
    const vector = new FakeVectorIndex(
      eligible.map((provision, index) => ({ id: provision.id, score: 0.9 - index * 0.01 })),
    );
    const deps: RetrievalDeps = {
      legal: new FakeLegalRepository(eligible),
      vector,
      embed: async (): Promise<number[]> => {
        await Promise.resolve();
        return [0.1, 0.2];
      },
      // No topK or limit — defaults are 12 and 6.
    };
    const result = await retrieveLegalContext(baseQuery, deps);
    expect(result).toHaveLength(6);
    expect(vector.calls[0]?.options).toMatchObject({ topK: 12 });
  });
});
