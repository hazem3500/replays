import { describe, expect, it } from 'vitest';
import { UserPluginStore } from '../src/server/malleable-store.ts';
import { MemoryStorage } from '../src/server/storage/memory.ts';
import { parseManifest, starterPlugin } from '../src/shared/malleable.ts';
import { parsePluginSettings } from '../src/shared/plugin-settings.ts';

const definitions = parsePluginSettings([
  { id: 'compact', label: 'Compact', type: 'boolean', default: false },
  { id: 'format', label: 'Format', type: 'choice', default: 'csv', options: [{ value: 'csv' }, { value: 'json' }] },
]);

describe('user plugin settings', () => {
  it('validates definitions, ids, choices and defaults as part of the manifest', () => {
    expect(parseManifest({ ...starterPlugin().manifest, settings: definitions }).settings).toEqual(definitions);
    for (const settings of [
      [{ ...definitions[0], default: 'yes' }],
      [definitions[0], definitions[0]],
      [{ ...definitions[1], default: 'xml' }],
      [{ ...definitions[0], hidden: true }],
    ])
      expect(() => parseManifest({ ...starterPlugin().manifest, settings })).toThrow(/settings/);
  });

  it('isolates person, scope and plugin and rejects stale writes and undeclared values', async () => {
    const store = new UserPluginStore(new MemoryStorage());
    expect(await store.readSettings('workspace', 'ada', 'test', definitions)).toEqual({
      version: 0,
      values: { compact: false, format: 'csv' },
    });
    const first = await store.setSetting('workspace', 'ada', 'test', definitions, { id: 'compact', value: true, baseVersion: 0 });
    expect(first).toEqual({ version: 1, values: { compact: true, format: 'csv' } });
    for (const [scope, who, id] of [
      ['workspace', 'grace', 'test'],
      ['user', 'ada', 'test'],
      ['workspace', 'ada', 'other'],
    ] as const)
      expect((await store.readSettings(scope, who, id, definitions)).values.compact).toBe(false);
    await expect(
      store.setSetting('workspace', 'ada', 'test', definitions, { id: 'compact', value: false, baseVersion: 0 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      store.setSetting('workspace', 'ada', 'test', definitions, { id: 'format', value: 'xml', baseVersion: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    const changed = [
      { id: 'compact', label: 'Compact', type: 'choice', default: 'off', options: [{ value: 'off' }, { value: 'on' }] },
    ] as const;
    expect((await store.readSettings('workspace', 'ada', 'test', changed)).values).toEqual({ compact: 'off' });
  });

  it('allows only one of two competing saves to win', async () => {
    const store = new UserPluginStore(new MemoryStorage());
    const results = await Promise.allSettled(
      [true, false].map((value) => store.setSetting('user', 'ada', 'test', definitions, { id: 'compact', value, baseVersion: 0 })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});
