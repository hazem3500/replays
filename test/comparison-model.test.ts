import { describe, expect, it } from 'vitest';
import { comparisonErrors, comparisonReplayId, evidenceSuggestion, sharedEventTime } from '../src/client/comparison/model.ts';
import { defaultLayout, movePanel, PANELS, parsePreferences } from '../src/client/comparison/preferences.ts';
import { performanceFixture } from './performance-fixture.ts';
import { request } from './waterfall-fixture.ts';

const origin = 'https://replays.example';

describe('comparison source isolation', () => {
  it('accepts replay IDs and URLs under the exact app base', () => {
    expect(comparisonReplayId(' before-123 ', origin, '/team')).toBe('before-123');
    expect(comparisonReplayId('/team/r/after-456?t=42', origin, '/team')).toBe('after-456');
    expect(comparisonReplayId(`${origin}/team/r/after-456/edit`, origin, '/team')).toBe('after-456');
    expect(comparisonReplayId(`${origin}/team/s/run/r/after-456#time`, origin, '/team')).toBe('after-456');
  });

  it.each([
    'https://other.example/team/r/after',
    '//other.example/team/r/after',
    'https://user:password@replays.example/team/r/after',
    'javascript:alert(1)',
    '/other/r/after',
    '/team-extra/r/after',
    '/team/api/replays/after',
    '/team/r/bad%2Fid',
    '/team/r/%ZZ',
  ])('rejects a URL which must never receive workspace credentials: %s', (input) => {
    expect(() => comparisonReplayId(input, origin, '/team')).toThrow(/workspace|replay|URL/i);
  });
});

describe('captured comparison evidence', () => {
  it('preserves local times and out-of-horizon markers instead of clamping them to zero', () => {
    const a = performanceFixture();
    a.console = [{ at: 200, level: 'error', message: 'Before failed' }];
    a.network = [];
    const b = performanceFixture();
    b.console = [{ at: 100, level: 'error', message: 'After failed' }];
    b.network = [request({ id: 'bad', at: 900, status: 503 }), request({ id: 'redirect', status: 0, statusText: '' })];
    const errors = comparisonErrors({ a, b }, 500);
    expect(errors.map(({ side, at, sharedAt }) => ({ side, at, sharedAt }))).toEqual([
      { side: 'b', at: 100, sharedAt: -400 },
      { side: 'a', at: 200, sharedAt: 200 },
      { side: 'b', at: 900, sharedAt: 400 },
    ]);
    expect(errors[2]!.request?.id).toBe('bad');
    expect(errors[0]!.consoleEntry?.message).toBe('After failed');
    expect(sharedEventTime('b', 100, -500)).toBe(600);
    expect(sharedEventTime('a', 100, -500)).toBe(100);
  });

  it('handles a missing side and absent performance without inventing observations', () => {
    const bundle = performanceFixture();
    delete bundle.performance;
    bundle.console = [];
    bundle.network = [];
    bundle.steps = [];
    expect(comparisonErrors({ a: bundle }, 0)).toEqual([]);
    expect(evidenceSuggestion({ a: bundle })).toContain('Choose a layout');
    expect(bundle.performance).toBeUndefined();
  });

  it('keeps distinct full console details when simultaneous marker labels are truncated identically', () => {
    const bundle = performanceFixture();
    const prefix = 'x'.repeat(140);
    bundle.console = [
      { level: 'error', at: 100, message: `${prefix} first` },
      { level: 'error', at: 100, message: `${prefix} second` },
    ];
    bundle.network = [];
    expect(comparisonErrors({ a: bundle }, 0).map((error) => error.consoleEntry?.message)).toEqual([`${prefix} first`, `${prefix} second`]);
  });

  it('suggests from actual captured data without selecting a layout', () => {
    const bundle = performanceFixture();
    bundle.console = [];
    bundle.network = [];
    expect(evidenceSuggestion({ a: bundle })).toContain('Performance may help');
    bundle.console = [{ level: 'error', at: 20, message: 'Captured issue' }];
    expect(evidenceSuggestion({ a: bundle })).toContain('Debugging may help');
  });
});

describe('layout-scoped saved preferences', () => {
  it('uses different initial composition and larger design canvases', () => {
    const preferences = parsePreferences(null);
    expect(preferences.performance.panels.filter((panel) => panel.visible).map((panel) => panel.id)).toEqual([
      'performance',
      'network',
      'journey',
    ]);
    expect(preferences.walkthrough.panels[0]!.id).toBe('journey');
    expect(preferences.debugging.panels[0]!.id).toBe('errors');
    expect(preferences.design.canvas).toBe('large');
  });

  it('roundtrips order, visibility and size for one layout without overwriting another', () => {
    const preferences = parsePreferences(null);
    preferences.performance = movePanel(preferences.performance, 'journey', -1);
    preferences.performance.canvas = 'compact';
    preferences.performance.panels[0]!.visible = false;
    preferences.performance.panels[1]!.size = 'compact';
    const decoded = parsePreferences(JSON.stringify({ version: 1, layouts: preferences }));
    expect(decoded.performance).toEqual(preferences.performance);
    expect(decoded.design).toEqual(defaultLayout('design'));
    expect(decoded.debugging).toEqual(defaultLayout('debugging'));
  });

  it('repairs corrupt or outdated storage and duplicate, missing or unsupported panels', () => {
    expect(parsePreferences('{bad')).toEqual(parsePreferences(null));
    expect(parsePreferences(JSON.stringify({ version: 0, layouts: {} }))).toEqual(parsePreferences(null));
    const saved = parsePreferences(
      JSON.stringify({
        version: 1,
        layouts: {
          performance: {
            canvas: 'infinite',
            panels: [
              { id: 'network', visible: false, size: 'compact' },
              { id: 'network', visible: true, size: 'large' },
              { id: 'external-widget', visible: true },
              { id: 'errors', visible: 'yes', size: 'infinite' },
            ],
          },
        },
      }),
    );
    expect(saved.performance.panels.map((panel) => panel.id).toSorted()).toEqual([...PANELS].toSorted());
    expect(saved.performance.panels[0]).toEqual({ id: 'network', visible: false, size: 'compact' });
    expect(saved.performance.canvas).toBe('regular');
    expect(movePanel(saved.performance, 'network', -1)).toBe(saved.performance);
  });
});

it('maps diagnostic markers relative to both scenario origins, retaining pre-origin events as negative time', () => {
  expect(sharedEventTime('a', 2500, 3000, 2000)).toBe(500);
  expect(sharedEventTime('b', 3500, 3000, 2000)).toBe(500);
  expect(sharedEventTime('a', 1000, 3000, 2000)).toBe(-1000);
});
