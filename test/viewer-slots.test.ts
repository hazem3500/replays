import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FieldSchema } from '../src/client/config.ts';
import { MAX_TRACK_MARKERS, type SettingDefinition, type ViewerPluginApi } from '../src/client/plugins/api.ts';
import { ViewerRegistry } from '../src/client/plugins/registry.ts';
import { pluginSettings, readSetting, settingKey, subscribeSettings, writeSetting } from '../src/client/plugins/settings.ts';
import { placeMarkers } from '../src/client/plugins/tracks.ts';
import { fieldGroups, fieldRows, signalsOf } from '../src/client/viewer/context-fields.ts';
import { ContextPanel } from '../src/client/viewer/ContextPanel.tsx';
import { assertReplayContext, type ReplayContext, sourceAttrs } from '../src/shared/context.ts';
import { isSafeIconUrl } from '../src/shared/icon-url.ts';
import { summarizeReplay } from '../src/shared/replay.ts';
import { SourceProviders, templateProvider } from '../src/shared/source-providers.ts';
import { replay } from './fixtures.ts';

const render = () => {};
const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function memoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });
  return values;
}

describe('viewer registry: bar actions, tracks, context sections, settings', () => {
  it('registers each new kind under `plugin:<plugin>:<id>`', () => {
    const registry = new ViewerRegistry();
    const api = registry.apiFor('acme');
    api.registerViewerAction({ id: 'go', label: 'Go', placement: 'bar', icon: SVG, run: () => {} });
    api.registerTimelineTrack({ id: 'errors', label: 'Errors', markers: () => [] });
    api.registerContextSection({ id: 'release', title: 'Release', render });
    api.registerSetting({ id: 'compact', label: 'Compact', type: 'boolean', default: false });
    api.registerSetting({ id: 'units', label: 'Units', type: 'choice', options: [{ value: 's' }, { value: 'ms' }], default: 's' });
    const snapshot = registry.getSnapshot();
    expect(snapshot.actions[0]?.definition.placement).toBe('bar');
    expect(snapshot.tracks.map((entry) => entry.key)).toEqual(['plugin:acme:errors']);
    expect(snapshot.contextSections.map((entry) => entry.key)).toEqual(['plugin:acme:release']);
    expect(snapshot.settings.map((entry) => entry.key)).toEqual(['plugin:acme:compact', 'plugin:acme:units']);
  });

  it.each([
    [
      'an unknown placement',
      (api: ViewerPluginApi) => api.registerViewerAction({ id: 'a', label: 'A', placement: 'top' as never, run: () => {} }),
      /placement must be/,
    ],
    [
      'an icon that is markup or a script URL',
      (api: ViewerPluginApi) => api.registerViewerAction({ id: 'a', label: 'A', icon: '<svg onload=alert(1)>', run: () => {} }),
      /icon must be a data:image\/svg\+xml URL or an https URL/,
    ],
    [
      'a track without markers',
      (api: ViewerPluginApi) => api.registerTimelineTrack({ id: 't', label: 'T' } as never),
      /needs a markers function/,
    ],
    ['a section without a title', (api: ViewerPluginApi) => api.registerContextSection({ id: 's', title: '', render }), /needs a label/],
    [
      'a boolean setting with a string default',
      (api: ViewerPluginApi) => api.registerSetting({ id: 'b', label: 'B', type: 'boolean', default: 'yes' as never }),
      /boolean default/,
    ],
    [
      'a choice with one option',
      (api: ViewerPluginApi) => api.registerSetting({ id: 'c', label: 'C', type: 'choice', options: [{ value: 'a' }], default: 'a' }),
      /at least two options/,
    ],
    [
      'a choice whose default is not an option',
      (api: ViewerPluginApi) =>
        api.registerSetting({ id: 'c', label: 'C', type: 'choice', options: [{ value: 'a' }, { value: 'b' }], default: 'z' }),
      /default must be one of the option values/,
    ],
    [
      'repeated option values',
      (api: ViewerPluginApi) =>
        api.registerSetting({ id: 'c', label: 'C', type: 'choice', options: [{ value: 'a' }, { value: 'a' }], default: 'a' }),
      /unique/,
    ],
    [
      'an unknown setting type',
      (api: ViewerPluginApi) => api.registerSetting({ id: 'c', label: 'C', type: 'slider' } as never),
      /type must be/,
    ],
  ])('refuses %s', (_label, register, message) => {
    const registry = new ViewerRegistry();
    expect(() => register(registry.apiFor('p'))).toThrow(message);
    const snapshot = registry.getSnapshot();
    expect([...snapshot.actions, ...snapshot.tracks, ...snapshot.contextSections, ...snapshot.settings]).toHaveLength(0);
  });

  it('replaces and removes a plugin’s registrations of every kind', () => {
    const registry = new ViewerRegistry();
    registry.apiFor('p').registerTimelineTrack({ id: 't', label: 'T', markers: () => [] });
    registry.apiFor('q').registerSetting({ id: 's', label: 'S', type: 'boolean', default: true });
    registry.replacePlugin('p', (api) => api.registerContextSection({ id: 'c', title: 'C', render }));
    expect(registry.getSnapshot().tracks).toEqual([]);
    expect(registry.getSnapshot().contextSections.map((entry) => entry.key)).toEqual(['plugin:p:c']);
    registry.removePlugin('q');
    expect(registry.getSnapshot().settings).toEqual([]);
  });
});

