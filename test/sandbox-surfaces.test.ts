import { afterEach, describe, expect, it } from 'vitest';
import { parseManifest, starterPlugin } from '../src/shared/malleable.ts';
import { defaultPolicy } from '../src/shared/malleable-policy.ts';
import { ViewerRegistry } from '../src/client/plugins/registry.ts';
import { registerSandboxSurfaces, sandboxMarkers } from '../src/client/malleable/surfaces.ts';
import { setHostForTests } from '../src/client/malleable/host.ts';
import { permissions } from '../src/client/malleable/broker.ts';
import { createPluginContext } from '../src/client/plugins/PluginUi.tsx';
import { ReplayController } from '../src/client/player.ts';
import { replay } from './fixtures.ts';

describe('plugin behavior', () => {
afterEach(() => {
  permissions.reset();
  setHostForTests(undefined);
});

it('registers sandbox context and track contributions and releases them on unload', () => {
  const registry = new ViewerRegistry();
  const manifest = parseManifest({
    ...starterPlugin().manifest,
    contributes: { contextSections: [{ id: 'release', label: 'Release' }], tracks: [{ id: 'problems', label: 'Problems' }] },
  });
  registerSandboxSurfaces(
    registry.apiFor('user:test'),
    manifest.contributes,
    () => ({ id: manifest.id, manifest, source: '', log: () => {} }),
    () => () => {},
  );
  expect(registry.getSnapshot().contextSections[0]?.definition.title).toBe('Release');
  expect(registry.getSnapshot().tracks[0]?.definition.label).toBe('Problems');
  registry.removePlugin('user:test');
  expect(registry.getSnapshot().tracks).toEqual([]);
  expect(registry.getSnapshot().contextSections).toEqual([]);
});

it('projects only bounded marker display fields from untrusted results', () => {
  expect(sandboxMarkers([{ atMs: 1, label: 'Marker', tone: 'warn', durationMs: 2, secret: 'ignored' }])).toEqual([
    { atMs: 1, label: 'Marker', tone: 'warn', durationMs: 2 },
  ]);
  for (const value of [
    [{ atMs: NaN, label: 'Bad' }],
    [{ atMs: 0, label: 'x'.repeat(161) }],
    Array.from({ length: 501 }, () => ({ atMs: 0, label: 'x' })),
  ])
    expect(() => sandboxMarkers(value)).toThrow(/marker/);
});

it('enforces declaration and current host policy on each sandbox marker activation', async () => {
  setHostForTests({ policy: defaultPolicy() });
  const registry = new ViewerRegistry();
  const manifest = parseManifest({
    ...starterPlugin().manifest,
    permissions: [],
    contributes: { tracks: [{ id: 'main', label: 'Events' }] },
  });
  const ref = () => ({ id: manifest.id, manifest, source: '', log: () => {} });
  registerSandboxSurfaces(registry.apiFor('user:test'), manifest.contributes, ref, () => () => {});
  const track = registry.getSnapshot().tracks[0]?.definition;
  if (!track?.onSelect) throw new Error('track not registered');
  const bundle = replay();
  const player = new ReplayController(bundle);
  const context = createPluginContext(bundle, player, 'user:test');
  await expect(track.onSelect(500, context)).rejects.toThrow('not in the manifest');
  expect(player.getTime()).toBe(0);
  manifest.permissions.push('playback:seek');
  await track.onSelect(500, context);
  expect(player.getTime()).toBe(500);
  setHostForTests({ policy: { ...defaultPolicy(), capabilities: { ...defaultPolicy().capabilities, 'playback:seek': 'deny' } } });
  await expect(track.onSelect(900, context)).rejects.toThrow('does not allow');
  expect(player.getTime()).toBe(500);
});

});
