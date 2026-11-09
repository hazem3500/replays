import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkForUpdate, isNewer, shouldCheckForUpdates, startUpdateCheck, updateNoticeText } from '../src/capture/update-check.ts';

const DAY = 24 * 60 * 60 * 1000;
let directory = '';
let cachePath = '';

const counting = (version: string | undefined) => {
  const calls: string[] = [];
  return {
    calls,
    fetchLatest: async (url: string) => {
      calls.push(url);
      return version;
    },
  };
};

describe('update checks', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'replays-update-'));
    cachePath = join(directory, 'update-check.json');
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  describe('comparing versions', () => {
    it('compares numerically and ignores pre-release suffixes', () => {
      expect(isNewer('0.10.0', '0.9.9')).toBe(true);
      expect(isNewer('1.0.0', '1.0.0')).toBe(false);
      expect(isNewer('0.3.4', '0.3.5')).toBe(false);
      expect(isNewer('2.0.0-beta.1', '1.9.9')).toBe(true);
    });

    it('words the notice with and without a command', () => {
      expect(updateNoticeText({ current: '0.1.0', latest: '0.2.0' }, 'npm i -g x')).toBe(
        'Update available: 0.1.0 → 0.2.0. Run `npm i -g x` to update.',
      );
      expect(updateNoticeText({ current: '0.1.0', latest: '0.2.0' })).toBe('Update available: 0.1.0 → 0.2.0.');
    });
  });

  describe('when to look for updates', () => {
    it('only for a person at a terminal', () => {
      expect(shouldCheckForUpdates({}, true, false)).toBe(true);
      expect(shouldCheckForUpdates({}, false, false)).toBe(false);
      expect(shouldCheckForUpdates({ CI: 'true' }, true, false)).toBe(false);
      expect(shouldCheckForUpdates({}, true, true)).toBe(false);
      expect(shouldCheckForUpdates({ REPLAYS_NO_UPDATE_CHECK: '1' }, true, false)).toBe(false);
      expect(shouldCheckForUpdates({ NO_UPDATE_NOTIFIER: '1' }, true, false)).toBe(false);
    });
  });

  describe('the once-a-day registry check', () => {
    it('asks the registry once, then answers from the cache for a day', async () => {
      const registry = counting('0.2.0');
      const options = { current: '0.1.0', latestUrl: 'https://registry.test/latest', cachePath, fetchLatest: registry.fetchLatest };
      expect(await checkForUpdate({ ...options, now: 1_000 })).toEqual({ current: '0.1.0', latest: '0.2.0' });
      expect(await checkForUpdate({ ...options, now: 1_000 + DAY - 1 })).toEqual({ current: '0.1.0', latest: '0.2.0' });
      expect(registry.calls).toEqual(['https://registry.test/latest']);
      expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual({ checkedAt: 1_000, latest: '0.2.0' });
      await checkForUpdate({ ...options, now: 1_000 + DAY });
      expect(registry.calls).toHaveLength(2);
    });

    it('caches a failed check too, so an offline machine is not retried on every command', async () => {
      const calls: number[] = [];
      const options = {
        current: '0.1.0',
        latestUrl: 'https://registry.test/latest',
        cachePath,
        fetchLatest: async () => {
          calls.push(1);
          throw new Error('offline');
        },
      };
      expect(await checkForUpdate({ ...options, now: 5 })).toBeUndefined();
      expect(await checkForUpdate({ ...options, now: 6 })).toBeUndefined();
      expect(calls).toHaveLength(1);
    });

    it('reports nothing when the installed version is current, and ignores a corrupt cache', async () => {
      await writeFile(cachePath, '{not json');
      const registry = counting('0.1.0');
      expect(
        await checkForUpdate({ current: '0.1.0', latestUrl: 'u', cachePath, now: 10, fetchLatest: registry.fetchLatest }),
      ).toBeUndefined();
      expect(registry.calls).toHaveLength(1);
    });

    it('checks again when the clock moved backwards', async () => {
      await writeFile(cachePath, JSON.stringify({ checkedAt: 9_000_000, latest: '0.2.0' }));
      const registry = counting('0.3.0');
      await checkForUpdate({ current: '0.1.0', latestUrl: 'u', cachePath, now: 100, fetchLatest: registry.fetchLatest });
      expect(registry.calls).toHaveLength(1);
    });

    it('never makes the command wait: an unfinished check yields nothing and is cancelled', async () => {
      let aborted = false;
      const read = startUpdateCheck({
        current: '0.1.0',
        latestUrl: 'u',
        cachePath,
        fetchLatest: async (_url, signal) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          aborted = Boolean(signal?.aborted);
          return;
        },
      });
      expect(read()).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(aborted).toBe(true);
    });

    it('yields the cached notice once the check has settled', async () => {
      await writeFile(cachePath, JSON.stringify({ checkedAt: Date.now(), latest: '9.9.9' }));
      const read = startUpdateCheck({ current: '0.1.0', latestUrl: 'u', cachePath });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(read()).toEqual({ current: '0.1.0', latest: '9.9.9' });
    });
  });

  it('keeps the cached answer when the lookup is cancelled by the finished command', async () => {
    await writeFile(cachePath, JSON.stringify({ checkedAt: 0, latest: '0.9.0' }));
    const controller = new AbortController();
    const result = await checkForUpdate({
      current: '0.1.0',
      latestUrl: 'u',
      cachePath,
      now: 2 * DAY,
      signal: controller.signal,
      fetchLatest: async () => {
        controller.abort();
        return;
      },
    });
    expect(result).toEqual({ current: '0.1.0', latest: '0.9.0' });
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual({ checkedAt: 0, latest: '0.9.0' });
  });
});
