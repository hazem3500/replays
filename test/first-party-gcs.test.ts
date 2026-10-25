import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import gcs, { GcsStorage, gcsStorageFromEnv, RESUMABLE_BYTES } from '../src/first-party/gcs.ts';
import { resolvePlugins } from '../src/plugin/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { ObjectExistsError } from '../src/server/storage/types.ts';
import { describeObjectStorage } from '../src/server/testing/index.ts';
import { type GcsFake, startGcsFake } from './gcs-fake.ts';

let fake: GcsFake;
beforeAll(async () => {
  // Small pages, so listing has to follow nextPageToken.
  fake = await startGcsFake({ pageSize: 2 });
  fake.token = 'test-token';
});
afterAll(async () => {
  await fake.stop();
});

const storage = (extra: Partial<ConstructorParameters<typeof GcsStorage>[0]> = {}) =>
  new GcsStorage({ bucket: fake.bucket(), prefix: 'replays', endpoint: fake.endpoint, token: 'test-token', ...extra });

// The contract every backend passes, against an in-process fake of the JSON API (no network).
describeObjectStorage('gcs (in-process fake)', () => storage(), { describe, it });

describe('gcs storage', () => {
  it('uses generations as versions, create-only uploads (ifGenerationMatch=0) and keys under the prefix', async () => {
    const store = storage();
    const first = await store.write('a/replay.json', '{}', { createOnly: true, contentType: 'application/json', cacheControl: 'no-store' });
    expect(first.version).toMatch(/^\d+$/);
    expect(fake.requests.at(-1)).toMatch(/^POST \/upload\/storage\/v1\/b\/bucket-\d+\/o\?uploadType=multipart&ifGenerationMatch=0$/);
    await store.write('a/replay.json', '{"v":2}', { ifVersion: first.version });
    expect(fake.requests.at(-1)).toContain(`ifGenerationMatch=${first.version}`);
    await expect(store.stat('a/replay.json')).resolves.toMatchObject({ key: 'a/replay.json', size: 7 });
    expect(fake.requests.at(-1)).toMatch(/\/o\/replays%2Fa%2Freplay\.json$/);
    expect(store).toMatchObject({ kind: 'gcs', listCacheMs: 5000 });
    expect(store.description).toMatch(/^gs:\/\/bucket-\d+\/replays\/$/);
  });

  it('lists with matchGlob under the prefix, across pages', async () => {
    const store = storage();
    for (const key of ['a/meta.json', 'b/meta.json', 'c/meta.json', 'c/poster.jpg']) await store.write(key, 'x');
    fake.requests.length = 0;
    expect((await store.list({ glob: '*/meta.json' })).map((object) => object.key)).toEqual(['a/meta.json', 'b/meta.json', 'c/meta.json']);
    expect(fake.requests[0]).toContain('matchGlob=replays%2F*%2Fmeta.json');
    expect(fake.requests.filter((line) => line.startsWith('GET ')).length).toBe(2);
  });

  it('uploads above 8 MB resumably, in chunks, honouring create-only', async () => {
    const store = storage();
    const dir = await mkdtemp(join(tmpdir(), 'replays-gcs-'));
    try {
      const file = join(dir, 'render.mp4');
      const size = RESUMABLE_BYTES + 1024 * 1024 + 7;
      const body = Buffer.alloc(size);
      for (let index = 0; index < size; index += 4096) body[index] = index % 251;
      await writeFile(file, body);
      fake.requests.length = 0;
      const info = await store.upload('r/render.mp4', file, { contentType: 'video/mp4', createOnly: true });
      expect(info.size).toBe(size);
      expect(fake.requests.filter((line) => line.includes('uploadType=resumable'))).toHaveLength(3); // open + 2 chunks
      expect((await store.read('r/render.mp4'))?.equals(body)).toBe(true);
      await expect(store.upload('r/render.mp4', file, { createOnly: true })).rejects.toBeInstanceOf(ObjectExistsError);
      // A large in-memory write takes the same path.
      await expect(store.write('r/big.bin', body)).resolves.toMatchObject({ size });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('gets a token from the metadata server, caches it until it expires, and sends it as a bearer token', async () => {
    fake.tokenLifetime = 3600;
    const store = new GcsStorage({ bucket: fake.bucket(), endpoint: fake.endpoint, metadataHost: fake.host });
    fake.requests.length = 0;
    await store.write('x.json', '1');
    await store.read('x.json');
    await Promise.all([store.stat('x.json'), store.stat('x.json')]);
    expect(fake.requests.filter((line) => line.includes('computeMetadata'))).toHaveLength(1);
    // A token about to expire (inside the minute of margin) is fetched again.
    fake.tokenLifetime = 30;
    const shortLived = new GcsStorage({ bucket: fake.bucket(), endpoint: fake.endpoint, metadataHost: fake.host });
    fake.requests.length = 0;
    await shortLived.list();
    await shortLived.list();
    expect(fake.requests.filter((line) => line.includes('computeMetadata'))).toHaveLength(2);
    fake.tokenLifetime = 3600;
    // A wrong token is an error, not "not found".
    await expect(new GcsStorage({ bucket: fake.bucket(), endpoint: fake.endpoint, token: 'nope' }).read('x.json')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('is configured from the environment and selected with STORAGE=gcs', async () => {
    expect(() => gcsStorageFromEnv({}, {})).toThrow(/GCS_BUCKET/);
    const fromEnv = gcsStorageFromEnv({}, { GCS_BUCKET: 'b', GCS_PREFIX: 'p', GOOGLE_OAUTH_ACCESS_TOKEN: 'tok' });
    expect(fromEnv.description).toBe('gs://b/p/');
    // The emulator host, without a scheme; no token unless one is given.
    const bucket = fake.bucket();
    const saved = fake.token;
    fake.token = undefined;
    try {
      const emulated = gcsStorageFromEnv(
        { prefix: 'opt' },
        { GCS_BUCKET: bucket, GCS_PREFIX: 'ignored', STORAGE_EMULATOR_HOST: fake.host },
      );
      await emulated.write('k.json', '1');
      await expect(emulated.list()).resolves.toMatchObject([{ key: 'k.json' }]);
      expect(emulated.description).toBe(`gs://${bucket}/opt/`);
    } finally {
      fake.token = saved;
    }
    const registry = await resolvePlugins([gcs({ bucket: 'from-options' })]);
    expect([...registry.storage.keys()]).toEqual(['gcs']);
    const created = await registry.storage.get('gcs')!.value.create({ env: { GOOGLE_OAUTH_ACCESS_TOKEN: 't' }, dataDir: '/tmp/x' });
    expect(created).toMatchObject({ kind: 'gcs', description: 'gs://from-options/' });
    expect(new ReplayStore(created, '/tmp/none').listTtlMs).toBe(5000);
  });
});

describe.each(['buffer', 'file'] as const)('resumable %s uploads', (source) => {
  async function checkUpload(
    acceptBytes: readonly number[],
    check: (upload: () => ReturnType<GcsStorage['write']>, store: GcsStorage, server: GcsFake, body: Buffer) => Promise<void>,
    finalizeOnProbe = false,
  ) {
    const server = await startGcsFake({ resumableAcceptBytes: acceptBytes, resumableFinalizeOnProbe: finalizeOnProbe });
    const store = new GcsStorage({ bucket: server.bucket(), endpoint: server.endpoint, token: false });
    const dir = await mkdtemp(join(tmpdir(), 'replays-gcs-acks-'));
    try {
      const body = Buffer.alloc(2 * RESUMABLE_BYTES + 7);
      for (let index = 0; index < body.length - 4; index += 4096) body.writeUInt32LE(index, index);
      const file = join(dir, 'body.bin');
      if (source === 'file') await writeFile(file, body);
      await check(() => (source === 'file' ? store.upload('body.bin', file) : store.write('body.bin', body)), store, server, body);
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('resends from partial acknowledgments, including transient missing Range and repeated offsets', async () => {
    const half = RESUMABLE_BYTES / 2;
    await checkUpload([0, half, 0, half], async (upload, store, server, body) => {
      await expect(upload()).resolves.toMatchObject({ size: body.length });
      expect(server.uploadRanges).toEqual([
        `bytes 0-${RESUMABLE_BYTES - 1}/${body.length}`,
        `bytes 0-${RESUMABLE_BYTES - 1}/${body.length}`,
        `bytes ${half}-${half + RESUMABLE_BYTES - 1}/${body.length}`,
        `bytes ${half}-${half + RESUMABLE_BYTES - 1}/${body.length}`,
        `bytes ${RESUMABLE_BYTES}-${2 * RESUMABLE_BYTES - 1}/${body.length}`,
        `bytes ${2 * RESUMABLE_BYTES}-${body.length - 1}/${body.length}`,
      ]);
      expect((await store.read('body.bin'))?.equals(body)).toBe(true);
    });
  });

  it('checks completion if the final bytes are acknowledged with 308', async () => {
    await checkUpload(
      [],
      async (upload, store, server, body) => {
        await expect(upload()).resolves.toMatchObject({ size: body.length });
        expect(server.uploadRanges.at(-1)).toBe(`bytes */${body.length}`);
        expect((await store.read('body.bin'))?.equals(body)).toBe(true);
      },
      true,
    );
  });

  it.each([
    { label: 'missing Range', accepted: [0, 0, 0], offset: 0, requests: 3 },
    { label: 'no progress after a partial chunk', accepted: [RESUMABLE_BYTES / 2, 0, 0, 0], offset: RESUMABLE_BYTES / 2, requests: 4 },
  ])('bounds recovery for $label', async ({ accepted, offset, requests }) => {
    await checkUpload(accepted, async (upload, store, server, body) => {
      await expect(upload()).rejects.toMatchObject({ status: 308, message: expect.stringContaining('no progress') });
      expect(server.uploadRanges).toHaveLength(requests);
      expect(server.uploadRanges.slice(-3)).toEqual(Array(3).fill(`bytes ${offset}-${offset + RESUMABLE_BYTES - 1}/${body.length}`));
      await expect(store.stat('body.bin')).resolves.toBeUndefined();
    });
  });
});
