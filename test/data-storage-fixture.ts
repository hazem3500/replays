import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PluginRegistry } from '../src/plugin/registry.ts';
import { createApp } from '../src/server/app.ts';
import type { AuthAdapter } from '../src/server/auth/types.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import type { ObjectStorage } from '../src/server/storage/types.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults } from './fixtures.ts';

const disposals: Array<() => Promise<void>> = [];
const noop = async () => {};

/** A real HTTP application over disposable storage, with an optional host authorization boundary. */
export async function startDataStorage(
  options: {
    authorize?: (request: IncomingMessage, path: string) => Promise<void>;
    auth?: AuthAdapter;
    storage?: ObjectStorage;
    plugins?: PluginRegistry;
    basePath?: string;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'data-storage-'));
  const samples = join(directory, 'samples');
  await mkdir(samples);
  const store = new ReplayStore(options.storage ?? new MemoryStorage(), samples, { days: 45, profiles: { triage: 7 }, expiredDays: 12 });
  const application = { authorize: options.authorize ?? noop, handle: () => Promise.resolve(false), close: noop };
  const app = createApp({
    ...appDefaults(),
    ...(options.auth ? { auth: options.auth } : {}),
    store,
    application,
    clientDir: directory,
    ...(options.plugins ? { plugins: options.plugins } : {}),
    ...(options.basePath ? { basePath: options.basePath } : {}),
  });
  const server = createServer((request, response) => {
    void app(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The test server did not get a port');
  const origin = `http://127.0.0.1:${address.port}`;
  disposals.push(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(directory, { recursive: true, force: true });
  });
  return { store, origin, samples };
}

export async function closeDataStorageServers() {
  for (const dispose of disposals.splice(0)) await dispose();
}
