import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { ApplicationOwner, ApplicationRecords } from './records.ts';

export const AGENT_SCOPES = ['replays:read', 'conversations:read', 'conversations:write'] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];
export const MAX_CREDENTIAL_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

export interface AgentCredential {
  id: string;
  name: string;
  scopes: AgentScope[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export class AgentCredentials {
  readonly records: ApplicationRecords;
  constructor(records: ApplicationRecords) {
    this.records = records;
  }

  async create(owner: ApplicationOwner, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Expected a credential object');
    const { name, scopes, expiresInSeconds } = input as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) fail(400, 'Credential name must contain 1 to 100 characters');
    if (
      !Array.isArray(scopes) ||
      !scopes.length ||
      scopes.length > AGENT_SCOPES.length ||
      scopes.some((scope) => !AGENT_SCOPES.includes(scope))
    )
      fail(400, 'Choose supported credential scopes');
    if (new Set(scopes).size !== scopes.length) fail(400, 'Duplicate credential scopes');
    if (
      !Number.isSafeInteger(expiresInSeconds) ||
      Number(expiresInSeconds) < 60 ||
      Number(expiresInSeconds) > MAX_CREDENTIAL_LIFETIME_SECONDS
    )
      fail(400, 'Credential expiry must be between 60 seconds and 30 days');
    // A transaction-scoped owner lock bounds outstanding credentials even under concurrent creation.
    if (!this.records.db.transaction) throw new Error('Credential creation requires PostgreSQL transactions');
    const secret = `rpl_${randomBytes(32).toString('base64url')}`;
    const credential: AgentCredential = {
      id: randomUUID(),
      name: (name as string).trim(),
      scopes: scopes as AgentScope[],
      createdAt: Date.now(),
      expiresAt: Date.now() + Number(expiresInSeconds) * 1000,
      revokedAt: null,
    };
    await this.records.db.transaction(async (tx) => {
      await tx.execute({
        sql: 'SELECT pg_advisory_xact_lock(hashtextextended(?, 0))',
        args: [JSON.stringify([owner.workspaceId, owner.userId])],
      });
      const count = await tx.execute({
        sql: 'SELECT count(*) AS count FROM replays_agent_credentials WHERE workspace_id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?',
        args: [owner.workspaceId, owner.userId, Date.now()],
      });
      if (Number(count.rows[0]?.count) >= 20) fail(409, 'Revoke an existing credential before creating another');
      await tx.execute({
        sql: 'INSERT INTO replays_agent_credentials(id, workspace_id, user_id, name, secret_hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
          credential.id,
          owner.workspaceId,
          owner.userId,
          credential.name,
          hash(secret),
          JSON.stringify(scopes),
          credential.createdAt,
          credential.expiresAt,
        ],
      });
    });
    return { credential, secret };
  }

  async list(owner: ApplicationOwner): Promise<AgentCredential[]> {
    const result = await this.records.db.execute({
      sql: 'SELECT id, name, scopes, created_at, expires_at, revoked_at FROM replays_agent_credentials WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100',
      args: [owner.workspaceId, owner.userId],
    });
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopes: JSON.parse(row.scopes),
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    }));
  }

  async revoke(owner: ApplicationOwner, id: string) {
    const result = await this.records.db.execute({
      sql: 'UPDATE replays_agent_credentials SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND user_id = ? AND revoked_at IS NULL RETURNING id',
      args: [Date.now(), id, owner.workspaceId, owner.userId],
    });
    if (!result.rows.length) fail(404, 'Credential not found');
  }

  async verify(secret: string): Promise<{ owner: ApplicationOwner; scopes: AgentScope[] } | undefined> {
    if (!/^rpl_[A-Za-z0-9_-]{43}$/.test(secret)) return undefined;
    const digest = hash(secret);
    const result = await this.records.db.execute({
      sql: 'SELECT workspace_id, user_id, scopes, secret_hash FROM replays_agent_credentials WHERE secret_hash = ? AND revoked_at IS NULL AND expires_at > ?',
      args: [digest, Date.now()],
    });
    const row = result.rows[0];
    if (!row || !timingSafeEqual(Buffer.from(digest), Buffer.from(row.secret_hash))) return undefined;
    return { owner: { userId: row.user_id, workspaceId: row.workspace_id }, scopes: JSON.parse(row.scopes) };
  }
}
