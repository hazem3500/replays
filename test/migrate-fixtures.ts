import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FsStorage, type MemoryStorage } from '../src/server/storage/index.ts';
import { replay } from './fixtures.ts';

/** Write options for JSON fixtures. */
export const JSON_TYPE = { contentType: 'application/json' };
export const SLACK = 'https://example-team.slack.com/archives/C0123ABCD/p1700000000000100';

/** A legacy bundle: its meta carries the old `source`/`profile`, and its context the old shape. */
export interface LegacyBundle extends Record<string, unknown> {
  meta: Record<string, unknown>;
}

/** A bundle in the downstream's pre-upstream shape (see the example translator). */
export function legacyBundle(id: string): LegacyBundle {
  const { meta, ...rest } = replay(id);
  return {
    ...rest,
    meta: { ...meta, source: 'toki', profile: 'triage', tags: ['smoke'] },
    context: {
      version: 1,
      capturedAt: '2026-10-06T00:00:00.000Z',
      app: { product: 'Example App', environment: 'staging', origin: 'https://app.example.com' },
      test: { suite: 'checkout' },
      account: { id: 7, label: 'Account 7', flags: [{ key: 'beta', state: 'enabled' }] },
      organization: { id: 3, plan: { state: 'known', name: 'pro' } },
      sources: [
        { kind: 'slack-thread', visibility: 'public', url: SLACK, id: 'T1', capturedAt: '2026-10-06T00:00:00.000Z' },
        {
          kind: 'github-pr',
          url: 'https://github.com/acme/web/pull/12',
          repository: 'acme/web',
          number: 12,
          capturedAt: '2026-10-06T00:00:00.000Z',
        },
      ],
    },
  };
}

export const legacySuite: Record<string, unknown> = {
  version: 1,
  id: 'suite-one',
  title: 'Review of acme/web#12',
  createdAt: '2026-10-06T00:00:00.000Z',
  review: {
    kind: 'github-pr',
    url: 'https://github.com/acme/web/pull/12',
    repository: 'acme/web',
    number: 12,
    capturedAt: '2026-10-06T00:00:00.000Z',
  },
  people: [{ role: 'pr-author', github: 'octocat' }],
  runs: [],
};

/** A data directory as the old server left it. */
export async function legacyStore(): Promise<{ dir: string; source: FsStorage }> {
  const dir = await mkdtemp(join(tmpdir(), 'replays-migrate-'));
  const source = new FsStorage(dir);
  const write = (key: string, value: unknown) => source.write(key, typeof value === 'string' ? value : JSON.stringify(value), JSON_TYPE);
  await write('old-one/replay.json', legacyBundle('old-one'));
  await write('old-one/meta.json', { id: 'old-one', stale: true });
  await write('old-one/comments.json', { version: 1, comments: [] });
  await write('old-one/edits.json', { version: 1, revision: 1 });
  await write('old-one/keep.json', { by: 'someone@example.com', at: '2026-10-07T00:00:00.000Z' });
  await source.write('old-one/poster.v2.jpg', Buffer.from([0xff, 0xd8, 0xff]));
  await write('human-one/replay.json', { ...replay('human-one'), meta: { ...replay('human-one').meta, source: 'human' } });
  // why: not a recording (one event), so it is reported and never written.
  await write('broken/replay.json', { ...replay('broken'), events: [{ type: 4, timestamp: 1 }] });
  await write('broken/comments.json', { version: 1, comments: [] });
  // why: a committed sample's comments and a plugin's own data are not replays but must move too.
  await write('sample-one/comments.json', { version: 1, comments: [] });
  await write('_malleable/w/tool.json', { id: 'tool' });
  await write('_suites/suite-one.json', legacySuite);
  await write('_suites/suite-one.keep.json', { by: 'someone@example.com', at: '2026-10-07T00:00:00.000Z' });
  await write('old-one/replay.json.123.tmp', 'partial');
  return { dir, source };
}

/** Every key in `storage`, sorted. */
export const keysOf = async (storage: MemoryStorage | FsStorage): Promise<string[]> =>
  (await storage.list()).map((object) => object.key).toSorted();
