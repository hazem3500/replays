import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { definePlugin, type PluginApi, PluginError, resolvePlugins } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { loadSettings } from '../src/server/config.ts';
import { createProfileCatalog, ProfileCatalog, wrapRetentionRules } from '../src/server/profiles.ts';
import { createRuntime } from '../src/server/runtime.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { posterMoment } from '../src/client/render/frames.ts';
import { uploadRequest } from '../src/client/upload/prepare.ts';
import { assertProfileConfig, profileProblem, profileRetentionEnv } from '../src/shared/profiles.ts';
import { assertReplayBundle, matchesFilters, type ReplaySummary, summarizeReplay } from '../src/shared/replay.ts';
import { expiryMs, retentionDays } from '../src/shared/retention.ts';
import { appDefaults, replay } from './fixtures.ts';

const DAY = 24 * 60 * 60_000;
const plugin = (name: string, setup: (api: PluginApi) => void, extra: { order?: number } = {}) => definePlugin({ name, setup, ...extra });

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function summary(extra: Partial<ReplaySummary> = {}): ReplaySummary {
  return { ...summarizeReplay(replay('a-replay')), ...extra };
}

describe('profile shape', () => {
  it('accepts a full declaration and refuses bad fields with the field named', () => {
    expect(() =>
      assertProfileConfig({
        id: 'triage',
        label: 'Triage',
        order: 0,
        retentionDays: 90,
        viewer: { openAt: 'first-error', leadMs: 1000, inspector: 'open', captions: false },
        poster: 'first-error',
      }),
    ).not.toThrow();
    expect(() => assertProfileConfig({ id: 'Triage', label: 'x' })).toThrow(/profile.id/);
    expect(() => assertProfileConfig({ id: 'triage', label: '' })).toThrow(/label/);
    expect(() => assertProfileConfig({ id: 'triage', label: 'x', retentionDays: 1.5 })).toThrow(/retentionDays/);
    expect(() => assertProfileConfig({ id: 'triage', label: 'x', poster: 'first' })).toThrow(/poster/);
    expect(() => assertProfileConfig({ id: 'triage', label: 'x', viewer: { openAt: 'end' } })).toThrow(/openAt/);
    expect(() => assertProfileConfig({ id: 'triage', label: 'x', viewer: { leadMs: -1 } })).toThrow(/leadMs/);
    expect(() => assertProfileConfig({ id: 'triage', label: 'x', viewer: { zoom: 2 } })).toThrow(/unknown keys: zoom/);
    expect(() => assertProfileConfig({ id: 'triage', label: 'x', infer: () => true })).toThrow(/unknown keys: infer/);
  });

  it('names the environment override after the id', () => {
    expect(profileRetentionEnv('triage')).toBe('RETENTION_PROFILE_TRIAGE_DAYS');
    expect(profileRetentionEnv('design-review')).toBe('RETENTION_PROFILE_DESIGN_REVIEW_DAYS');
  });

  it('checks meta.profile against the allowed ids, and refuses any profile when none are defined', () => {
    expect(profileProblem(undefined, [])).toBeUndefined();
    expect(profileProblem('triage', ['triage', 'walkthrough'])).toBeUndefined();
    expect(profileProblem('demo', ['triage', 'walkthrough'])).toBe('replay.meta.profile must be one of triage, walkthrough (got "demo")');
    expect(profileProblem('triage', [])).toMatch(/defines no profiles/);
  });

  it('only checks the shape of meta.profile in the bundle, and keeps it in the summary as explicit', () => {
    const bundle = replay();
    bundle.meta.profile = 'triage';
    expect(() => assertReplayBundle(bundle)).not.toThrow();
    expect(summarizeReplay(bundle)).toMatchObject({ profile: 'triage', profileInferred: false });
    expect(() => assertReplayBundle({ ...bundle, meta: { ...bundle.meta, profile: 'Not An Id' } })).toThrow(/meta.profile/);
    expect(summarizeReplay(replay())).not.toHaveProperty('profile');
  });

  it('filters summaries by profile', () => {
    expect(matchesFilters(summary({ profile: 'triage' }), { profile: 'triage' })).toBe(true);
    expect(matchesFilters(summary({ profile: 'walkthrough' }), { profile: 'triage' })).toBe(false);
    expect(matchesFilters(summary(), { profile: 'triage' })).toBe(false);
  });
});

