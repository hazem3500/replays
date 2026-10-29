import { describe, expect, it } from 'vitest';

import { compareDefaults } from '../src/client/compare/defaults.ts';
import { shortcutFor } from '../src/client/shortcuts.ts';
import { availableTab, cycleView, orderTabs, resolveView, viewDefaults, writeViewSearch } from '../src/client/views/resolve.ts';
import { assertReviewSuite } from '../src/shared/review-suite.ts';
import { BUILT_IN_VIEWS, type ViewInfo } from '../src/shared/views.ts';

const VIEWS: ViewInfo[] = BUILT_IN_VIEWS.map((view) => ({ ...view, order: view.order ?? 0 }));
const triage = { view: 'debug', viewer: { openAt: 'start' as const, captions: true } };

describe('resolveView', () => {
  it('takes a known ?view= over every profile', () => {
    const resolved = resolveView(VIEWS, { requested: 'review', suiteProfile: triage, replayProfile: triage, recordings: 3 });
    expect([resolved.view.id, resolved.source, resolved.fallback.id]).toEqual(['review', 'url', 'debug']);
  });

  it('falls through an unknown ?view= to what the page would open in', () => {
    expect(resolveView(VIEWS, { requested: 'nope', recordings: 1 }).view.id).toBe('standard');
  });

  it('takes the suite profile’s view before the replay’s', () => {
    const resolved = resolveView(VIEWS, { suiteProfile: { view: 'performance' }, replayProfile: triage, recordings: 2 });
    expect([resolved.view.id, resolved.source]).toEqual(['performance', 'suite']);
  });

  it('takes the replay profile’s view when the suite names none', () => {
    expect(resolveView(VIEWS, { suiteProfile: {}, replayProfile: triage, recordings: 1 }).view.id).toBe('debug');
  });

  it('opens two or more recordings without a profile view in Compare', () => {
    expect(resolveView(VIEWS, { recordings: 2 }).view.id).toBe('compare');
    expect(resolveView(VIEWS, { recordings: 1 }).view.id).toBe('standard');
  });
});

describe('viewDefaults', () => {
  it('lays the legacy viewer defaults of the profile that chose the view over its preset', () => {
    const defaults = viewDefaults(resolveView(VIEWS, { replayProfile: triage, recordings: 1 }));
    expect([defaults.openAt, defaults.captions, defaults.tab]).toEqual(['start', true, 'issues']);
  });

  it('keeps a profile’s legacy defaults out of a view the person switched to', () => {
    const defaults = viewDefaults(resolveView(VIEWS, { requested: 'standard', replayProfile: triage, recordings: 1 }));
    expect([defaults.openAt, defaults.captions]).toEqual(['start', false]);
  });

  it('applies a profile’s legacy defaults on Standard when the profile names no view', () => {
    const resolved = resolveView(VIEWS, { replayProfile: { viewer: { openAt: 'first-error', inspector: 'collapsed' } }, recordings: 1 });
    expect([resolved.view.id, viewDefaults(resolved).openAt, viewDefaults(resolved).inspector]).toEqual([
      'standard',
      'first-error',
      'collapsed',
    ]);
  });

  it('hides the inspector in Walkthrough', () => {
    expect(viewDefaults(resolveView(VIEWS, { requested: 'walkthrough', recordings: 1 })).inspector).toBe('hidden');
  });
});

describe('switching views', () => {
  it('cycles through the views in switcher order and wraps around', () => {
    expect(cycleView(VIEWS, 'standard', 1)?.id).toBe('compare');
    expect(cycleView(VIEWS, 'standard', -1)?.id).toBe('support');
  });

  it('writes ?view= only when it differs from the page’s own view, keeping the other keys', () => {
    expect(writeViewSearch('?t=4&with=b,c', 'debug', 'compare')).toBe('?t=4&with=b,c&view=debug');
    expect(writeViewSearch('?t=4&view=debug', 'compare', 'compare')).toBe('?t=4');
  });

  it('cycles with V and back with Shift V', () => {
    const key = { ctrlKey: false, metaKey: false, altKey: false };
    expect(shortcutFor({ ...key, key: 'v', shiftKey: false })).toBe('next-view');
    expect(shortcutFor({ ...key, key: 'V', shiftKey: true })).toBe('previous-view');
  });
});

describe('inspector tabs in a view', () => {
  const row = ['steps', 'console', 'network', 'performance', 'context', 'comments', 'plugin:acme:build'].map((id) => ({ id }));

  it('puts the listed tabs first and keeps every other tab reachable', () => {
    expect(orderTabs(row, ['comments', 'issues', 'context']).map((tab) => tab.id)).toEqual([
      'steps',
      'comments',
      'context',
      'console',
      'network',
      'performance',
      'plugin:acme:build',
    ]);
  });

  it('opens the first listed tab the row has when the wanted one is missing', () => {
    expect(availableTab(row, 'issues', ['issues', 'console'])).toBe('console');
  });
});

describe('compare layout', () => {
  it('opens a suite in its view’s layout', () => {
    expect(compareDefaults({ page: 'suite', recordings: 3, viewLayout: 'spotlight' }).layout).toBe('spotlight');
  });
});

describe('suite profile', () => {
  const suite = { version: 1, id: 'nightly', title: 'Nightly', createdAt: '2026-10-29T00:00:00.000Z', runs: [] };

  it('accepts a profile id on a suite', () => {
    expect(() => assertReviewSuite({ ...suite, profile: 'performance' })).not.toThrow();
  });

  it('refuses a suite profile that is not an id', () => {
    expect(() => assertReviewSuite({ ...suite, profile: 'Not An Id' })).toThrow('suite.profile is invalid');
  });
});
