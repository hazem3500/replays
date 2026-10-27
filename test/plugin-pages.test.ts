import { describe, expect, it } from 'vitest';
import { PluginPageRegistry, pluginPagePath } from '../src/client/plugins/pages.ts';

describe('plugin page paths', () => {
  it.each(['https://example.com', '//example.com', '/p/other/a', '../a', '/a/./b', '%2e%2e/a', 'a/%2F/b', 'a/%5c/b', 'a\\b', '%'])(
    'refuses paths outside the plugin: %s',
    (path) => {
      expect(pluginPagePath('check', path)).toBeUndefined();
    },
  );

  it.each([
    ['', ''],
    ['a/b', 'a/b'],
    ['/a/b', 'a/b'],
    ['/p/check/a', 'a'],
    ['/p/check', ''],
  ])('keeps %s inside the plugin', (path, expected) => {
    expect(pluginPagePath('check', path)).toBe(expected);
  });
});

describe('plugin page lifecycle', () => {
  it('notifies subscribers, rejects duplicates and restores an earlier registry on rollback', () => {
    const registry = new PluginPageRegistry();
    let changes = 0;
    const unsubscribe = registry.subscribe(() => changes++);
    const definition = { title: 'Check', render: () => {} };
    registry.register('check', definition);
    const checkpoint = registry.checkpoint();
    expect(() => registry.register('check', definition)).toThrow(/already registered/);
    registry.removeOwner('check');
    expect(registry.get('check')).toBeUndefined();
    registry.restore(checkpoint);
    expect(registry.get('check')).toBe(definition);
    expect(changes).toBe(3);
    expect(registry.snapshot()).toBe(3);
    unsubscribe();
    registry.removeOwner('check');
    expect(changes).toBe(3);
  });
});
