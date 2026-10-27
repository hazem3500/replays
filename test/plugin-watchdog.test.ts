import { describe, expect, it, vi } from 'vitest';
import { PluginWatchdog } from '../src/client/malleable/watchdog.ts';
import {
  pluginAdmissionProblems,
  pluginPolicyHash,
  mayWriteWorkspace,
  parseMalleablePolicy,
  defaultPolicy,
} from '../src/shared/malleable-policy.ts';
import { starterPlugin } from '../src/shared/malleable.ts';

describe('plugin host admission and budgets', () => {
  it('defaults to personal scope and role-gates workspace changes', () => {
    const policy = defaultPolicy();
    expect(policy.scopes).toEqual(['user']);
    expect(mayWriteWorkspace(policy, {})).toBe(false);
    expect(mayWriteWorkspace(policy, { roles: ['member'] })).toBe(false);
    expect(mayWriteWorkspace(policy, { roles: ['admin'] })).toBe(true);
    expect(mayWriteWorkspace(parseMalleablePolicy({ workspaceRoles: [] }), { roles: ['admin'] })).toBe(false);
  });

  it('matches ids or stable source hashes, with deny taking precedence', async () => {
    const { manifest, source } = starterPlugin();
    const hash = await pluginPolicyHash(manifest, source);
    expect(await pluginPolicyHash({ ...manifest, targets: { core: '99.0.0' } }, source)).toBe(hash);
    expect(await pluginPolicyHash(manifest, `${source}\n//changed`)).not.toBe(hash);
    const allowed = parseMalleablePolicy({ allow: [`sha256:${hash}`] });
    expect(pluginAdmissionProblems(allowed, manifest.id, hash)).toEqual([]);
    expect(pluginAdmissionProblems(allowed, manifest.id, '0'.repeat(64))).toHaveLength(1);
    expect(
      pluginAdmissionProblems(parseMalleablePolicy({ allow: [`sha256:${hash}`], deny: [`id:${manifest.id}`] }), manifest.id, hash),
    ).toHaveLength(1);
    expect(pluginAdmissionProblems(parseMalleablePolicy({ allow: [] }), manifest.id, hash)).toHaveLength(1);
    for (const input of [
      { allow: ['*'] },
      { deny: ['sha256:bad'] },
      { workspaceRoles: [''] },
      { watchdog: { frameBudgetMs: 0 } },
      { watchdog: { maxCallsPerSecond: 1001 } },
      { watchdog: { unknown: 1 } },
    ])
      expect(() => parseMalleablePolicy(input)).toThrow(/malleable/);
  });

  it('kills a frame once on missed heartbeats, total lifetime or broker floods', () => {
    let now = 0;
    const stop = vi.fn<(reason: string) => void>();
    const limits = { heartbeatTimeoutMs: 3000, frameBudgetMs: 5000, maxCallsPerSecond: 2 };
    const frame = new PluginWatchdog(limits, stop, () => now);
    now = 2500;
    frame.heartbeat();
    frame.check();
    expect(stop).not.toHaveBeenCalled();
    now = 5000;
    frame.heartbeat();
    frame.check();
    frame.check();
    expect(stop).toHaveBeenCalledExactlyOnceWith('frame time budget exceeded');
    const heartbeat = vi.fn<(reason: string) => void>();
    const silent = new PluginWatchdog(limits, heartbeat, () => now);
    now += 3000;
    silent.check();
    expect(heartbeat).toHaveBeenCalledExactlyOnceWith('plugin stopped responding to heartbeats');
    const flood = vi.fn<(reason: string) => void>();
    const busy = new PluginWatchdog(limits, flood, () => now);
    busy.call();
    busy.call();
    now += 1000;
    busy.call();
    busy.call();
    expect(flood).not.toHaveBeenCalled();
    busy.call();
    expect(flood).toHaveBeenCalledExactlyOnceWith('broker call budget exceeded');
  });
});
