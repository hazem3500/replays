import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleCall, mayReadReplay, permissions, type PluginRef } from '../src/client/malleable/broker.ts';
import {
  dismissReview,
  getHealthSnapshot,
  needsReview,
  recordLoad,
  resetHealthForTests,
  subscribeHealth,
} from '../src/client/malleable/health.ts';
import { setHostForTests } from '../src/client/malleable/host.ts';
import { registryName } from '../src/client/malleable/manager.ts';
import type { ViewerPluginContext } from '../src/client/plugins/api.ts';
import { ViewerRegistry } from '../src/client/plugins/registry.ts';
import { definePlugin } from '../src/plugin/index.ts';
import { loadSettings } from '../src/server/config.ts';
import { coreVersion } from '../src/server/package-info.ts';
import { startServer, type RunningServer } from '../src/server/start.ts';
import { type MalleableConfig } from '../src/config/index.ts';
import { authoredManifest, parseManifest, type PluginVersion, starterPlugin } from '../src/shared/malleable.ts';
import {
  assertMayOverride,
  closedPolicy,
  defaultPolicy,
  parseDistribution,
  parseMalleablePolicy,
  policyProblems,
  surfaceId,
  targetsFor,
  versionsKey,
} from '../src/shared/malleable-policy.ts';

describe('the host policy (malleable in the config)', () => {
  it('defaults to both scopes, read-only capabilities allowed and writes asking', () => {
    const policy = parseMalleablePolicy(undefined);
    expect(policy).toEqual(defaultPolicy());
    expect(policy.scopes).toEqual(['user', 'workspace']);
    expect(policy.capabilities).toMatchObject({ 'replay:read': 'allow', 'comments:write': 'ask', 'export:download': 'ask' });
    expect(closedPolicy().capabilities).toMatchObject({ 'replay:read': 'allow', 'comments:write': 'deny', 'export:download': 'deny' });
  });

  it('narrows: scopes, capability rules and locked surfaces', () => {
    const policy = parseMalleablePolicy({
      enabled: true,
      scopes: ['workspace', 'user'],
      capabilities: { 'export:download': 'deny', 'replay:read': 'ask' },
      lockedSurfaces: ['inspector:context', 'panel:acme:notes', 'inspector:acme:build', 'action:acme:copy', 'inspector:context'],
    });
    expect(policy.scopes).toEqual(['user', 'workspace']);
    expect(policy.capabilities['export:download']).toBe('deny');
    expect(policy.capabilities['replay:read']).toBe('ask');
    expect(policy.capabilities['comments:write']).toBe('ask');
    expect(policy.lockedSurfaces).toEqual(['inspector:context', 'panel:acme:notes', 'inspector:acme:build', 'action:acme:copy']);
    expect(parseMalleablePolicy({ scopes: [] }).scopes).toEqual([]);
  });

  it('refuses at start a policy that would widen anything, or that it does not understand', () => {
    expect(() => parseMalleablePolicy({ capabilities: { 'comments:write': 'allow' } })).toThrow(/"ask" or "deny", not "allow"/);
    expect(() => parseMalleablePolicy({ capabilities: { 'export:download': 'allow' } })).toThrow(/not "allow"/);
    expect(() => parseMalleablePolicy({ capabilities: { 'net:fetch': 'deny' } })).toThrow(/not a capability/);
    expect(() => parseMalleablePolicy({ capabilities: { notify: 'maybe' } })).toThrow(/"allow", "ask" or "deny"/);
    expect(() => parseMalleablePolicy({ scopes: ['team'] })).toThrow(/scopes/);
    expect(() => parseMalleablePolicy({ scopes: ['user', 'user'] })).toThrow(/scopes/);
    expect(() => parseMalleablePolicy({ lockedSurfaces: ['context'] })).toThrow(/not a surface id/);
    // A user plugin's own surfaces are its own: they cannot be "locked" against it.
    expect(() => parseMalleablePolicy({ lockedSurfaces: ['panel:user:x:main'] })).toThrow(/not a surface id/);
    expect(() => parseMalleablePolicy({ enabled: 'yes' })).toThrow(/enabled/);
    expect(() => parseMalleablePolicy({ roles: [] })).toThrow(/not a supported key/);
    expect(() => parseMalleablePolicy([])).toThrow(/must be an object/);
  });

  it('says why a plugin would not be kept', () => {
    const policy = parseMalleablePolicy({ scopes: ['user'], capabilities: { 'export:download': 'deny' } });
    const manifest = { permissions: ['replay:read', 'export:download'] as const };
    expect(policyProblems(policy, { permissions: ['replay:read'] }, 'user')).toEqual([]);
    expect(policyProblems(policy, { permissions: [...manifest.permissions] }, 'user')).toEqual([
      expect.stringMatching(/does not allow export:download/),
    ]);
    expect(policyProblems(policy, { permissions: ['replay:read'] }, 'workspace')).toEqual([
      expect.stringMatching(/does not keep workspace plugins/),
    ]);
  });

  it('locks surfaces by id, the gate for any override path', () => {
    const policy = parseMalleablePolicy({ lockedSurfaces: ['inspector:context'] });
    expect(() => assertMayOverride(policy, 'inspector:context')).toThrow(/permission-denied: inspector:context is locked/);
    expect(() => assertMayOverride(policy, 'inspector:console')).not.toThrow();
    expect(surfaceId('tabs', 'acme', 'build')).toBe('inspector:acme:build');
    expect(surfaceId('panels', 'acme', 'notes')).toBe('panel:acme:notes');
  });

  it('reads `distribution` and turns versions into targets', () => {
    expect(parseDistribution({ name: '@acme/replays', version: '2.3.0' })).toEqual({ name: '@acme/replays', version: '2.3.0' });
    expect(() => parseDistribution({ name: 'acme', version: '2 3' })).toThrow(/version/);
    expect(() => parseDistribution({ name: 'acme', version: '1', tag: 'x' })).toThrow(/not a supported key/);
    expect(targetsFor({ core: '0.1.0' })).toEqual({ core: '0.1.0' });
    expect(targetsFor({ core: '0.1.0', distribution: { name: 'acme', version: '2.0.0' } })).toEqual({
      core: '0.1.0',
      distribution: 'acme@2.0.0',
    });
    expect(versionsKey({ core: '0.1.0', distribution: { name: 'acme', version: '2.0.0' } })).toBe('0.1.0 acme@2.0.0');
  });

  it('loads from the config file: malleable.enabled is the same switch as beta.malleable, the environment still wins', async () => {
    const on = await loadSettings({}, { malleable: { enabled: true, scopes: ['user'] } });
    expect(on.beta.malleable).toBe(true);
    expect(on.malleable.scopes).toEqual(['user']);
    expect((await loadSettings({}, { malleable: { scopes: ['user'] } })).beta.malleable).toBe(false);
    expect((await loadSettings({ REPLAYS_BETA_MALLEABLE: 'false' }, { malleable: { enabled: true } })).beta.malleable).toBe(false);
    expect((await loadSettings({}, { beta: { malleable: true } })).beta.malleable).toBe(true);
    await expect(loadSettings({}, { beta: { malleable: true }, malleable: { enabled: false } })).rejects.toThrow(/disagree/);
    await expect(
      loadSettings({}, { malleable: { capabilities: { 'comments:write': 'allow' } } as unknown as MalleableConfig }),
    ).rejects.toThrow(/not "allow"/);
    const withDistribution = await loadSettings({}, { distribution: { name: 'acme-replays', version: '2.0.0' } });
    expect(withDistribution.distribution).toEqual({ name: 'acme-replays', version: '2.0.0' });
  });
});

