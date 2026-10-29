import { describe, expect, it } from 'vitest';

import { indexProfiles } from '../src/client/profiles.ts';
import { definePlugin, PluginError, resolvePlugins } from '../src/plugin/index.ts';
import { createProfileCatalog } from '../src/server/profiles.ts';
import { createViewCatalog } from '../src/server/views.ts';
import { assertCaptureProfile, contentTypeAllowed } from '../src/shared/capture-profile.ts';
import { assertProfileConfig } from '../src/shared/profiles.ts';
import { assertViewPreset, BUILT_IN_VIEWS } from '../src/shared/views.ts';

describe('view presets', () => {
  it('accepts every built-in view', () => {
    for (const view of BUILT_IN_VIEWS) expect(() => assertViewPreset(view)).not.toThrow();
  });

  it('refuses unknown keys with the path named', () => {
    expect(() => assertViewPreset({ id: 'triage', label: 'Triage', inspector: { width: 3 } })).toThrow(
      'view.inspector has unknown keys: width',
    );
  });

  it('refuses a label longer than the switcher allows', () => {
    expect(() => assertViewPreset({ id: 'triage', label: 'x'.repeat(25) })).toThrow(/at most 24/);
  });

  it('refuses a tab id that is neither built-in shaped nor a plugin key', () => {
    expect(() => assertViewPreset({ id: 'triage', label: 'Triage', inspector: { tabs: ['Console!'] } })).toThrow(/inspector.tabs/);
  });
});

describe('the view catalog', () => {
  it('lists the built-ins in order when nothing is configured', () => {
    expect(createViewCatalog().list.map((view) => view.id)).toEqual([
      'standard',
      'compare',
      'performance',
      'debug',
      'walkthrough',
      'review',
      'support',
    ]);
  });

  it('lets a config entry retune one field of a built-in and keeps the rest', () => {
    const debug = createViewCatalog({ config: [{ id: 'debug', label: 'Triage', inspector: { tab: 'network' } }] }).get('debug');
    expect(debug).toMatchObject({ label: 'Triage', openAt: 'first-error', inspector: { state: 'open', tab: 'network' } });
    expect(debug).not.toHaveProperty('builtIn');
  });

  it('refuses a profile whose view is not defined', () => {
    const profiles = createProfileCatalog({ config: [{ id: 'triage', label: 'Triage', view: 'nope' }] }).list;
    expect(() => createViewCatalog({ profiles })).toThrow('profile "triage" opens in view "nope", which is not defined');
  });

  it('adds plugin views and refuses one that takes a built-in id', async () => {
    const registry = await resolvePlugins([
      definePlugin({ name: 'acme', setup: (api) => api.view({ id: 'flaky', label: 'Flaky runs', layout: 'grid' }) }),
    ]);
    expect(createViewCatalog({ plugins: registry.views }).has('flaky')).toBe(true);
    const taken = resolvePlugins([definePlugin({ name: 'acme', setup: (api) => api.view({ id: 'debug', label: 'Mine' }) })]);
    await expect(taken).rejects.toBeInstanceOf(PluginError);
  });
});

describe('the built-in performance profile', () => {
  it('is in every catalog unless the merge rules are tested alone', () => {
    expect(createProfileCatalog({}).get('performance')).toMatchObject({ view: 'performance', builtIn: true });
    expect(createProfileCatalog({ builtIns: false }).size).toBe(0);
  });

  it('takes a config entry with its id as an override', () => {
    const performance = createProfileCatalog({ config: [{ id: 'performance', label: 'Speed', retentionDays: 7 }] }).get('performance');
    expect(performance).toMatchObject({ label: 'Speed', retentionDays: 7, view: 'performance' });
    expect(performance).not.toHaveProperty('builtIn');
  });

  it('only becomes an index tab once some replay has it', () => {
    const profiles = createProfileCatalog({ config: [{ id: 'triage', label: 'Triage' }] }).list;
    expect(indexProfiles(profiles, { all: 3, triage: 1 }).map((profile) => profile.id)).toEqual(['triage']);
    expect(indexProfiles(profiles, { all: 3, performance: 2 }).map((profile) => profile.id)).toEqual(['triage', 'performance']);
  });
});

describe('capture profiles', () => {
  it('validates as part of a profile', () => {
    expect(() =>
      assertProfileConfig({ id: 'perf', label: 'Perf', capture: { network: 'bodies', bodies: { maxBytes: 1024 } } }),
    ).not.toThrow();
    expect(() => assertProfileConfig({ id: 'perf', label: 'Perf', capture: { network: 'everything' } })).toThrow(/capture.network/);
  });

  it('refuses body limits without asking for bodies', () => {
    expect(() => assertCaptureProfile({ bodies: { maxBytes: 10 } })).toThrow(/only applies with network: "bodies"/);
  });

  it('refuses a body cap above the default', () => {
    expect(() => assertCaptureProfile({ network: 'bodies', bodies: { maxBytes: 10_000_000 } })).toThrow(/maxBytes/);
  });

  it('refuses binary body types, which would widen the allowlist', () => {
    expect(() => assertCaptureProfile({ network: 'bodies', bodies: { contentTypes: ['image/*'] } })).toThrow(/only narrow/);
  });

  it('refuses privacy settings that loosen masking', () => {
    expect(() => assertCaptureProfile({ privacy: { maskAllText: false } })).toThrow(/can only tighten/);
  });

  it('matches content types by family, structured suffix and exact type, ignoring parameters', () => {
    const allowed = ['text/*', 'application/*+json', 'application/json'];
    expect(
      ['text/plain; charset=utf-8', 'application/problem+json', 'application/json'].every((type) => contentTypeAllowed(type, allowed)),
    ).toBe(true);
    expect(contentTypeAllowed('application/octet-stream', allowed)).toBe(false);
  });
});
