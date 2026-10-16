import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrokerError, handleCall, permissions, type PluginRef } from '../src/client/malleable/broker.ts';
import type { ViewerPluginContext } from '../src/client/plugins/api.ts';
import { ViewerRegistry } from '../src/client/plugins/registry.ts';
import { starterPlugin } from '../src/shared/malleable.ts';

const render = () => {};

describe('ViewerRegistry.replacePlugin (hot reload)', () => {
  it('swaps one plugin’s registrations in a single notification and leaves the others alone', () => {
    const registry = new ViewerRegistry();
    registry.apiFor('other').registerInspectorTab({ id: 'keep', label: 'Keep', render });
    registry.replacePlugin('user-a', (api) => {
      api.registerInspectorTab({ id: 'main', label: 'Old', render });
      api.registerViewerAction({ id: 'run', label: 'Run', run: () => {} });
    });
    const listener = vi.fn<() => void>();
    registry.subscribe(listener);
    registry.replacePlugin('user-a', (api) => api.registerInspectorTab({ id: 'main', label: 'New', render }));
    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = registry.getSnapshot();
    expect(snapshot.tabs.map((tab) => [tab.key, tab.definition.label])).toEqual([
      ['plugin:other:keep', 'Keep'],
      ['plugin:user-a:main', 'New'],
    ]);
    expect(snapshot.actions).toEqual([]);
  });

  it('keeps the old registrations when the new ones throw, and removePlugin removes', () => {
    const registry = new ViewerRegistry();
    registry.replacePlugin('user-a', (api) => api.registerInspectorTab({ id: 'main', label: 'Good', render }));
    expect(() => registry.replacePlugin('user-a', (api) => api.registerInspectorTab({ id: 'Bad Id', label: 'x', render }))).toThrow(
      /id must match/,
    );
    expect(registry.getSnapshot().tabs.map((tab) => tab.definition.label)).toEqual(['Good']);
    registry.removePlugin('user-a');
    expect(registry.getSnapshot().tabs).toEqual([]);
  });
});

const context = (over: Partial<ViewerPluginContext> = {}) =>
  ({
    replay: { meta: { id: 'r1' } },
    seek: vi.fn<(ms: number) => void>(),
    ...over,
  }) as unknown as ViewerPluginContext;
const plugin = (permissionsList: string[], source = 'x'): PluginRef => ({
  id: 'p',
  manifest: { ...starterPlugin('p').manifest, permissions: permissionsList as never },
  source,
  log: () => {},
});

describe('the capability broker', () => {
  afterEach(() => permissions.reset());

  it('refuses a capability the manifest did not declare, whatever the call', async () => {
    const ctx = context();
    for (const [method, params] of [
      ['seek', { ms: 10 }],
      ['notify', { message: 'hi' }],
      ['comments.list', {}],
      ['comments.add', { body: 'x' }],
      ['download', { name: 'a.txt', text: 'x' }],
    ] as const)
      await expect(handleCall(plugin([]), ctx, method, params)).rejects.toThrow(/permission-denied/);
    expect(ctx.seek).not.toHaveBeenCalled();
    expect(permissions.getSnapshot()).toEqual([]);
  });

  it('lets a declared read-only capability through without asking, and validates inputs', async () => {
    const ctx = context();
    await handleCall(plugin(['playback:seek']), ctx, 'seek', { ms: 1500 });
    expect(ctx.seek).toHaveBeenCalledWith(1500);
    await expect(handleCall(plugin(['playback:seek']), ctx, 'seek', { ms: -5 })).rejects.toBeInstanceOf(BrokerError);
    await expect(handleCall(plugin(['playback:seek']), ctx, 'unknown.method', {})).rejects.toThrow(/unknown method/);
  });

  it('asks before a write, shows what will happen, and a Deny writes nothing', async () => {
    const ctx = context();
    const pending = handleCall(plugin(['comments:write']), ctx, 'comments.add', { body: 'Console error: boom', at: 2500 });
    await vi.waitFor(() => expect(permissions.getSnapshot()).toHaveLength(1));
    const [request] = permissions.getSnapshot();
    expect(request).toMatchObject({ capability: 'comments:write', preview: 'Console error: boom' });
    expect(request!.detail).toContain('2.5 s');
    permissions.decide(request!.key, 'deny');
    await expect(pending).rejects.toThrow(/the person said no/);
  });

  it('remembers "until I reload" for that plugin and source only, and a changed source asks again', async () => {
    const original = plugin(['comments:write'], 'version one');
    const first = permissions.request(original, 'comments:write', 'add a comment');
    permissions.decide(permissions.getSnapshot()[0]!.key, 'session');
    await expect(first).resolves.toBe(true);
    await expect(permissions.request(original, 'comments:write', 'again')).resolves.toBe(true);
    expect(permissions.getSnapshot()).toEqual([]);
    // The same plugin id with different code is a different program.
    const changed = permissions.request(plugin(['comments:write'], 'version two'), 'comments:write', 'add a comment');
    expect(permissions.getSnapshot()).toHaveLength(1);
    permissions.drop('p');
    await expect(changed).resolves.toBe(false);
    // "Allow once" does not stick.
    const once = permissions.request(original, 'export:download', 'download');
    permissions.decide(permissions.getSnapshot()[0]!.key, 'once');
    await expect(once).resolves.toBe(true);
    void permissions.request(original, 'export:download', 'download again');
    expect(permissions.getSnapshot()).toHaveLength(1);
  });

  it('answers every queued request for the same capability when the person allows the session', async () => {
    const one = permissions.request(plugin(['comments:write']), 'comments:write', 'first');
    const two = permissions.request(plugin(['comments:write']), 'comments:write', 'second');
    expect(permissions.getSnapshot()).toHaveLength(2);
    permissions.decide(permissions.getSnapshot()[0]!.key, 'session');
    await expect(Promise.all([one, two])).resolves.toEqual([true, true]);
  });
});