describe('plugin settings', () => {
  const units: SettingDefinition = {
    id: 'units',
    label: 'Units',
    type: 'choice',
    options: [{ value: 's' }, { value: 'ms' }],
    default: 's',
  };
  const compact: SettingDefinition = { id: 'compact', label: 'Compact', type: 'boolean', default: false };

  it('reads the default, then what was written, under a plugin-namespaced key', () => {
    const values = memoryStorage();
    expect(readSetting('acme', units)).toBe('s');
    writeSetting('acme', units, 'ms');
    expect(values.get('replays-plugin:acme:setting:units')).toBe('"ms"');
    expect(readSetting('acme', units)).toBe('ms');
    // Another plugin's setting of the same id is its own.
    expect(readSetting('other', units)).toBe('s');
    expect(settingKey('acme', 'units')).toBe('replays-plugin:acme:setting:units');
  });

  it('ignores values that do not fit the definition, written or stored', () => {
    const values = memoryStorage();
    writeSetting('acme', units, 'hours');
    writeSetting('acme', compact, 'yes');
    expect(values.size).toBe(0);
    values.set(settingKey('acme', 'units'), '"hours"');
    values.set(settingKey('acme', 'compact'), '{not json');
    expect(readSetting('acme', units)).toBe('s');
    expect(readSetting('acme', compact)).toBe(false);
  });

  it('gives each plugin its own `context.settings`: get by id, changes of its own only', () => {
    memoryStorage();
    const registry = new ViewerRegistry();
    registry.apiFor('acme').registerSetting(compact);
    registry.apiFor('other').registerSetting(compact);
    const settings = pluginSettings('acme', registry);
    const seen = vi.fn<(id: string, value: unknown) => void>();
    const off = settings.onChange(seen);
    expect(settings.get('compact')).toBe(false);
    expect(settings.get('missing')).toBeUndefined();
    writeSetting('other', compact, true);
    expect(seen).not.toHaveBeenCalled();
    writeSetting('acme', compact, true);
    expect(seen).toHaveBeenCalledWith('compact', true);
    expect(settings.get('compact')).toBe(true);
    off();
    writeSetting('acme', compact, false);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('keeps notifying when one listener throws', () => {
    memoryStorage();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn<() => void>();
    const offFirst = subscribeSettings(() => {
      throw new Error('listener bug');
    });
    const offSecond = subscribeSettings(second);
    writeSetting('acme', compact, true);
    expect(second).toHaveBeenCalledTimes(1);
    offFirst();
    offSecond();
  });
});

describe('timeline track markers', () => {
  it('keeps valid markers, clamped to the replay and sorted, with tones defaulting to neutral', () => {
    const { markers, dropped } = placeMarkers(
      [
        { atMs: 800, label: 'late', tone: 'error' },
        { atMs: -50, label: 'before the start' },
        { atMs: 500, durationMs: 900, label: 'range past the end', tone: 'info' },
        { atMs: 100, label: 'odd tone', tone: 'purple' },
        { atMs: Number.NaN, label: 'nan' },
        { atMs: 2000, label: 'after the end' },
        { atMs: 10, label: '  ' },
        null,
      ],
      1000,
    );
    expect(markers).toEqual([
      { at: 0, duration: 0, label: 'before the start', tone: 'neutral' },
      { at: 100, duration: 0, label: 'odd tone', tone: 'neutral' },
      { at: 500, duration: 500, label: 'range past the end', tone: 'info' },
      { at: 800, duration: 0, label: 'late', tone: 'error' },
    ]);
    expect(dropped).toBe(4);
  });

  it(`caps a track at ${MAX_TRACK_MARKERS} markers, the earliest`, () => {
    const raw = Array.from({ length: 700 }, (_, index) => ({ atMs: 699 - index, label: `m${index}` }));
    const { markers, dropped } = placeMarkers(raw, 1000);
    expect(markers).toHaveLength(MAX_TRACK_MARKERS);
    expect(markers[0]?.at).toBe(0);
    expect(markers.at(-1)?.at).toBe(MAX_TRACK_MARKERS - 1);
    expect(dropped).toBe(200);
  });

  it('treats anything but an array as no markers, and shortens long labels', () => {
    expect(placeMarkers(undefined, 1000)).toEqual({ markers: [], dropped: 0 });
    expect(placeMarkers({ atMs: 1 }, 1000).markers).toEqual([]);
    expect(placeMarkers([{ atMs: 1, label: 'x'.repeat(400) }], 1000).markers[0]?.label).toHaveLength(160);
  });
});

describe('context schema hints', () => {
  const schema: FieldSchema = {
    type: 'object',
    title: 'Customer',
    properties: {
      region: { type: 'string', title: 'Region' },
      plan: { type: 'string', title: 'Plan', 'x-replays-group': 'Account', 'x-replays-order': 2 },
      flags: { type: 'array', title: 'Flags', 'x-replays-group': 'Account', 'x-replays-widget': 'signals', 'x-replays-order': 1 },
      seats: { type: 'number', title: 'Seats', 'x-replays-order': -1 },
    },
  };
  const fields = {
    region: 'eu',
    plan: 'pro',
    seats: 4,
    extra: 'kept',
    flags: [
      { key: 'new-checkout', state: 'enabled' },
      { key: 'dark-mode', state: 'disabled', label: 'Dark mode' },
      { key: 'beta-api', state: 'unknown' },
    ],
  };

  it('reads signals only when every entry is a { key, state } with a known state', () => {
    expect(signalsOf(fields.flags)).toEqual([
      { key: 'new-checkout', state: 'enabled' },
      { key: 'dark-mode', state: 'disabled', label: 'Dark mode' },
      { key: 'beta-api', state: 'unknown' },
    ]);
    expect(signalsOf([{ key: 'a', state: 'on' }])).toBeUndefined();
    expect(signalsOf([{ state: 'enabled' }])).toBeUndefined();
    // Without the hint, or when the data does not fit, the plain renderings stay.
    expect(fieldRows({ flags: fields.flags }).find((row) => row.key === 'flags')?.value.kind).toBe('rows');
    expect(fieldRows({ flags: ['a', 'b'] }, schema)[0]?.value).toEqual({ kind: 'chips', items: ['a', 'b'] });
  });

  it('orders rows by x-replays-order (default 0, ties in schema order) and groups them by x-replays-group', () => {
    expect(fieldRows(fields, schema).map((row) => row.key)).toEqual(['seats', 'region', 'extra', 'flags', 'plan']);
    const groups = fieldGroups(fields, schema);
    expect(groups.map((group) => [group.title, group.rows.map((row) => row.key)])).toEqual([
      [undefined, ['seats', 'region', 'extra']],
      ['Account', ['flags', 'plan']],
    ]);
    expect(groups[1]?.rows[0]?.value.kind).toBe('signals');
  });

  it('renders signals tri-state, unknown distinct from disabled, and groups under their own headings', () => {
    const context: ReplayContext = { version: 1, capturedAt: '2026-10-10T12:00:00.000Z', fields };
    const html = renderToStaticMarkup(createElement(ContextPanel, { bundle: { ...replay(), context }, schema }));
    expect(html).toContain('data-widget="signals"');
    for (const state of ['enabled', 'disabled', 'unknown']) expect(html).toContain(`data-state="${state}"`);
    // Each state has its own icon and is spelled out for assistive tech.
    const icon = (state: string) => new RegExp(`data-state="${state}"[^>]*><svg[^>]*class="([^"]+)"`).exec(html)?.[1];
    const icons = ['enabled', 'disabled', 'unknown'].map(icon);
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(3);
    expect(html).toMatch(/visually-hidden">: (<!-- -->)?unknown</);
    expect(html).toContain('Dark mode');
    expect(html).toContain('data-testid="context-fields"');
    expect(html).toContain('data-testid="context-group:Account"');
    expect(html.indexOf('Customer')).toBeLessThan(html.indexOf('Account'));
  });

  it('draws plugin sections after the built-in groups, and even without context', () => {
    const section = createElement('section', { 'data-testid': 'plugin-section' }, 'From a plugin');
    const context: ReplayContext = { version: 1, capturedAt: '2026-10-10T12:00:00.000Z', app: { version: '1.0' } };
    const withContext = renderToStaticMarkup(createElement(ContextPanel, { bundle: { ...replay(), context }, sections: section }));
    expect(withContext.indexOf('Build')).toBeLessThan(withContext.indexOf('From a plugin'));
    const without = renderToStaticMarkup(createElement(ContextPanel, { bundle: replay(), sections: section }));
    expect(without).toContain('No context was captured');
    expect(without).toContain('From a plugin');
  });
});

describe('icons from plugins and config', () => {
  it('accepts only data:image/svg+xml and https URLs', () => {
    for (const ok of [SVG, 'data:image/svg+xml,%3Csvg%2F%3E', 'data:image/svg+xml;utf8,<svg/>', 'https://cdn.example.com/mark.svg'])
      expect(isSafeIconUrl(ok)).toBe(true);
    for (const bad of [
      '<svg/>',
      'javascript:alert(1)',
      'http://cdn.example.com/mark.svg',
      'data:text/html,<script>alert(1)</script>',
      'data:image/png;base64,AAAA',
      'https://user:pass@cdn.example.com/a.svg',
      '/relative/mark.svg',
      '',
      `data:image/svg+xml,${'x'.repeat(9000)}`,
      42,
    ])
      expect(isSafeIconUrl(bad)).toBe(false);
  });
});

describe('source provider looks and attributes', () => {
  const chat = {
    id: 'chat',
    label: 'Chat',
    noun: 'Chat thread',
    icon: SVG,
    resolve: (ref: string) => ({
      url: `https://chat.example.com/${ref}`,
      label: ref,
      attrs: { channel: 'support', replies: 3, bad: Number.POSITIVE_INFINITY, 'no spaces': 'x', html: '<b>' },
    }),
  };

  it('keeps the capped attrs from resolve, and an already resolved source’s own', () => {
    const providers = new SourceProviders().register(chat);
    const resolved = providers.resolve({ provider: 'chat', ref: 'C1' });
    expect(resolved).toEqual({
      provider: 'chat',
      ref: 'C1',
      url: 'https://chat.example.com/C1',
      label: 'C1',
      attrs: { channel: 'support', replies: 3 },
    });
    // Resolving the stored shape again (the server does) keeps them.
    expect(providers.resolve(resolved)).toEqual(resolved);
    expect(() => assertReplayContext({ version: 1, capturedAt: '2026-10-10T12:00:00.000Z', sources: [resolved] })).not.toThrow();
  });

  it('describes the providers that bring an icon or a noun, for the page', () => {
    const providers = new SourceProviders({
      templates: [{ id: 'jira', template: 'https://jira.example.com/{ref}', noun: 'Jira issue' }],
    }).register(chat);
    expect(providers.describe()).toEqual([
      { id: 'jira', label: 'jira', noun: 'Jira issue' },
      { id: 'chat', label: 'Chat', noun: 'Chat thread', icon: SVG },
    ]);
  });

  it('refuses an unsafe icon or a noun with markup at registration', () => {
    expect(() => new SourceProviders().register({ ...chat, icon: 'javascript:alert(1)' })).toThrow(/icon must be/);
    expect(() => new SourceProviders().register({ ...chat, noun: '<b>x</b>' })).toThrow(/noun must be short text/);
    expect(
      () => new SourceProviders({ templates: [{ id: 'x', template: 'https://x.example.com/{ref}', icon: 'http://x/a.svg' }] }),
    ).toThrow(/icon must be/);
    expect(templateProvider({ id: 'y', template: 'https://y.example.com/{ref}', icon: SVG }).icon).toBe(SVG);
  });

  it('caps attrs: at most 8, identifier keys, short text or finite numbers', () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`k${index}`, index]));
    expect(Object.keys(sourceAttrs(many) ?? {})).toHaveLength(8);
    expect(sourceAttrs({ a: 'x'.repeat(300) })?.a).toHaveLength(200);
    expect(sourceAttrs({ a: '' })).toBeUndefined();
    expect(sourceAttrs([1, 2])).toBeUndefined();
    expect(sourceAttrs('nope')).toBeUndefined();
  });

  it('validates stored attrs strictly', () => {
    const source = { provider: 'chat', url: 'https://chat.example.com/C1' };
    const context = (attrs: unknown) => ({ version: 1, capturedAt: '2026-10-10T12:00:00.000Z', sources: [{ ...source, attrs }] });
    for (const bad of [
      { 'bad key': 1 },
      { a: '<b>' },
      { a: null },
      { a: {} },
      [1],
      'x',
      Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])),
    ])
      expect(() => assertReplayContext(context(bad))).toThrow(/attrs must hold/);
    expect(() => assertReplayContext(context({ channel: 'support', replies: 3 }))).not.toThrow();
  });

  it('carries capped attrs into the index summary', () => {
    const attrs = { a: 'x'.repeat(150), b: 2, c: 3, d: 4, e: 5 };
    const bundle = {
      ...replay(),
      context: {
        version: 1 as const,
        capturedAt: '2026-10-10T12:00:00.000Z',
        sources: [{ provider: 'chat', url: 'https://chat.example.com/C1', attrs }],
      },
    };
    const [link] = summarizeReplay(bundle).sources ?? [];
    expect(link?.attrs).toEqual({ a: 'x'.repeat(80), b: 2, c: 3, d: 4 });
    expect(summarizeReplay(replay()).sources).toBeUndefined();
  });
});
