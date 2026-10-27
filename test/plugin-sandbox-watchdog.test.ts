// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSandbox } from '../src/client/malleable/sandbox.ts';
import { setHostForTests } from '../src/client/malleable/host.ts';
import { defaultPolicy } from '../src/shared/malleable-policy.ts';
import { starterPlugin } from '../src/shared/malleable.ts';
import type { ViewerPluginContext } from '../src/client/plugins/api.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  setHostForTests(undefined);
});

describe('sandbox watchdog lifecycle', () => {
  it('removes a started frame when heartbeats stop and releases its subscriptions', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1 = { postMessage() {}, addEventListener() {}, start() {}, close() {} };
        port2 = {};
      },
    );
    setHostForTests({ policy: defaultPolicy() });
    const { manifest, source } = starterPlugin();
    manifest.permissions = [];
    const log = vi.fn<(level: string, message: string) => void>();
    const unsubscribe = vi.fn<() => void>();
    const context = { onTime: () => unsubscribe, theme: 'dark', getTime: () => 0 } as unknown as ViewerPluginContext;
    const handle = mountSandbox({
      plugin: { id: manifest.id, manifest, source, log },
      mode: 'tab',
      contribution: 'main',
      container: document.body,
      context,
    });
    const iframe = document.querySelector('iframe')!;
    const init = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
    window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow!, data: { replaysSandbox: 'ready' } }));
    await vi.waitFor(() => expect(init).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(3500);
    expect(iframe.isConnected).toBe(false);
    expect(log).toHaveBeenCalledWith('error', 'plugin stopped responding to heartbeats');
    expect(unsubscribe).toHaveBeenCalledOnce();
    await expect(handle.done).resolves.toBeUndefined();
    handle.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('disposes unreachable sandbox frames instead of retaining them indefinitely', async () => {
    vi.useFakeTimers();
    const { manifest, source } = starterPlugin();
    const log = vi.fn<(level: string, message: string) => void>();
    const context = { onTime: () => () => {} } as unknown as ViewerPluginContext;
    const handle = mountSandbox({
      plugin: { id: manifest.id, manifest, source, log },
      mode: 'action',
      contribution: 'main',
      container: document.body,
      context,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(document.querySelector('iframe')).toBeNull();
    expect(log).toHaveBeenCalledWith('error', expect.stringMatching(/did not start/));
    await expect(handle.done).resolves.toBeUndefined();
  });
});
