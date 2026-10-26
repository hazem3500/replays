import { mkdtemp } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { definePlugin } from '../src/plugin/index.ts';
import { startServer } from '../src/server/start.ts';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AgentCredentials } from '../src/server/agent-native/credentials.ts';
import { openApplicationRecords, type ApplicationRecords } from '../src/server/agent-native/records.ts';

// Dedicated disposable PostgreSQL only. CI/local runs without SQL do not pretend to cover persistence.
const url = process.env.REPLAYS_TEST_DATABASE_URL;
const owner = { workspaceId: 'test-workspace-a', userId: 'alice' };
const otherUser = { ...owner, userId: 'bob' };
const otherWorkspace = { ...owner, workspaceId: 'test-workspace-b' };
const input = { name: 'Test agent', scopes: ['replays:read'], expiresInSeconds: 3600 };

async function startHttp(workspaceId = owner.workspaceId) {
  return startServer({
    env: { DATA_DIR: await mkdtemp(join(tmpdir(), 'replays-credential-http-')), POSTERS_DISABLED: '1', RENDER_DISABLED: '1' },
    application: { databaseUrl: url!, credentials: true, workspaceId },
    port: 0,
    log: () => {},
    plugins: [
      definePlugin({
        name: 'test-auth',
        setup(api) {
          api.auth({
            name: 'test-auth',
            authenticate(request) {
              const id = request.headers['x-test-host-user'];
              return typeof id === 'string' ? { id } : undefined;
            },
          });
          api.onRequest(({ path, response }) => {
            if (path !== '/api/malleable/approvals') return;
            response.end('must not reach approval plugin');
            return true;
          });
        },
      }),
    ],
  });
}