describe('the profile registry', () => {
  it('collects api.profile and api.retention registrations', async () => {
    const registry = await resolvePlugins([
      plugin('acme', (api) => {
        api.profile({ id: 'triage', label: 'Triage', infer: ({ errors }) => errors > 0 });
        api.retention({ days: () => 10 });
      }),
    ]);
    expect(registry.profiles.map((entry) => [entry.plugin, entry.value.id])).toEqual([['acme', 'triage']]);
    expect(registry.retention).toHaveLength(1);
  });

  it('refuses a malformed profile or rule, and the same id from two plugins', async () => {
    const fails = (setup: (api: PluginApi) => void) => resolvePlugins([plugin('acme', setup)]);
    await expect(fails((api) => api.profile({ id: 'x y', label: 'X' }))).rejects.toMatchObject({ code: 'invalid-registration' });
    await expect(fails((api) => api.profile({ id: 'x', label: 'X', infer: 1 as never }))).rejects.toThrow(/infer must be a function/);
    await expect(fails((api) => api.retention({} as never))).rejects.toThrow(/retention.days must be a function/);
    const twice = resolvePlugins([
      plugin('one', (api) => api.profile({ id: 'triage', label: 'Triage' })),
      plugin('two', (api) => api.profile({ id: 'triage', label: 'Bugs' })),
    ]);
    await expect(twice).rejects.toBeInstanceOf(PluginError);
    await expect(twice).rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(/already registered by one/) });
  });
});

describe('the profile catalog', () => {
  it('merges config and plugin profiles: config fields win, the plugin keeps infer, then sorted by order', async () => {
    const registry = await resolvePlugins([
      plugin('acme', (api) => {
        api.profile({ id: 'walkthrough', label: 'Walkthrough', order: 2 });
        api.profile({ id: 'triage', label: 'Bug', viewer: { openAt: 'first-error', inspector: 'open' }, infer: () => true });
      }),
    ]);
    const catalog = createProfileCatalog({
      builtIns: false,
      config: [
        { id: 'triage', label: 'Triage', retentionDays: 90, viewer: { leadMs: 500 } },
        { id: 'review', label: 'Design review', order: 1 },
      ],
      plugins: registry.profiles,
    });
    expect(catalog.list).toEqual([
      {
        id: 'triage',
        label: 'Triage',
        order: 0,
        retentionDays: 90,
        viewer: { openAt: 'first-error', inspector: 'open', leadMs: 500 },
        inferable: true,
      },
      { id: 'review', label: 'Design review', order: 1 },
      { id: 'walkthrough', label: 'Walkthrough', order: 2 },
    ]);
    expect(catalog.retentionDays()).toEqual({ triage: 90 });
  });

  it('refuses a bad config: not a list, a bad entry, a duplicate id', () => {
    expect(() => createProfileCatalog({ config: {} as never })).toThrow(/must be an array/);
    expect(() => createProfileCatalog({ config: [{ id: 'triage' } as never] })).toThrow(/profiles\[0\].label/);
    expect(() =>
      createProfileCatalog({
        config: [
          { id: 'triage', label: 'A' },
          { id: 'triage', label: 'B' },
        ],
      }),
    ).toThrow(/declared twice/);
  });

  it('lets RETENTION_PROFILE_<ID>_DAYS override a window and warns about one for no profile', () => {
    const log = vi.fn<(line: string) => void>();
    const catalog = createProfileCatalog({
      config: [
        { id: 'design-review', label: 'Design review', retentionDays: 30 },
        { id: 'walkthrough', label: 'Walkthrough' },
      ],
      env: { RETENTION_PROFILE_DESIGN_REVIEW_DAYS: '7', RETENTION_PROFILE_WALKTHROUGH_DAYS: '0', RETENTION_PROFILE_NOPE_DAYS: '3' },
      log,
    });
    expect(catalog.retentionDays()).toEqual({ 'design-review': 7, walkthrough: 0 });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/RETENTION_PROFILE_NOPE_DAYS is set, but no profile has that id/));
    expect(() => createProfileCatalog({ config: [{ id: 'a', label: 'A' }], env: { RETENTION_PROFILE_A_DAYS: 'soon' } })).toThrow(
      /RETENTION_PROFILE_A_DAYS must be a whole number/,
    );
  });

  it('infers in order (first match wins), never over an explicit profile, and survives a throwing infer', async () => {
    const calls: string[] = [];
    const registry = await resolvePlugins([
      plugin('acme', (api) => {
        api.profile({
          id: 'broken',
          label: 'Broken',
          order: -1,
          infer: () => {
            calls.push('broken');
            throw new Error('boom');
          },
        });
        api.profile({ id: 'walkthrough', label: 'Walkthrough', order: 2, infer: () => (calls.push('walkthrough'), true) });
        api.profile({ id: 'triage', label: 'Triage', order: 1, infer: ({ errors }) => (calls.push('triage'), errors > 0) });
      }),
    ]);
    const log = vi.fn<(line: string) => void>();
    const catalog = createProfileCatalog({ plugins: registry.profiles, log });
    expect(catalog.apply(summary({ consoleErrors: 1 }))).toMatchObject({ profile: 'triage', profileInferred: true });
    expect(calls).toEqual(['broken', 'triage']);
    expect(catalog.apply(summary())).toMatchObject({ profile: 'walkthrough', profileInferred: true });
    expect(catalog.apply(summary({ profile: 'broken', profileInferred: false }))).toMatchObject({
      profile: 'broken',
      profileInferred: false,
    });
    // why: a failing infer is logged once, however often it fails.
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatch(/plugin acme: profile broken: infer failed: boom/);
    // why: a stored inferred profile (from an older config) is recomputed.
    expect(new ProfileCatalog().apply(summary({ profile: 'old', profileInferred: true }))).not.toHaveProperty('profile');
  });
});

