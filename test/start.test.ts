import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin } from '../src/plugin/index.ts';
import { type RunningServer, startServer } from '../src/server/start.ts';

const running: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

const quiet = { log: () => {} };
const baseEnv = async () => ({ DATA_DIR: await mkdtemp(join(tmpdir(), 'replays-start-')), POSTERS_DISABLED: '1', RENDER_DISABLED: '1' });

describe('startServer', () => {
  it('starts on a free port with a config object and plugins, and closes cleanly', async () => {
    const server = await startServer({
      env: await baseEnv(),
      port: 0,
      config: { dir: process.cwd(), file: { name: 'Programmatic' }, plugins: [] },
      plugins: [definePlugin({ name: 'extra', setup: (api) => api.sourceProvider({ id: 'tick', label: 'T', resolve: () => undefined }) })],
      ...quiet,
    });
    running.push(server);
    expect(server.port).toBeGreaterThan(0);
    expect(await (await fetch(`${server.origin}/healthz`)).text()).toBe('ok');
    const config = await (await fetch(`${server.origin}/api/config`)).json();
    expect(config).toMatchObject({ name: 'Programmatic', auth: 'none', plugins: ['comments', 'extra'] });
    expect(config.sourceProviders).toContain('tick');
  });

  it('discovers replays.config.* in cwd and loads its plugins', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'replays-start-cwd-'));
    await writeFile(
      join(cwd, 'plugin.mjs'),
      "export default () => ({ name: 'from-file', apiVersion: 1, setup(api) { api.branding({ name: 'File Plugin Brand' }); api.basePath('/x'); } });\n",
    );
    await writeFile(join(cwd, 'replays.config.json'), JSON.stringify({ plugins: ['./plugin.mjs'] }));
    const server = await startServer({ env: await baseEnv(), cwd, port: 0, ...quiet });
    running.push(server);
    const config = await (await fetch(`${server.origin}/x/api/config`)).json();
    expect(config).toMatchObject({ name: 'File Plugin Brand', plugins: ['comments', 'from-file'] });
  });

  it('serves the samples of SAMPLE_DIR (or none), not only the package’s', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'replays-start-samples-'));
    const server = await startServer({ env: { ...(await baseEnv()), SAMPLE_DIR: empty }, port: 0, ...quiet });
    running.push(server);
    expect(await (await fetch(`${server.origin}/api/replays`)).json()).toEqual([]);
    const missing = await startServer({ env: await baseEnv(), sampleDir: join(empty, 'nope'), port: 0, ...quiet });
    running.push(missing);
    expect(await (await fetch(`${missing.origin}/api/replays`)).json()).toEqual([]);
  });

  it('rejects, without listening, when the configuration is wrong', async () => {
    await expect(startServer({ env: { ...(await baseEnv()), AUTH_MODE: 'nope' }, port: 0, ...quiet })).rejects.toThrow(/auth "nope"/);
    await expect(startServer({ env: { ...(await baseEnv()), STORAGE: 'nope' }, port: 0, ...quiet })).rejects.toThrow(
      /storage or retention setup failed: STORAGE must be fs or s3/,
    );
  });
});