describe.skipIf(!url)('application records against PostgreSQL', () => {
  let records: ApplicationRecords;
  let credentials: AgentCredentials;
  beforeAll(async () => {
    records = await openApplicationRecords(url!);
    credentials = new AgentCredentials(records);
    return () => records.close();
  });
  afterEach(async () => {
    for (const table of ['replays_agent_credentials', 'replays_conversations', 'replays_runs'])
      await records.db.execute({
        sql: `DELETE FROM ${table} WHERE workspace_id IN (?, ?, ?, ?)`,
        args: [owner.workspaceId, otherWorkspace.workspaceId, `test-auth:${owner.workspaceId}`, `test-auth:${otherWorkspace.workspaceId}`],
      });
  });

  it('migrates additively and isolates conversations by both stable user and deployment workspace', async () => {
    const conversation = await records.createConversation(owner, 'Inspection');
    await records.migrate();
    expect(await records.conversations(owner)).toMatchObject([{ id: conversation.id, title: 'Inspection', createdAt: expect.any(Number) }]);
    expect(await records.conversations(otherUser)).toEqual([]);
    expect(await records.conversations(otherWorkspace)).toEqual([]);
  });

  it('stores only a hash; secrets are returned once, never listed, and revoke is owner-scoped', async () => {
    const created = await credentials.create(owner, input);
    expect(created.secret).toMatch(/^rpl_[A-Za-z0-9_-]{43}$/);
    const raw = await records.db.execute({ sql: 'SELECT * FROM replays_agent_credentials WHERE id = ?', args: [created.credential.id] });
    expect(JSON.stringify(raw.rows)).not.toContain(created.secret);
    expect(raw.rows[0].secret_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await credentials.verify(created.secret)).toEqual({ owner, scopes: input.scopes });
    expect(JSON.stringify(await credentials.list(owner))).not.toContain('secret');
    expect(await credentials.list(otherUser)).toEqual([]);
    expect(await credentials.list(otherWorkspace)).toEqual([]);
    await expect(credentials.revoke(otherUser, created.credential.id)).rejects.toMatchObject({ status: 404 });
    await expect(credentials.revoke(otherWorkspace, created.credential.id)).rejects.toMatchObject({ status: 404 });
    expect(await credentials.verify(created.secret)).toBeDefined();
    await credentials.revoke(owner, created.credential.id);
    expect(await credentials.verify(created.secret)).toBeUndefined();
  });

  it('rejects unknown/approval scopes, unbounded expiry and empty names without writing a credential', async () => {
    for (const invalid of [
      { ...input, name: '' },
      { ...input, scopes: [] },
      { ...input, scopes: ['keep:approve'] },
      { ...input, scopes: ['replays:read', 'replays:read'] },
      { ...input, expiresInSeconds: 0 },
      { ...input, expiresInSeconds: 2592001 },
      { ...input, expiresInSeconds: 100.5 },
    ])
      await expect(credentials.create(owner, invalid)).rejects.toMatchObject({ status: 400 });
    expect(await credentials.list(owner)).toEqual([]);
  });

  it('refuses expired and malformed secrets and bounds active credentials under concurrent creation', async () => {
    const created = await credentials.create(owner, input);
    await records.db.execute({ sql: 'UPDATE replays_agent_credentials SET expires_at = 0 WHERE id = ?', args: [created.credential.id] });
    expect(await credentials.verify(created.secret)).toBeUndefined();
    expect(await credentials.verify(`${created.secret}x`)).toBeUndefined();
    const requests = await Promise.allSettled(Array.from({ length: 22 }, () => credentials.create(owner, input)));
    expect(requests.filter((result) => result.status === 'fulfilled')).toHaveLength(20);
    expect(requests.filter((result) => result.status === 'rejected')).toHaveLength(2);
  });

  it('records successful, failed and cancelled runs without recording arguments or private replay content', async () => {
    await expect(records.run(owner, 'read', new AbortController().signal, async () => 'private result')).resolves.toBe('private result');
    await expect(
      records.run(owner, 'read', new AbortController().signal, async () => {
        throw new Error('private error');
      }),
    ).rejects.toThrow('private error');
    const abort = new AbortController();
    await expect(
      records.run(owner, 'read', abort.signal, async () => {
        abort.abort(new Error('cancelled'));
      }),
    ).rejects.toThrow('cancelled');
    const runs = await records.db.execute({
      sql: 'SELECT status, finished_at FROM replays_runs WHERE workspace_id = ? AND user_id = ?',
      args: [owner.workspaceId, owner.userId],
    });
    expect(runs.rows.map((row) => row.status).sort()).toEqual(['cancelled', 'failed', 'succeeded']);
    expect(runs.rows.every((row) => row.finished_at !== null)).toBe(true);
    expect(JSON.stringify(runs.rows)).not.toContain('private');
  });
  it('authenticates real credential requests while retaining host auth, scopes and human approval restrictions', async () => {
    const server = await startHttp();
    const headers = { 'x-test-host-user': owner.userId, 'content-type': 'application/json' };
    try {
      const capabilities = await (await fetch(`${server.origin}/api/agent-capabilities`, { headers })).json();
      expect(capabilities.credentials).toMatchObject({ enabled: true, requiresHostAuthentication: true });
      const response = await fetch(`${server.origin}/api/agent-credentials`, { method: 'POST', headers, body: JSON.stringify(input) });
      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const created = await response.json();
      const agentHeaders = { ...headers, 'x-replays-agent-token': created.secret };
      const summaries = await (await fetch(`${server.origin}/api/replays`, { headers })).json();
      const metadata = `${server.origin}/_agent-native/actions/inspect-replay?id=${summaries[0].id}`;
      expect((await fetch(metadata, { headers: agentHeaders })).status).toBe(200);
      expect((await fetch(metadata, { headers: { 'x-replays-agent-token': created.secret } })).status).toBe(403);
      expect((await fetch(metadata, { headers: { ...agentHeaders, 'x-test-host-user': otherUser.userId } })).status).toBe(401);
      const other = await startHttp(otherWorkspace.workspaceId);
      try {
        expect((await fetch(metadata.replace(server.origin, other.origin), { headers: agentHeaders })).status).toBe(401);
      } finally {
        await other.close();
      }
      expect((await fetch(`${server.origin}/api/agent-conversations`, { headers: agentHeaders })).status).toBe(403);
      expect((await fetch(`${server.origin}/api/agent-credentials`, { headers: agentHeaders })).status).toBe(403);
      const keep = await fetch(`${server.origin}/api/malleable/approvals`, { method: 'POST', headers: agentHeaders, body: '{}' });
      expect(keep.status).toBe(403);
      expect(await keep.text()).not.toContain('must not reach approval plugin');
      expect((await fetch(`${server.origin}/_agent-native/actions/saveApproved`, { headers: agentHeaders })).status).toBe(403);
      expect(
        (
          await fetch(`${server.origin}/api/agent-credentials/${created.credential.id}`, {
            method: 'DELETE',
            headers: { ...headers, 'x-test-host-user': otherUser.userId },
          })
        ).status,
      ).toBe(404);
      expect((await fetch(`${server.origin}/api/agent-credentials/${created.credential.id}`, { method: 'DELETE', headers })).status).toBe(
        204,
      );
      expect((await fetch(metadata, { headers: agentHeaders })).status).toBe(401);
      const expired = await (
        await fetch(`${server.origin}/api/agent-credentials`, { method: 'POST', headers, body: JSON.stringify(input) })
      ).json();
      await records.db.execute({ sql: 'UPDATE replays_agent_credentials SET expires_at = 0 WHERE id = ?', args: [expired.credential.id] });
      expect((await fetch(metadata, { headers: { ...headers, 'x-replays-agent-token': expired.secret } })).status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('cancels a partially uploaded conversation request during shutdown', async () => {
    const server = await startHttp();
    const request = httpRequest(`${server.origin}/api/agent-conversations`, {
      method: 'POST',
      headers: {
        'x-test-host-user': owner.userId,
        'content-type': 'application/json',
        'content-length': '1000',
      },
    });
    request.on('error', () => {});
    const received = new Promise<void>((resolve) => server.server.once('request', () => resolve()));
    request.write('{');
    await received;
    await expect(server.close()).resolves.toBeUndefined();
    request.destroy();
  });
});