describe('retention math', () => {
  const policy = { days: 30, profiles: { triage: 90, walkthrough: 0, short: 5 } };
  const rules = (...values: Array<number | undefined>) => ({ ...policy, rules: values.map((value) => () => value) });

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
    expect(retentionDays(rules(0, undefined), { profile: 'triage', summary: s })).toBe(90);
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
    const [throwing, nonsense, fine] = wrapRetentionRules(
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
    expect(throwing!(summary())).toBeUndefined();
    expect(throwing!(summary())).toBeUndefined();
    expect(nonsense!(summary())).toBeUndefined();
    expect(fine!(summary({ consoleErrors: 1 }))).toBe(3);
    expect(fine!(summary())).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
  });

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
    const save = (id: string, change: (bundle: ReturnType<typeof replay>) => void = () => undefined) => {
      const bundle = replay(id);
      change(bundle);
      return store.save(bundle);
    };
    await save('plain');
    await save('triage', (bundle) => (bundle.meta.profile = 'triage'));
    await save('walkthrough', (bundle) => (bundle.meta.profile = 'walkthrough'));
    await save('guessed', (bundle) => (bundle.meta.title = 'Guide: sign up'));
    await save('scratch', (bundle) => {
      bundle.meta.profile = 'walkthrough';
      bundle.meta.tags = ['scratch'];
    });

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

async function start(profiles: ProfileCatalog) {
  const root = await mkdtemp(join(tmpdir(), 'replays-profiles-app-'));
  await mkdir(join(root, 'client'), { recursive: true });
  await writeFile(
    join(root, 'client', 'index.html'),
    '<!doctype html><html><head><meta name="app-base" content="" /><meta name="app-profiles" content="" /><title>__PRODUCT_NAME__</title></head><body></body></html>',
  );
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), 30, { profiles });
  const handle = createApp({ ...appDefaults(), store, clientDir: join(root, 'client') });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}
