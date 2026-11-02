import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pluginPolicyHash } from '../src/shared/malleable-policy.ts';
import { starterPlugin } from '../src/shared/malleable.ts';
import { isRecord } from '../src/shared/plugin-validation.ts';
import { asUser, boot, closeServers, savePlugin, who } from './malleable-server-fixture.ts';

describe('host admission and workspace review', () => {
  afterEach(closeServers);
  it('role-gates workspace writes and requires per-person acceptance of each new version', async () => {
    const server = await boot({ REPLAYS_BETA_MALLEABLE: 'true' }, [who], { malleable: { scopes: ['user', 'workspace'] } });
    const content = starterPlugin('workspace-review');
    const requestApproval = (user: string) =>
      fetch(`${server.origin}/api/malleable/approvals`, {
        method: 'POST',
        headers: asUser(user),
        body: JSON.stringify({ action: 'save', scope: 'workspace', id: content.manifest.id, ...content }),
      });
    expect((await requestApproval('grace')).status).toBe(403);
    expect(
      (
        await fetch(`${server.origin}/api/malleable/plugins/workspace/workspace-review`, {
          method: 'PUT',
          headers: asUser('grace'),
          body: JSON.stringify({ ...content, baseVersion: 0, approval: 'fake' }),
        })
      ).status,
    ).toBe(403);
    expect((await savePlugin(server, 'ada', { scope: 'workspace', content, baseVersion: 0 })).status).toBe(200);
    const list = (user: string) => pluginList(server.origin, user);

    expect((await list('ada'))[0]?.requiresReview).toBe(false);
    const notice = (await list('grace'))[0];
    if (!notice) throw new Error('workspace notice missing');
    expect(notice.requiresReview).toBe(true);
    const accept = (sha256: string) =>
      fetch(`${server.origin}/api/malleable/notices/workspace-review`, {
        method: 'POST',
        headers: asUser('grace'),
        body: JSON.stringify({ sha256 }),
      });
    expect((await accept('0'.repeat(64))).status).toBe(409);
    expect((await accept(notice.sha256)).status).toBe(200);
    expect((await list('grace'))[0]?.requiresReview).toBe(false);
    expect((await list('alan'))[0]?.requiresReview).toBe(true);
    expect(
      (
        await savePlugin(server, 'ada', {
          scope: 'workspace',
          content: { ...content, source: `${content.source}\n// new version` },
          baseVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect((await list('grace'))[0]?.requiresReview).toBe(true);
    expect((await accept(notice.sha256)).status).toBe(409);
    const deleteApproval = await fetch(`${server.origin}/api/malleable/approvals`, {
      method: 'POST',
      headers: asUser('grace'),
      body: JSON.stringify({ action: 'delete', scope: 'workspace', id: content.manifest.id }),
    });
    expect(deleteApproval.status).toBe(403);
  });
});

describe('host source admission', () => {
  afterEach(closeServers);

  it('enforces host allow/deny selectors by id and hash before minting approval', async () => {
    const content = starterPlugin('hash-approved');
    const hash = await pluginPolicyHash(content.manifest, content.source);
    const dataDir = await mkdtemp(join(tmpdir(), 'replays-admission-'));
    const server = await boot({ REPLAYS_BETA_MALLEABLE: 'true', DATA_DIR: dataDir }, [who], { malleable: { allow: [`sha256:${hash}`] } });
    expect((await savePlugin(server, 'ada', { scope: 'user', content, baseVersion: 0 })).status).toBe(200);
    const changed = await fetch(`${server.origin}/api/malleable/approvals`, {
      method: 'POST',
      headers: asUser('ada'),
      body: JSON.stringify({ action: 'save', scope: 'user', id: content.manifest.id, ...content, source: `${content.source}\n// changed` }),
    });
    expect(changed.status).toBe(403);
    const blocked = await boot({ REPLAYS_BETA_MALLEABLE: 'true', DATA_DIR: dataDir }, [who], {
      malleable: { allow: [`sha256:${hash}`], deny: [`id:${content.manifest.id}`] },
    });
    expect(await pluginList(blocked.origin, 'ada')).toEqual([]);
    expect((await fetch(`${blocked.origin}/api/malleable/plugins/user/${content.manifest.id}`, { headers: asUser('ada') })).status).toBe(
      403,
    );
    const denied = await fetch(`${blocked.origin}/api/malleable/approvals`, {
      method: 'POST',
      headers: asUser('ada'),
      body: JSON.stringify({ action: 'save', scope: 'user', id: content.manifest.id, ...content }),
    });
    expect(denied.status).toBe(403);
    const personalOnly = await boot({ REPLAYS_BETA_MALLEABLE: 'true' });
    const workspace = await fetch(`${personalOnly.origin}/api/malleable/approvals`, {
      method: 'POST',
      headers: asUser('ada'),
      body: JSON.stringify({ action: 'save', scope: 'workspace', id: content.manifest.id, ...content }),
    });
    expect(workspace.status).toBe(403);
  });
});

async function pluginList(origin: string, user: string): Promise<Array<{ id: string; requiresReview: boolean; sha256: string }>> {
  const body: unknown = await (await fetch(`${origin}/api/malleable/plugins`, { headers: asUser(user) })).json();
  if (!isRecord(body) || !Array.isArray(body.plugins)) throw new Error('invalid plugin list');
  return body.plugins.map((plugin: unknown) => {
    if (!isRecord(plugin) || typeof plugin.id !== 'string' || typeof plugin.sha256 !== 'string') throw new Error('invalid plugin summary');
    return { id: plugin.id, sha256: plugin.sha256, requiresReview: plugin.requiresReview === true };
  });
}
