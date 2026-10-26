import { randomUUID } from 'node:crypto';

import { createDbExec, type DbExec, withMigrationRuntime } from '@agent-native/core/db';

export interface ApplicationOwner {
  /** Stable verified host identity, never a browser-provided email or organization header. */
  userId: string;
  workspaceId: string;
}

export class ApplicationRecords {
  readonly db: DbExec;
  constructor(db: DbExec) {
    this.db = db;
  }

  async migrate() {
    await withMigrationRuntime(async () => {
      await this.db.execute(`CREATE TABLE IF NOT EXISTS replays_conversations (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
        title TEXT NOT NULL, created_at BIGINT NOT NULL)`);
      await this.db.execute(`CREATE TABLE IF NOT EXISTS replays_runs (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
        action TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
        started_at BIGINT NOT NULL, finished_at BIGINT)`);
      await this.db.execute(`CREATE TABLE IF NOT EXISTS replays_agent_credentials (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
        name TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL,
        created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, revoked_at BIGINT)`);
      await this.db.execute('CREATE INDEX IF NOT EXISTS replays_credentials_owner ON replays_agent_credentials(workspace_id, user_id)');
    });
  }

  async conversations(owner: ApplicationOwner) {
    const result = await this.db.execute({
      sql: 'SELECT id, title, created_at AS "createdAt" FROM replays_conversations WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100',
      args: [owner.workspaceId, owner.userId],
    });
    return result.rows.map((row) => ({ id: String(row.id), title: String(row.title), createdAt: Number(row.createdAt) }));
  }

  async createConversation(owner: ApplicationOwner, title: string) {
    const conversation = { id: randomUUID(), title, createdAt: Date.now() };
    await this.db.execute({
      sql: 'INSERT INTO replays_conversations(id, workspace_id, user_id, title, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [conversation.id, owner.workspaceId, owner.userId, title, conversation.createdAt],
    });
    return conversation;
  }

  async run<T>(owner: ApplicationOwner, action: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const id = randomUUID();
    await this.db.execute({
      sql: 'INSERT INTO replays_runs(id, workspace_id, user_id, action, status, started_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, owner.workspaceId, owner.userId, action, 'running', Date.now()],
    });
    try {
      signal.throwIfAborted();
      const result = await operation();
      signal.throwIfAborted();
      await this.finishRun(id, 'succeeded');
      return result;
    } catch (error) {
      await this.finishRun(id, signal.aborted ? 'cancelled' : 'failed');
      throw error;
    }
  }

  private async finishRun(id: string, status: string) {
    await this.db.execute({ sql: 'UPDATE replays_runs SET status = ?, finished_at = ? WHERE id = ?', args: [status, Date.now(), id] });
  }

  async close() {
    await this.db.close?.();
  }
}

export async function openApplicationRecords(url: string) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Application records require a PostgreSQL DATABASE_URL');
  const records = new ApplicationRecords(await createDbExec({ url }));
  try {
    await records.migrate();
    return records;
  } catch (error) {
    await records.close();
    throw error;
  }
}