const post = (origin: string, body: unknown) =>
  fetch(`${origin}/api/replays`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const withProfile = (id: string, profile?: string) => {
  const bundle = replay(id);
  if (profile) bundle.meta.profile = profile;
  return bundle;
};

describe('profiles in the app', () => {
  it('refuses meta.profile when the server defines none, and lists no profiles', async () => {
    const origin = await start(new ProfileCatalog());
    const response = await post(origin, withProfile('with-profile', 'triage'));
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/defines no profiles/);
    expect((await post(origin, withProfile('without-profile'))).status).toBe(201);
    expect(await (await fetch(`${origin}/api/config`)).json()).toMatchObject({ profiles: [] });
    const html = await (await fetch(`${origin}/`, { headers: { accept: 'text/html' } })).text();
    expect(html).toContain('<meta name="app-profiles" content="" />');
  });

  it('accepts a defined profile, names the allowed ids for another, filters with ?profile= and serves inferred ones as a header', async () => {
    const registry = await resolvePlugins([
      plugin('acme', (api) => api.profile({ id: 'triage', label: 'Triage', order: 1, infer: ({ title }) => title === 'Broken' })),
    ]);
    const origin = await start(
      createProfileCatalog({
        builtIns: false,
        config: [{ id: 'walkthrough', label: 'Walkthrough', viewer: { captions: true } }],
        plugins: registry.profiles,
      }),
    );
    expect((await post(origin, withProfile('explicit', 'walkthrough'))).status).toBe(201);
    const refused = await post(origin, withProfile('unknown', 'demo'));
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe('replay.meta.profile must be one of walkthrough, triage (got "demo")');
    const broken = replay('inferred');
    broken.meta.title = 'Broken';
    expect((await post(origin, broken)).status).toBe(201);

    const ids = async (query: string) =>
      ((await (await fetch(`${origin}/api/replays${query}`)).json()) as ReplaySummary[]).map((item) => item.id).toSorted();
    expect(await ids('?profile=walkthrough')).toEqual(['explicit']);
    expect(await ids('?profile=triage')).toEqual(['inferred']);
    expect(await ids('')).toEqual(['explicit', 'inferred']);

    const config = (await (await fetch(`${origin}/api/config`)).json()) as { profiles: unknown[] };
    expect(config.profiles).toEqual([
      { id: 'walkthrough', label: 'Walkthrough', order: 0, viewer: { captions: true } },
      { id: 'triage', label: 'Triage', order: 1, inferable: true },
    ]);
    const html = await (await fetch(`${origin}/`, { headers: { accept: 'text/html' } })).text();
    expect(html).toContain('name="app-profiles" content="[{&quot;id&quot;:&quot;walkthrough&quot;');

    expect((await fetch(`${origin}/api/replays/inferred`)).headers.get('x-replay-profile')).toBe('triage; inferred');
    expect((await fetch(`${origin}/api/replays/explicit`)).headers.get('x-replay-profile')).toBeNull();

    // why: the rrweb import takes the profile as a query parameter, checked the same way.
    const events = JSON.stringify([
      { type: 4, timestamp: 1000, data: { href: 'https://example.com/', width: 800, height: 600 } },
      { type: 2, timestamp: 1100, data: {} },
    ]);
    const imported = await fetch(`${origin}/api/replays/import?title=Imported&profile=walkthrough`, { method: 'POST', body: events });
    expect(imported.status).toBe(201);
    const { id } = (await imported.json()) as { id: string };
    expect(((await (await fetch(`${origin}/api/replays/${id}`)).json()) as { meta: { profile?: string } }).meta.profile).toBe(
      'walkthrough',
    );
    const badImport = await fetch(`${origin}/api/replays/import?title=Imported&profile=demo`, { method: 'POST', body: events });
    expect(badImport.status).toBe(400);
    expect(await badImport.text()).toMatch(/^profile must be one of walkthrough, triage/);
  });

  it('builds the catalog and the retention policy from config, plugins and environment at start', async () => {
    const runtime = await createRuntime({
      env: { RETENTION_PROFILE_TRIAGE_DAYS: '14' },
      config: {
        dir: tmpdir(),
        file: { profiles: [{ id: 'walkthrough', label: 'Walkthrough', retentionDays: 0 }] },
        plugins: [
          plugin('acme', (api) => {
            api.profile({ id: 'triage', label: 'Triage', retentionDays: 90 });
            api.retention({ days: () => undefined });
          }),
        ],
      },
    });
    expect(runtime.settings.profiles.ids).toEqual(['walkthrough', 'triage', 'performance']);
    expect(runtime.settings.retention).toMatchObject({ days: 30, profiles: { walkthrough: 0, triage: 14 }, rules: [expect.any(Function)] });
    await expect(loadSettings({}, { profiles: [{ id: 'x', label: 'X', poster: 'nope' as never }] })).rejects.toThrow(
      /profiles\[0\].poster/,
    );
  });
});

describe('poster moment and the upload request', () => {
  const base = { stepTimes: [1000, 5000, 9000], snapshotTimes: [0], duration: 10_000, errorTimes: [7000, 3000] };

  it('takes the poster at the middle step by default, after the first error, or after the last step', () => {
    expect(posterMoment(base)).toBe(5900);
    expect(posterMoment({ ...base, moment: 'middle-step' })).toBe(5900);
    expect(posterMoment({ ...base, moment: 'first-error' })).toBe(3600);
    expect(posterMoment({ ...base, moment: 'first-error', errorTimes: [] })).toBe(5900);
    expect(posterMoment({ ...base, moment: 'last-step' })).toBe(9900);
  });

  it('sets, keeps or clears meta.profile on a bundle and passes it to the import', () => {
    const bundle = replay();
    bundle.meta.profile = 'triage';
    const prepared = {
      kind: 'bundle' as const,
      fileName: 'r.json',
      size: 1,
      eventCount: 2,
      duration: 1,
      viewport: { width: 1, height: 1 },
      title: 'T',
      text: '',
      bundle,
    };
    const meta = (profile?: string) =>
      (
        JSON.parse(uploadRequest(prepared, { title: 'T', url: '', ...(profile === undefined ? {} : { profile }) }).body) as {
          meta: { profile?: string };
        }
      ).meta;
    expect(meta().profile).toBe('triage');
    expect(meta('walkthrough').profile).toBe('walkthrough');
    expect(meta('')).not.toHaveProperty('profile');
    const rrweb = { ...prepared, kind: 'rrweb' as const, bundle: undefined } as unknown as typeof prepared;
    expect(uploadRequest(rrweb, { title: 'T', url: '', profile: 'triage' }).path).toBe('replays/import?title=T&profile=triage');
  });
});
