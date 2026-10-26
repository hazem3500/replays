import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin } from '../src/plugin/index.ts';
import { startServer, type RunningServer } from '../src/server/start.ts';

const servers: RunningServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});
async function start(options: Parameters<typeof startServer>[0] = {}) {
  const server = await startServer({
    env: { DATA_DIR: await mkdtemp(join(tmpdir(), 'replays-native-')), POSTERS_DISABLED: '1', RENDER_DISABLED: '1' },
    port: 0,
    log: () => {},
    ...options,
  });
  servers.push(server);
  return server;
}

describe('main Agent-Native runtime', () => {
  it('starts by default, advertises only configured capabilities, and keeps SQL optional for portable viewing', async () => {
    const server = await start();
    const response = await fetch(`${server.origin}/api/agent-capabilities`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      runtime: 'agent-native',
      credentials: { enabled: false },
      conversations: { enabled: false },
    });
    expect((await fetch(`${server.origin}/api/agent-credentials`)).status).toBe(503);
    expect((await fetch(`${server.origin}/api/replays`)).status).toBe(200);
  });

  it('uses the actual dispatcher with validated input and never automatically mounts another login or privileged tool', async () => {
    const server = await start();
    const summaries = await (await fetch(`${server.origin}/api/replays`)).json();
    expect(summaries.length).toBeGreaterThan(0);
    const id = summaries[0].id;
    const metadata = await fetch(`${server.origin}/_agent-native/actions/inspect-replay?id=${encodeURIComponent(id)}`);
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({ id });
    const missing = await fetch(`${server.origin}/_agent-native/actions/inspect-replay`);
    expect(missing.status).toBeGreaterThanOrEqual(400);
    for (const path of [
      '/_agent-native/actions/saveApproved',
      '/_agent-native/auth/login',
      '/_agent-native/terminal',
      '/_agent-native/agent-chat',
    ])
      expect((await fetch(`${server.origin}${path}`)).status).toBe(404);
  });

  it('does not use forwarded browser identity, org or capability headers to override host authentication', async () => {
    const server = await start({
      plugins: [
        definePlugin({
          name: 'closed',
          setup(api) {
            api.auth({ name: 'closed', authenticate: () => undefined });
          },
        }),
      ],
    });
    const response = await fetch(`${server.origin}/_agent-native/actions/inspect-replay?id=sample`, {
      headers: {
        'x-agent-native-user-email': 'forged@example.test',
        'x-org-id': 'forged',
        'x-agent-native-tool-bridge': '1',
      },
    });
    expect(response.status).toBe(403);
  });

  it('preserves the public library host opt-out', async () => {
    const server = await start({ application: false });
    expect((await fetch(`${server.origin}/api/agent-capabilities`)).status).toBe(404);
    expect((await fetch(`${server.origin}/api/replays`)).status).toBe(200);
  });

  it('refuses agent credentials on human approval and legacy write paths before post-auth plugins', async () => {
    const server = await start({
      plugins: [
        definePlugin({
          name: 'approval-trap',
          setup(api) {
            api.onRequest(({ path, response }) => {
              if (path !== '/api/malleable/approvals') return false;
              response.end('must never be reached');
              return true;
            });
          },
        }),
      ],
    });
    const response = await fetch(`${server.origin}/api/malleable/approvals`, {
      method: 'POST',
      headers: { 'x-replays-agent-token': `rpl_${'a'.repeat(43)}` },
    });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('must never be reached');
  });
});
