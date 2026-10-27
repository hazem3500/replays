import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { PosterQueue } from '../src/server/posters.ts';
import { MemoryStorage } from '../src/server/storage/memory.ts';

it('settles a failed temp-directory creation and keeps processing later jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'poster-failures-'));
  const tempDir = join(root, 'not-a-directory');
  await writeFile(tempDir, 'occupied');
  const storage = new MemoryStorage();
  const queue = new PosterQueue({
    storage,
    tempDir,
    key: (id) => `${id}/poster.jpg`,
    runner: async ({ output }) => {
      await writeFile(output, 'image');
    },
  });
  try {
    expect(await queue.request('first')).toBe('pending');
    await queue.settled('first');
    expect(await queue.request('first')).toBe('failed');
    await rm(tempDir);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(tempDir);
    expect(await queue.request('second')).toBe('pending');
    await queue.settled('second');
    expect(await queue.request('second')).toBe('ready');
    expect(queue.size).toEqual({ running: 0, queued: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
