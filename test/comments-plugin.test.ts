import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin, type ReplaysPlugin } from '../src/plugin/index.ts';
import { startServer, type RunningServer } from '../src/server/start.ts';
import type { CommentsResponse } from '../src/shared/comments.ts';

const running: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

const quiet = { log: () => {} };

async function boot(env: Record<string, string> = {}, plugins: ReplaysPlugin[] = []) {
  const server = await startServer({
    env: { DATA_DIR: await mkdtemp(join(tmpdir(), 'replays-cp-')), POSTERS_DISABLED: '1', RENDER_DISABLED: '1', ...env },
    port: 0,
    config: { dir: process.cwd(), file: {}, plugins: [] },
    plugins,
    ...quiet,
  });
  running.push(server);
  return server;
}

/** A plugin auth adapter that names the person (with an avatar) from request headers, like a signed-header proxy would. */
const headerPlugin = definePlugin({
  name: 'who',
  setup(api) {
    api.auth({
      name: 'who-am-i',
      authenticate(request) {
        const id = request.headers['x-who'];
        if (typeof id !== 'string') return undefined;
        const name = request.headers['x-name'];
        const avatar = request.headers['x-avatar'];
        return { id, ...(typeof name === 'string' ? { name } : {}), ...(typeof avatar === 'string' ? { avatarUrl: avatar } : {}) };
      },
    });
  },
});

describe('comments as a built-in plugin', () => {
  it('is loaded by default, first, and the page and config say so', async () => {
    const server = await boot({}, [definePlugin({ name: 'mine', setup() {} })]);
    const config = await (await fetch(`${server.origin}/api/config`)).json();
    expect(config).toMatchObject({ comments: true, plugins: ['comments', 'mine'] });
    expect((await fetch(`${server.origin}/api/replays/demo-shop/comments`)).status).toBe(200);
  });

  it('is absent with REPLAYS_COMMENTS=false: no plugin, no flag, no routes', async () => {
    const server = await boot({ REPLAYS_COMMENTS: 'false' });
    const config = await (await fetch(`${server.origin}/api/config`)).json();
    expect(config).toMatchObject({ comments: false, plugins: [] });
    expect((await fetch(`${server.origin}/api/replays/demo-shop/comments`)).status).toBe(404);
  });

  it('is off through comments.enabled in a programmatic config too', async () => {
    const server = await startServer({
      env: { DATA_DIR: await mkdtemp(join(tmpdir(), 'replays-cp-')), POSTERS_DISABLED: '1', RENDER_DISABLED: '1' },
      port: 0,
      config: { dir: process.cwd(), file: { comments: { enabled: false } }, plugins: [] },
      ...quiet,
    });
    running.push(server);
    expect((await fetch(`${server.origin}/api/replays/demo-shop/comments`)).status).toBe(404);
  });

  it('writes the identity a plugin’s auth adapter produced as the author, avatar included, and refuses anonymous callers', async () => {
    const server = await boot({}, [headerPlugin]);
    const url = `${server.origin}/api/replays/demo-shop/comments`;
    expect((await fetch(url)).status).toBe(403);
    const headers = {
      'x-who': 'ada@acme.test',
      'x-name': 'Ada Lovelace',
      'x-avatar': 'https://img.example.com/ada.png',
      'content-type': 'application/json',
    };
    const created = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ body: 'Checked on the plugin identity' }) });
    expect(created.status).toBe(201);
    const listed = (await (await fetch(url, { headers })).json()) as CommentsResponse;
    expect(listed.comments[0]).toMatchObject({
      body: 'Checked on the plugin identity',
      author: { name: 'Ada Lovelace', avatarUrl: 'https://img.example.com/ada.png' },
      mine: true,
    });
    expect(listed.anonymous).toBe(false);
    // Another person sees the author but not as theirs, and not the id.
    const other = (await (await fetch(url, { headers: { 'x-who': 'bob@acme.test' } })).json()) as CommentsResponse;
    expect(other.comments[0]?.mine).toBe(false);
    expect(JSON.stringify(other)).not.toContain('ada@acme.test');
  });

  it('runs before the deployment’s own hooks, and a hook sees the request after comments declined it', async () => {
    const seen: string[] = [];
    const server = await boot({}, [definePlugin({ name: 'spy', setup: (api) => api.onRequest(({ path }) => void seen.push(path)) })]);
    await fetch(`${server.origin}/api/replays/demo-shop/comments`);
    await fetch(`${server.origin}/api/config`);
    expect(seen).toEqual(['/api/config']);
  });
});
