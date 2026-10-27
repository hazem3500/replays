import { describe, expect, it } from 'vitest';
import { SlotRegistry, type SlotDescriptor } from '../src/client/plugins/api.ts';
import { ViewerRegistry } from '../src/client/plugins/registry.ts';
import { parseMalleablePolicy } from '../src/shared/malleable-policy.ts';

const descriptor = (id: string, order: number): SlotDescriptor<boolean, string> => ({ id, order, render: () => id });

describe('unified slots', () => {
  it('keeps legacy index filters/columns after core defaults while retaining their own metadata order', () => {
    const registry = new ViewerRegistry();
    registry.apiFor('acme').registerIndexFilter({ id: 'env', label: 'Environment', param: 'x-env', type: 'text', order: -10 });
    expect(registry.resolveSlot('index.filters', [descriptor('core:owner', 100)], true).map((item) => item.id)).toEqual([
      'core:owner',
      'plugin:acme:env',
    ]);
    expect(registry.getSnapshot().filters[0]?.definition.order).toBe(-10);
    expect(registry.resolveSlot('index.filters', [], true)[0]?.order).toBe(990);
  });
  it('owns plugin pages, cleans them up and restores them on a failed hot reload', () => {
    const registry = new ViewerRegistry();
    const page = { title: 'Reports', render: () => {} };
    registry.apiFor('reports').registerPluginPage(page);
    expect(registry.pages.get('reports')).toEqual(page);
    expect(() => registry.replacePlugin('reports', failReload)).toThrow('reload failed');
    expect(registry.pages.get('reports')).toEqual(page);
    registry.removePlugin('reports');
    expect(registry.pages.get('reports')).toBeUndefined();
    expect(() => registry.apiFor('user:draft').registerPluginPage(page)).toThrow(/only host/);
  });
  it('mixes core and plugin items numerically, then applies host order, hide and predicates without mutating inputs', () => {
    const slot = new SlotRegistry<boolean, string>('viewer.inspector.tabs');
    const builtins = [descriptor('core:console', 100), descriptor('core:network', 200)];
    slot.register({ ...descriptor('plugin:acme:build', 150), when: (enabled) => enabled });
    expect(slot.resolve(true, builtins).map((item) => item.id)).toEqual(['core:console', 'plugin:acme:build', 'core:network']);
    slot.configure({ order: ['core:network'], hide: ['core:console'] });
    expect(slot.resolve(true, builtins).map((item) => item.id)).toEqual(['core:network', 'plugin:acme:build']);
    expect(slot.resolve(false, builtins).map((item) => item.id)).toEqual(['core:network']);
    expect(slot.resolve(true, builtins)).toEqual(slot.resolve(true, builtins));
    expect(builtins.map((item) => item.id)).toEqual(['core:console', 'core:network']);
  });

  it('enforces both legacy and slot/item locked surfaces before changing configuration', () => {
    const policy = parseMalleablePolicy({ lockedSurfaces: ['inspector:context', 'index.filters/core:owner'] });
    const registry = new ViewerRegistry(() => policy);
    expect(() => registry.configureSlot('viewer.inspector.tabs', { hide: ['core:context'] })).toThrow(/locked/);
    expect(() => registry.configureSlot('index.filters', { order: ['core:owner'] })).toThrow(/locked/);
  });

  it('keeps legacy registration sugar in the same list and rolls back a failed hot reload', () => {
    const registry = new ViewerRegistry();
    registry.apiFor('acme').registerInspectorTab({ id: 'build', label: 'Build', order: 150, render: () => {} });
    const builtins = [descriptor('core:console', 100)];
    expect(registry.resolveSlot('viewer.inspector.tabs', builtins, true).map((item) => item.id)).toEqual([
      'core:console',
      'plugin:acme:build',
    ]);
    registry.configureSlot('viewer.inspector.tabs', { hide: ['plugin:acme:build'] });
    expect(registry.getSnapshot().tabs).toEqual([]);
    expect(() => registry.replacePlugin('acme', failReload)).toThrow('reload failed');
    registry.configureSlot('viewer.inspector.tabs', {});
    expect(registry.getSnapshot().tabs).toHaveLength(1);
    registry.removePlugin('acme');
    expect(registry.resolveSlot('viewer.inspector.tabs', builtins, true).map((item) => item.id)).toEqual(['core:console']);
    expect(() => registry.apiFor('user:draft').configureSlot('index.filters', { hide: ['core:owner'] })).toThrow(/cannot configure/);
  });
});

function failReload(): never {
  throw new Error('reload failed');
}