describe('manifest targets', () => {
  it('are an additive, validated manifest field, and not part of what the author wrote', () => {
    const { manifest } = starterPlugin('x');
    const withTargets = parseManifest({ ...manifest, targets: { core: '0.1.0', distribution: 'acme@2.0.0' } });
    expect(withTargets.targets).toEqual({ core: '0.1.0', distribution: 'acme@2.0.0' });
    expect(authoredManifest(withTargets)).toEqual(parseManifest(manifest));
    expect(() => parseManifest({ ...manifest, targets: { core: 1 } })).toThrow(/targets.core/);
    expect(() => parseManifest({ ...manifest, targets: { core: '1', extra: true } })).toThrow(/targets.extra/);
  });
});

// The server half.
const running: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

const who = definePlugin({
  name: 'who',
  setup(api) {
    api.auth({
      name: 'who-am-i',
      authenticate(request) {
        const id = request.headers['x-who'];
        return typeof id === 'string' ? { id, name: id } : undefined;
      },
    });
  },
});
const headers = { 'x-who': 'ada', 'content-type': 'application/json' };

async function boot(file: Record<string, unknown>) {
  const server = await startServer({
    env: { DATA_DIR: await mkdtemp(join(tmpdir(), 'replays-policy-')), POSTERS_DISABLED: '1', RENDER_DISABLED: '1' },
    port: 0,
    config: { dir: process.cwd(), file, plugins: [] },
    plugins: [who],
    log: () => {},
  });
  running.push(server);
  return server;
}

