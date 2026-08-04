export class DuplicateGrantError extends Error {
  constructor(
    public readonly codeId: string,
    public readonly domainKey: string,
    public readonly quotaDay: string,
  ) {
    super(`duplicate grant for code=${codeId} domain=${domainKey} day=${quotaDay}`);
    this.name = "DuplicateGrantError";
  }
}

export interface NewRedeemCode {
  id: string;
  codeHash: string;
  label: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

export interface StoredRedeemCode {
  id: string;
  codeHash: string;
  label: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface NewRedeemGrant {
  id: string;
  codeId: string;
  domainKey: string;
  quotaDay: string;
  grantedAt: string;
}

export type StoredRedeemGrant = NewRedeemGrant;

interface RedeemCodeRow {
  id: string;
  code_hash: string;
  label: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

interface RedeemGrantRow {
  id: string;
  code_id: string;
  domain_key: string;
  quota_day: string;
  granted_at: string;
}

const toCode = (r: RedeemCodeRow): StoredRedeemCode => ({
  id: r.id,
  codeHash: r.code_hash,
  label: r.label,
  createdBy: r.created_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});

const toGrant = (r: RedeemGrantRow): StoredRedeemGrant => ({
  id: r.id,
  codeId: r.code_id,
  domainKey: r.domain_key,
  quotaDay: r.quota_day,
  grantedAt: r.granted_at,
});

export class RedeemRepository {
  constructor(private readonly db: D1Database) {}

  async createCode(input: NewRedeemCode): Promise<StoredRedeemCode> {
    await this.db
      .prepare(
        "INSERT INTO redeem_codes (id, code_hash, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(input.id, input.codeHash, input.label, input.createdBy, input.createdAt, input.expiresAt)
      .run();
    return { ...input, revokedAt: null };
  }

  async findByHash(codeHash: string): Promise<StoredRedeemCode | null> {
    const row = await this.db
      .prepare("SELECT * FROM redeem_codes WHERE code_hash = ?")
      .bind(codeHash)
      .first<RedeemCodeRow>();
    return row ? toCode(row) : null;
  }

  async findById(id: string): Promise<StoredRedeemCode | null> {
    const row = await this.db
      .prepare("SELECT * FROM redeem_codes WHERE id = ?")
      .bind(id)
      .first<RedeemCodeRow>();
    return row ? toCode(row) : null;
  }

  async softRevoke(id: string, revokedAt: string): Promise<void> {
    await this.db
      .prepare("UPDATE redeem_codes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(revokedAt, id)
      .run();
  }

  async listCodes(opts: { limit?: number; offset?: number } = {}): Promise<StoredRedeemCode[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const result = await this.db
      .prepare("SELECT * FROM redeem_codes ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .bind(limit, offset)
      .all<RedeemCodeRow>();
    return (result.results ?? []).map(toCode);
  }

  async applyGrant(input: NewRedeemGrant): Promise<StoredRedeemGrant> {
    try {
      await this.db
        .prepare(
          "INSERT INTO redeem_grants (id, code_id, domain_key, quota_day, granted_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(input.id, input.codeId, input.domainKey, input.quotaDay, input.grantedAt)
        .run();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("UNIQUE") && message.includes("code_id")) {
        throw new DuplicateGrantError(input.codeId, input.domainKey, input.quotaDay);
      }
      throw cause;
    }
    return { ...input };
  }

  async listGrantsForCode(codeId: string): Promise<StoredRedeemGrant[]> {
    const result = await this.db
      .prepare("SELECT * FROM redeem_grants WHERE code_id = ? ORDER BY granted_at DESC")
      .bind(codeId)
      .all<RedeemGrantRow>();
    return (result.results ?? []).map(toGrant);
  }
}
