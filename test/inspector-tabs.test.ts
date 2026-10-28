import { MessageSquareIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { ViewerRegistry } from '../src/client/plugins/registry.ts';
import { inspectorTabItems, type InspectorTabContext, type TabResolver } from '../src/client/viewer/inspector-tabs.ts';
import { consoleBadge } from '../src/client/viewer/tab-badges.ts';
import type { ReplayConsoleEntry } from '../src/shared/replay.ts';

const context = (overrides: Partial<InspectorTabContext> = {}): InspectorTabContext => ({
  stepCount: 4,
  rail: true,
  badges: {},
  ...overrides,
});
const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

const log = (level: ReplayConsoleEntry['level']): ReplayConsoleEntry => ({ at: 0, level, message: level });

describe('inspector tab row', () => {
  it('gives steps no tab while the steps rail is on screen', () => {
    expect(ids(inspectorTabItems(context({ rail: true })))).toEqual(['console', 'network', 'performance', 'context']);
  });

  it('puts steps first when there is no rail to hold them', () => {
    expect(ids(inspectorTabItems(context({ rail: false })))[0]).toBe('steps');
  });

  it('shows no steps tab for a replay without steps, even on phones', () => {
    expect(ids(inspectorTabItems(context({ rail: false, stepCount: 0 })))).not.toContain('steps');
  });

  it('follows the host order and hide configuration for built-in tabs', () => {
    const registry = new ViewerRegistry();
    registry.configureSlot('viewer.inspector.tabs', { order: ['core:network'], hide: ['core:performance'] });
    const resolve: TabResolver = (name, builtins, input) => registry.resolveSlot(name, builtins, input);
    expect(ids(inspectorTabItems(context(), resolve))).toEqual(['network', 'console', 'context']);
  });

  it('places plugin tabs after the built-in feature tabs', () => {
    const registry = new ViewerRegistry();
    registry.apiFor('acme').registerInspectorTab({ id: 'build', label: 'Build', order: 5, render: () => {} });
    const resolve: TabResolver = (name, builtins, input) => registry.resolveSlot(name, builtins, input);
    const items = inspectorTabItems(
      context({
        features: [{ id: 'comments', label: 'Comments', Icon: MessageSquareIcon }],
        plugins: [{ key: 'plugin:acme:build', label: 'Build' }],
      }),
      resolve,
    );
    expect(ids(items).slice(-2)).toEqual(['comments', 'plugin:acme:build']);
  });
});

describe('tab badges', () => {
  it('shows no badge for an empty track', () => {
    expect(consoleBadge([])).toBeUndefined();
  });

  it('marks console errors red ahead of warnings', () => {
    expect(consoleBadge([log('error'), log('warn'), log('log')])).toEqual({
      value: 3,
      tone: 'danger',
      label: '3 entries, 1 error, 1 warning',
    });
  });
});
