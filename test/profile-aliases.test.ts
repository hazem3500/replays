import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { profileFlag } from '../src/capture/bundle-io.ts';
import { profileFromSearch } from '../src/client/ReplayIndex.tsx';
import { definePlugin, type ProfileDefinition, resolvePlugins } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { configProfiles, createProfileCatalog, type ProfileCatalog } from '../src/server/profiles.ts';
import { nextOverrides, withOverrides } from '../src/server/replay-meta.ts';
import { ReplayStore } from '../src/server/store.ts';
import type { AliasedProfile } from '../src/shared/profiles.ts';
import { summarizeReplay } from '../src/shared/replay.ts';
import { appDefaults, replay } from './fixtures.ts';

// why: profiles were called purposes, and every old public name keeps working until the deprecation window ends.

const servers: Array<ReturnType<typeof createServer>> = [];

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

const catalog = () =>
  createProfileCatalog({
    config: [{ id: 'triage', label: 'Triage', retentionDays: 90 }],
    plugins: [{ plugin: 'acme', value: { id: 'walkthrough', label: 'Walkthrough', infer: ({ title }) => title === 'Guide' } }],
  });

async function start(profiles: ProfileCatalog) {
  const root = await mkdtemp(join(tmpdir(), 'replays-profile-aliases-'));
  await mkdir(join(root, 'client'), { recursive: true });
  await writeFile(join(root, 'client', 'index.html'), '<!doctype html><html><head><meta name="app-base" content="" /></head></html>');
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

function legacy(id: string, purpose: string) {
  const bundle = replay(id);
  const meta: AliasedProfile = bundle.meta;
  meta.purpose = purpose;
  return bundle;
}

describe('the deprecated purpose names over HTTP', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it('stores an upload with meta.purpose as meta.profile', async () => {
    const origin = await start(catalog());
    expect((await post(origin, legacy('old-producer', 'triage'))).status).toBe(201);
    const stored: unknown = await (await fetch(`${origin}/api/replays/old-producer`)).json();
    expect(stored).toMatchObject({ meta: { profile: 'triage' } });
    expect(stored).not.toHaveProperty('meta.purpose');
  });

  it('refuses an upload whose meta.profile and meta.purpose disagree', async () => {
    const origin = await start(catalog());
    const bundle = legacy('both', 'triage');
    bundle.meta.profile = 'walkthrough';
    expect((await post(origin, bundle)).status).toBe(400);
  });

  it('keeps serving summary.purpose next to summary.profile', async () => {
    const origin = await start(catalog());
    await post(origin, legacy('old-producer', 'triage'));
    const listed: unknown = await (await fetch(`${origin}/api/replays`)).json();
    expect(listed).toMatchObject([{ profile: 'triage', profileInferred: false, purpose: 'triage', purposeInferred: false }]);
  });

  it('filters the list with ?purpose=', async () => {
    const origin = await start(catalog());
    await post(origin, legacy('kept', 'triage'));
    await post(origin, replay('other'));
    const listed: unknown = await (await fetch(`${origin}/api/replays?purpose=triage`)).json();
    expect(listed).toEqual([expect.objectContaining({ id: 'kept' })]);
  });

  it('lists the profiles under purposes in /api/config too', async () => {
    const origin = await start(catalog());
    const config: unknown = await (await fetch(`${origin}/api/config`)).json();
    expect(config).toMatchObject({ purposes: [{ id: 'triage' }, { id: 'walkthrough' }], profiles: [{ id: 'triage' }, { id: 'walkthrough' }] });
  });

  it('sends an inferred profile under x-replay-purpose too', async () => {
    const origin = await start(catalog());
    const guide = replay('guide');
    guide.meta.title = 'Guide';
    await post(origin, guide);
    const response = await fetch(`${origin}/api/replays/guide`);
    expect(response.headers.get('x-replay-purpose')).toBe('walkthrough; inferred');
  });
});

describe('stored data written before the rename', () => {
  it('reads a sidecar that only says purpose as the explicit profile', () => {
    const { profile: _profile, profileInferred: _inferred, ...old } = summarizeReplay(replay('old'));
    const sidecar = { ...old, purpose: 'triage', purposeInferred: false };
    const applied = catalog().apply(sidecar);
    expect(applied).toMatchObject({ profile: 'triage', profileInferred: false });
  });

  it('applies an overrides file that says purpose', () => {
    const summary = summarizeReplay(replay('old'));
    expect(withOverrides(summary, { purpose: 'triage', by: 'ada', at: '2026-10-01T00:00:00Z' })).toMatchObject({ profile: 'triage' });
  });

  it('writes a purpose patch as profile and drops the old key', () => {
    const next = nextOverrides({ purpose: 'walkthrough', by: 'ada', at: '' }, { purpose: 'triage' }, 'sam', new Date(0));
    expect(next).toEqual({ profile: 'triage', by: 'sam', at: '1970-01-01T00:00:00.000Z' });
  });
});

describe('configuration and plugins', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the purposes config key and warns that it is deprecated', () => {
    const warn = vi.fn<(line: string) => void>();
    expect(configProfiles({ purposes: [{ id: 'triage', label: 'Triage' }] }, warn)).toEqual([{ id: 'triage', label: 'Triage' }]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/purposes key is deprecated/));
  });

  it('refuses a config with both profiles and purposes', () => {
    expect(() => configProfiles({ profiles: [], purposes: [] })).toThrow(/both profiles and purposes/);
  });

  it('honours RETENTION_PURPOSE_<ID>_DAYS, and the new variable wins', () => {
    const config = [{ id: 'triage', label: 'Triage' }];
    expect(createProfileCatalog({ config, env: { RETENTION_PURPOSE_TRIAGE_DAYS: '7' } }).get('triage')?.retentionDays).toBe(7);
    const both = { RETENTION_PURPOSE_TRIAGE_DAYS: '7', RETENTION_PROFILE_TRIAGE_DAYS: '9' };
    expect(createProfileCatalog({ config, env: both }).get('triage')?.retentionDays).toBe(9);
  });

  it('registers api.purpose as a profile and warns once per plugin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = await resolvePlugins([
      definePlugin({
        name: 'old-plugin',
        setup(api) {
          const old: { purpose(definition: ProfileDefinition): void } = api;
          old.purpose({ id: 'triage', label: 'Triage' });
          old.purpose({ id: 'walkthrough', label: 'Walkthrough' });
        },
      }),
    ]);
    expect(registry.profiles.map((entry) => entry.value.id)).toEqual(['triage', 'walkthrough']);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('producers and links', () => {
  it('takes --purpose as --profile with a warning', () => {
    const warn = vi.fn<(line: string) => void>();
    expect(profileFlag({ purpose: 'triage' }, warn)).toBe('triage');
    expect(warn).toHaveBeenCalledWith('warning: --purpose is deprecated; use --profile');
  });

  it('refuses --profile and --purpose with different ids', () => {
    const silent = vi.fn<(line: string) => void>();
    expect(() => profileFlag({ profile: 'triage', purpose: 'walkthrough' }, silent)).toThrow(/disagree/);
  });

  it('opens the same index tab for an old ?purpose= link', () => {
    expect(profileFromSearch('?purpose=triage', [{ id: 'triage', label: 'Triage', order: 0 }])).toBe('triage');
  });
});