async function keep(server: RunningServer, scope: string, content: { manifest: unknown; source: string }) {
  const id = (content.manifest as { id: string }).id;
  const minted = await fetch(`${server.origin}/api/malleable/approvals`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'save', scope, id, ...content }),
  });
  if (minted.status !== 200) return minted;
  const { token } = (await minted.json()) as { token: string };
  return fetch(`${server.origin}/api/malleable/plugins/${scope}/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...content, baseVersion: 0, approval: token }),
  });
}

describe('the server enforces the policy', () => {
  it('exposes the policy, the core version and the distribution in /api/config', async () => {
    const server = await boot({
      malleable: { enabled: true, capabilities: { 'export:download': 'deny' }, lockedSurfaces: ['inspector:context'] },
      distribution: { name: 'acme-replays', version: '2.0.0' },
    });
    const config = await (await fetch(`${server.origin}/api/config`, { headers })).json();
    expect(config.beta.malleable).toBe(true);
    expect(config.core).toBe(coreVersion());
    expect(config.distribution).toEqual({ name: 'acme-replays', version: '2.0.0' });
    expect(config.malleable).toMatchObject({
      scopes: ['user', 'workspace'],
      capabilities: { 'export:download': 'deny', 'comments:write': 'ask' },
      lockedSurfaces: ['inspector:context'],
    });
  });

  it('exposes no policy with the feature off', async () => {
    const server = await boot({ malleable: { scopes: ['user'] } });
    const config = await (await fetch(`${server.origin}/api/config`, { headers })).json();
    expect(config.malleable).toBeUndefined();
    expect(config.core).toBe(coreVersion());
  });

  it('refuses to keep a plugin that declares a denied capability, or in a disabled scope', async () => {
    const server = await boot({ malleable: { enabled: true, scopes: ['user'], capabilities: { 'export:download': 'deny' } } });
    const { manifest, source } = starterPlugin('csv');
    const denied = await keep(server, 'user', { manifest: { ...manifest, permissions: ['replay:read', 'export:download'] }, source });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toMatch(/does not allow export:download/);
    const workspace = await keep(server, 'workspace', { manifest, source });
    expect(workspace.status).toBe(403);
    expect(((await workspace.json()) as { error: string }).error).toMatch(/workspace/);
    // Even with an approval minted under a laxer policy, the PUT checks again: a forged token is not the only gate.
    const put = await fetch(`${server.origin}/api/malleable/plugins/workspace/csv`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ manifest, source, baseVersion: 0, approval: 'ap_x' }),
    });
    expect(put.status).toBe(403);
    expect(((await put.json()) as { error: string }).error).toMatch(/not kept/);
    expect((await keep(server, 'user', { manifest, source })).status).toBe(200);
    expect((await (await fetch(`${server.origin}/api/malleable/plugins?scope=workspace`, { headers })).json()).plugins).toEqual([]);
  });

  it('records the versions a plugin was kept under, whatever the client sent', async () => {
    const server = await boot({ malleable: { enabled: true }, distribution: { name: 'acme-replays', version: '2.0.0' } });
    const { manifest, source } = starterPlugin('tab');
    const saved = await keep(server, 'user', { manifest: { ...manifest, targets: { core: '9.9.9' } }, source });
    expect(saved.status).toBe(200);
    const history = await (await fetch(`${server.origin}/api/malleable/plugins/user/tab`, { headers })).json();
    expect(history.versions[0].manifest.targets).toEqual({ core: coreVersion(), distribution: 'acme-replays@2.0.0' });
  });
});

// The viewer half.
const context = () => ({ replay: { meta: { id: 'r1' } }, seek: vi.fn<(ms: number) => void>() }) as unknown as ViewerPluginContext;
const plugin = (list: string[]): PluginRef & { logs: string[] } => {
  const logs: string[] = [];
  return {
    id: 'p',
    manifest: { ...starterPlugin('p').manifest, permissions: list as never },
    source: 'x',
    log: (_, m) => logs.push(m),
    logs,
  };
};

describe('the broker applies the host policy', () => {
  afterEach(() => {
    permissions.reset();
    setHostForTests(undefined);
  });

  it('fails a denied capability with permission-denied, without asking', async () => {
    setHostForTests({ policy: parseMalleablePolicy({ capabilities: { 'export:download': 'deny', 'playback:seek': 'deny' } }) });
    const ctx = context();
    await expect(handleCall(plugin(['export:download']), ctx, 'download', { name: 'a.csv', text: 'x' })).rejects.toThrow(
      /permission-denied: this server does not allow export:download/,
    );
    await expect(handleCall(plugin(['playback:seek']), ctx, 'seek', { ms: 1 })).rejects.toThrow(/permission-denied/);
    expect(ctx.seek).not.toHaveBeenCalled();
    expect(permissions.getSnapshot()).toEqual([]);
  });

  it('asks for a read-only capability the host set to ask', async () => {
    setHostForTests({ policy: parseMalleablePolicy({ capabilities: { 'playback:seek': 'ask' } }) });
    const ctx = context();
    const pending = handleCall(plugin(['playback:seek']), ctx, 'seek', { ms: 5 });
    await vi.waitFor(() => expect(permissions.getSnapshot()).toHaveLength(1));
    expect(permissions.getSnapshot()[0]).toMatchObject({ capability: 'playback:seek' });
    permissions.decide(permissions.getSnapshot()[0]!.key, 'once');
    await pending;
    expect(ctx.seek).toHaveBeenCalledWith(5);
  });

  it('withholds the copy of the replay when replay:read is denied', async () => {
    setHostForTests({ policy: parseMalleablePolicy({ capabilities: { 'replay:read': 'deny' } }) });
    const reader = plugin(['replay:read']);
    await expect(mayReadReplay(reader)).resolves.toBe(false);
    expect(reader.logs.join('\n')).toMatch(/replay:read: permission-denied/);
    setHostForTests({ policy: defaultPolicy() });
    await expect(mayReadReplay(plugin(['replay:read']))).resolves.toBe(true);
    await expect(mayReadReplay(plugin([]))).resolves.toBe(false);
  });
});

const render = () => {};

describe('user plugins are namespaced in the viewer registry', () => {
  it('registers as user:<id>, so a user plugin can never take or remove a host plugin’s surfaces', () => {
    const registry = new ViewerRegistry();
    // A host plugin whose name looks like the old user prefix.
    registry.apiFor('user-notes').registerInspectorTab({ id: 'main', label: 'Host', render });
    expect(registryName('notes')).toBe('user:notes');
    registry.replacePlugin(registryName('notes'), (api) => api.registerInspectorTab({ id: 'main', label: 'Mine', render }));
    registry.removePlugin(registryName('notes'));
    expect(registry.getSnapshot().tabs.map((tab) => [tab.key, tab.definition.label])).toEqual([['plugin:user-notes:main', 'Host']]);
    registry.replacePlugin(registryName('notes'), (api) => api.registerInspectorTab({ id: 'main', label: 'Mine', render }));
    expect(registry.getSnapshot().tabs.map((tab) => tab.key)).toEqual(['plugin:user-notes:main', 'plugin:user:notes:main']);
  });

  it('refuses any other owner name', () => {
    const registry = new ViewerRegistry();
    expect(() => registry.apiFor('acme:x').registerInspectorTab({ id: 'a', label: 'A', render })).toThrow(/not a plugin name/);
    expect(() => registry.apiFor('User').registerInspectorTab({ id: 'a', label: 'A', render })).toThrow(/not a plugin name/);
  });
});

const version = (targets?: { core: string; distribution?: string }): PluginVersion => ({
  n: 1,
  at: '2026-10-20T00:00:00.000Z',
  by: 'ada',
  message: '',
  manifest: { ...starterPlugin('p').manifest, ...(targets ? { targets } : {}) },
  source: 'x',
  sha256: 'a'.repeat(64),
});

describe('load health and the review notice (upgrade contract)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    resetHealthForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  const before = { core: '0.1.0', distribution: { name: 'acme', version: '1.0.0' } };
  const after = { core: '0.2.0', distribution: { name: 'acme', version: '2.0.0' } };
  it('publishes immutable health snapshots when a failure is recorded or dismissed', () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeHealth(listener);
    try {
      const saved = version(targetsFor(before));
      const initial = getHealthSnapshot();
      expect(getHealthSnapshot()).toBe(initial);
      recordLoad(after, 'p', saved.sha256, false);
      const failed = getHealthSnapshot();
      expect(failed).not.toBe(initial);
      expect(needsReview(after, 'p', saved, failed)).toBe(true);
      dismissReview(after, ['p']);
      expect(getHealthSnapshot()).not.toBe(failed);
      expect(needsReview(after, 'p', saved, getHealthSnapshot())).toBe(false);
      expect(needsReview(after, 'p', saved, failed)).toBe(true);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });
  it('points out a plugin that loaded before the upgrade and fails after it, and nothing else', () => {
    const saved = version(targetsFor(before));
    recordLoad(before, 'p', saved.sha256, true);
    expect(needsReview(before, 'p', saved)).toBe(false);
    recordLoad(after, 'p', saved.sha256, true);
    expect(needsReview(after, 'p', saved)).toBe(false);
    recordLoad(after, 'p', saved.sha256, false);
    expect(needsReview(after, 'p', saved)).toBe(true);
    // A later successful registration does not hide the failure of the same version.
    recordLoad(after, 'p', saved.sha256, true);
    expect(needsReview(after, 'p', saved)).toBe(true);
    // A new version starts clean.
    expect(needsReview(after, 'p', { ...saved, sha256: 'b'.repeat(64) })).toBe(false);
    dismissReview(after, ['p']);
    expect(needsReview(after, 'p', saved)).toBe(false);
    expect(JSON.parse(store.get('replays-malleable-health')!)).toHaveProperty(['0.2.0 acme@2.0.0', 'p', 'reviewed'], true);
  });

  it('uses the kept targets when there is no earlier load in this browser', () => {
    const kept = version(targetsFor(before));
    recordLoad(after, 'p', kept.sha256, false);
    expect(needsReview(after, 'p', kept)).toBe(true);
    // Broken under the versions it was kept under: a plain bug, not an upgrade; no notice.
    const current = version(targetsFor(after));
    expect(needsReview(after, 'p', current)).toBe(false);
  });
});
