import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { definePlugin, type PluginApi, resolvePlugins } from '../src/plugin/index.ts';

import { createProfileCatalog, wrapRetentionRules } from '../src/server/profiles.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { type ReplayBundle, type ReplaySummary, summarizeReplay } from '../src/shared/replay.ts';
import { expiryMs, retentionDays } from '../src/shared/retention.ts';
import { replay } from './fixtures.ts';

const DAY = 24 * 60 * 60_000;
const plugin = (name: string, setup: (api: PluginApi) => void) => definePlugin({ name, setup });

function summary(extra: Partial<ReplaySummary> = {}): ReplaySummary {
  return { ...summarizeReplay(replay('a-replay')), ...extra };
}

describe('retention math', () => {
  const policy = { days: 30, profiles: { triage: 90, walkthrough: 0, short: 5 } };
  const rules = (...values: Array<number | 'abstain'>) => ({
    ...policy,
    rules: values.map((value) => () => (value === 'abstain' ? undefined : value)),
  });

  it('uses the profile window, the default without one, and keeps an explicit forever profile', () => {
    expect(retentionDays(policy)).toBe(30);
    expect(retentionDays(policy, { profile: 'triage' })).toBe(90);
    expect(retentionDays(policy, { profile: 'unknown' })).toBe(30);
    expect(retentionDays(policy, { profile: 'walkthrough' })).toBe(0);
  });

  it('never lets an inferred profile make a replay permanent', () => {
    expect(retentionDays(policy, { profile: 'walkthrough', profileInferred: true })).toBe(30);
    expect(retentionDays(policy, { profile: 'triage', profileInferred: true })).toBe(90);
    expect(retentionDays(policy, { profile: 'short', profileInferred: true })).toBe(5);
  });

  it('lets rules shorten but never lengthen: the shortest window wins and 0 means no limit', () => {
    const s = summary();
    expect(retentionDays(rules(10), { profile: 'triage', summary: s })).toBe(10);
    expect(retentionDays(rules(200), { profile: 'triage', summary: s })).toBe(90);
    expect(retentionDays(rules(0, 'abstain'), { profile: 'triage', summary: s })).toBe(90);
    expect(retentionDays(rules(14, 7), { profile: 'walkthrough', summary: s })).toBe(7);
    expect(retentionDays({ days: 0, rules: [() => 3] }, { summary: s })).toBe(3);
    // why: rules need the summary; without one (suites, broken uploads) they do not apply.
    expect(retentionDays(rules(1), { profile: 'triage' })).toBe(90);
  });

  it('Keep still overrides everything', () => {
    const uploadedMs = Date.parse('2026-01-01T00:00:00.000Z');
    expect(expiryMs({ ...policy, rules: [() => 1] }, { uploadedMs, kept: { by: 'a', at: 'b' }, summary: summary() })).toBeUndefined();
    expect(expiryMs(policy, { uploadedMs, profile: 'triage' })).toBe(uploadedMs + 90 * DAY);
  });

  it('wraps plugin rules: a throwing or nonsense rule is logged once and means no limit', () => {
    const log = vi.fn<(line: string) => void>();
    const wrapped = wrapRetentionRules(
      [
        {
          plugin: 'a',
          value: {
            days: () => {
              throw new Error('nope');
            },
          },
        },
        { plugin: 'b', value: { days: () => -2 } },
        { plugin: 'c', value: { days: (s) => (s.consoleErrors ? 3 : undefined) } },
      ],
      log,
    );
    expect(wrapped).toHaveLength(3);
    const [throwing, nonsense, fine] = wrapped;
    expect(throwing?.(summary())).toBeUndefined();
    expect(throwing?.(summary())).toBeUndefined();
    expect(nonsense?.(summary())).toBeUndefined();
    expect(fine?.(summary({ consoleErrors: 1 }))).toBe(3);
    expect(fine?.(summary())).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('retention per profile in the store', () => {
  it('prunes per profile and rule; an inferred forever profile gets the default window', async () => {
    const NOW = Date.parse('2026-10-13T00:00:00.000Z');
    const root = await mkdtemp(join(tmpdir(), 'replays-profiles-'));
    const registry = await resolvePlugins([
      plugin('acme', (api) => {
        api.profile({ id: 'walkthrough', label: 'Walkthrough', infer: ({ title }) => title.startsWith('Guide') });
        api.retention({ days: (s) => (s.tags?.includes('scratch') ? 2 : undefined) });
      }),
    ]);
    const profiles = createProfileCatalog({
      config: [
        { id: 'triage', label: 'Triage', retentionDays: 90 },
        { id: 'walkthrough', label: 'Walkthrough', retentionDays: 0 },
      ],
      plugins: registry.profiles,
    });
    const store = new ReplayStore(
      new MemoryStorage(() => NOW),
      join(root, 'sample'),
      { days: 30, profiles: profiles.retentionDays(), rules: wrapRetentionRules(registry.retention) },
      { profiles },
    );
    const save = (id: string, meta: Partial<ReplayBundle['meta']> = {}) => {
      const bundle = replay(id);
      return store.save({ ...bundle, meta: { ...bundle.meta, ...meta } });
    };
    await save('plain');
    await save('triage', { profile: 'triage' });
    await save('walkthrough', { profile: 'walkthrough' });
    await save('guessed', { title: 'Guide: sign up' });
    await save('scratch', { profile: 'walkthrough', tags: ['scratch'] });

    const listed = Object.fromEntries((await store.list()).map((item) => [item.id, item]));
    expect(listed.guessed).toMatchObject({ profile: 'walkthrough', profileInferred: true });
    expect(listed.walkthrough).toMatchObject({ profile: 'walkthrough', profileInferred: false, expiresAt: null });
    expect(listed.triage?.expiresAt).toBe(new Date(NOW + 90 * DAY).toISOString());
    expect(listed.guessed?.expiresAt).toBe(new Date(NOW + 30 * DAY).toISOString());
    expect(listed.scratch?.expiresAt).toBe(new Date(NOW + 2 * DAY).toISOString());
    expect((await store.list({ profile: 'walkthrough' })).map((item) => item.id).toSorted()).toEqual(['guessed', 'scratch', 'walkthrough']);

    expect(await store.prune(NOW + 3 * DAY)).toEqual(['scratch']);
    expect((await store.prune(NOW + 31 * DAY)).toSorted()).toEqual(['guessed', 'plain']);
    expect(await store.prune(NOW + 91 * DAY)).toEqual(['triage']);
    expect(await store.prune(NOW + 5000 * DAY)).toEqual([]);
  });
});
