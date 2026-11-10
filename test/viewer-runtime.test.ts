import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cacheRoot, isInstalled, prepareViewerRuntime, viewerDependencies } from '../src/viewer-runtime.ts';

const manifest = {
  name: 'pkg',
  version: '1.2.3',
  dependencies: { 'playwright-core': '1.64.0' },
  peerDependencies: { zod: '4.6.7', react: '>=19' },
  devDependencies: { zod: '4.6.7', react: '19.3.0' },
};

const silent = { write: () => true };
const failingInstall = () => Promise.reject(new Error('offline'));
const forbiddenInstall = () => Promise.reject(new Error('must not install'));

describe('viewer runtime', () => {
  let work = '';
  let packageRoot = '';
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), 'viewer-runtime-'));
    packageRoot = join(work, 'pkg');
    await mkdir(join(packageRoot, 'dist/lib'), { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(packageRoot, 'dist/lib/server.mjs'), 'export {};');
  });
  afterEach(() => rm(work, { recursive: true, force: true }));

  it('pins peer dependencies to the versions the package is tested with', () => {
    expect(viewerDependencies(manifest)).toEqual({ 'playwright-core': '1.64.0', react: '19.3.0', zod: '4.6.7' });
  });

  it('prefers the cache location from the environment', () => {
    expect(cacheRoot({ REPLAYS_VIEWER_CACHE: '/x/y' })).toBe('/x/y');
    expect(cacheRoot({ XDG_CACHE_HOME: '/c' }, 'linux')).toBe('/c/replays');
    expect(cacheRoot({ LOCALAPPDATA: 'C:\\L' }, 'win32')).toContain('replays');
  });

  it('runs in place when the dependencies sit beside the package', async () => {
    for (const name of ['zod', 'react', 'playwright-core']) {
      await mkdir(join(work, 'node_modules', name), { recursive: true });
      await writeFile(join(work, 'node_modules', name, 'package.json'), '{}');
    }
    expect(isInstalled('zod', packageRoot)).toBe(true);
    expect(await prepareViewerRuntime({ packageRoot, env: {}, stream: silent, install: forbiddenInstall })).toBe(packageRoot);
  });

  it('installs once into the cache and reuses it', async () => {
    const env = { REPLAYS_VIEWER_CACHE: join(work, 'cache') };
    const installs: Array<Record<string, string>> = [];
    const install = async (directory: string, dependencies: Record<string, string>) => {
      installs.push(dependencies);
      await mkdir(join(directory, 'node_modules'), { recursive: true });
    };
    const app = await prepareViewerRuntime({ packageRoot, env, stream: silent, install });
    expect(app.startsWith(join(work, 'cache', 'viewer-1.2.3-'))).toBe(true);
    expect(await readFile(join(app, 'dist/lib/server.mjs'), 'utf8')).toBe('export {};');
    expect(await prepareViewerRuntime({ packageRoot, env, stream: silent, install })).toBe(app);
    expect(installs).toEqual([{ 'playwright-core': '1.64.0', react: '19.3.0', zod: '4.6.7' }]);
  });

  it('explains a failed install and leaves no partial cache behind', async () => {
    const env = { REPLAYS_VIEWER_CACHE: join(work, 'cache') };
    await expect(prepareViewerRuntime({ packageRoot, env, stream: silent, install: failingInstall })).rejects.toThrow(
      /offline[\s\S]*network/,
    );
    const again = await prepareViewerRuntime({ packageRoot, env, stream: silent, install: async () => {} });
    expect(again).toContain('viewer-1.2.3-');
  });
});
