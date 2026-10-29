import { defaultPolicy, pluginAdmissionProblems, pluginPolicyHash, policyProblems } from '../../shared/malleable-policy.ts';
import { hostInfo, hostPolicy } from './host.ts';
import { PluginWatchdog } from './watchdog.ts';
import { SANDBOX_PATH } from '../../shared/sandbox-runtime.ts';
import type { ViewerPluginContext } from '../plugins/api.ts';
import { appBase } from '../api/fetch.ts';
import { BrokerError, handleCall, mayReadReplay, type PluginRef } from './broker.ts';

/** The viewer's design tokens a plugin can use as `var(--…)`, copied into the frame (it has none of the page's CSS). */
const THEME_VARS = ['--text', '--text-secondary', '--surface', '--surface-hover', '--line', '--accent', '--danger'];

export function themeVars() {
  const style = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = style.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return vars;
}

export type SandboxMode = 'tab' | 'panel' | 'action';

export interface SandboxHandle {
  dispose(): void;
  /** Resolves when an action finished (or the watchdog fired); never for tabs and panels. */
  done: Promise<void>;
}

const activeFrames = new Set<HTMLIFrameElement>();
const MAX_ACTIVE_FRAMES = 8;

const START_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 60_000;

/**
 * Starts a plugin in a sandboxed frame inside `container` (a tab or panel) or, for actions, in a hidden frame that is
 * removed when the action ends. `sandbox="allow-scripts"` without `allow-same-origin` gives the frame an opaque origin: no
 * access to this page, its cookies or storage, and the document's own CSP (src/shared/sandbox-runtime.ts) forbids every kind
 * of request. What reaches the page is only what `handleCall` lets through.
 */
export function mountSandbox(options: {
  plugin: PluginRef;
  mode: SandboxMode;
  contribution: string;
  container: HTMLElement;
  context: ViewerPluginContext;
}): SandboxHandle {
  const { plugin, mode, contribution, container, context } = options;
  if (activeFrames.size >= MAX_ACTIVE_FRAMES) {
    plugin.log('error', 'active plugin frame budget exceeded (8)');
    return { dispose: () => {}, done: Promise.resolve() };
  }
  const iframe = document.createElement('iframe');
  activeFrames.add(iframe);
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('allow', '');
  iframe.title = `${plugin.manifest.name} (sandboxed plugin)`;
  iframe.dataset.testid = `sandbox-frame:${plugin.id}`;
  iframe.dataset.pluginId = plugin.id;
  iframe.className = mode === 'action' ? 'malleable-frame malleable-frame-hidden' : 'malleable-frame';
  iframe.src = `${appBase()}${SANDBOX_PATH}`;

  let port: MessagePort | undefined;
  let started = false;
  let disposed = false;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const unsubscribeTime = context.onTime((ms) => port?.postMessage({ type: 'time', ms }));

  let watchdog: PluginWatchdog | undefined;
  const watchdogTimer = setInterval(() => watchdog?.check(), 500);
  const startTimer = setTimeout(() => {
    if (!started) {
      plugin.log('error', 'the sandbox did not start (is the sandbox page reachable?)');
      dispose();
    }
  }, START_TIMEOUT_MS);
  const actionTimer =
    mode === 'action'
      ? setTimeout(() => {
          plugin.log('error', `the action did not finish in ${ACTION_TIMEOUT_MS / 1000} s and was stopped`);
          dispose();
        }, ACTION_TIMEOUT_MS)
      : undefined;

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || started || event.data?.replaysSandbox !== 'ready') return;
    started = true;
    clearTimeout(startTimer);
    const channel = new MessageChannel();
    port = channel.port1;
    const onPortMessage = async (message: MessageEvent) => {
      watchdog?.call();
      if (disposed) return;
      const { id, method, params } = (message.data ?? {}) as { id?: number; method?: string; params?: Record<string, unknown> };
      if (disposed || typeof method !== 'string') return;
      if (method === 'heartbeat') {
        watchdog?.heartbeat();
        return;
      }
      // Fire-and-forget reports from the frame: id 0.
      if (method === 'log' || method === 'error') {
        plugin.log(method === 'error' ? 'error' : String(params?.level ?? 'log'), String(params?.message ?? ''));
        return;
      }
      if (method === 'rendered') return;
      if (method === 'done') {
        if (mode === 'action') dispose();
        return;
      }
      try {
        const result = await handleCall(plugin, context, method, params);
        if (!disposed && id) port?.postMessage({ id, ok: true, result });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!(error instanceof BrokerError)) console.error(`plugin ${plugin.id}: ${method} failed:`, error);
        plugin.log('warn', `${method}: ${text}`);
        if (!disposed && id) port?.postMessage({ id, ok: false, error: text });
      }
    };
    port.addEventListener('message', onPortMessage);
    port.start();
    // invariant: check policy before handing the replay copy to the frame.
    void readableReplay(plugin, dispose)
      .then((readable) => {
        if (disposed) return;
        const replay = readable
          ? (() => {
              const { meta, steps, console: consoleEntries, network, performance, context: replayContext } = context.replay;
              return {
                meta,
                steps,
                console: consoleEntries,
                network,
                ...(performance ? { performance } : {}),
                ...(replayContext ? { context: replayContext } : {}),
              };
            })()
          : undefined;
        watchdog = new PluginWatchdog(hostInfo().policy.watchdog ?? defaultPolicy().watchdog, (reason) => {
          plugin.log('error', reason);
          dispose();
        });
        iframe.contentWindow?.postMessage(
          {
            type: 'init',
            mode,
            contribution,
            source: plugin.source,
            theme: context.theme,
            vars: themeVars(),
            time: context.getTime(),
            replay,
          },
          '*',
          [channel.port2],
        );
      })
      .catch((error: unknown) => {
        plugin.log('error', String(error));
        dispose();
      });
  };
  window.addEventListener('message', onMessage);

  // The frame must stay where it was loaded: a second load (a script that navigated itself) ends it.
  let loads = 0;
  iframe.addEventListener('load', () => {
    if (++loads > 1) {
      plugin.log('error', 'the plugin navigated its frame; it was stopped');
      dispose();
    }
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(startTimer);
    clearInterval(watchdogTimer);
    activeFrames.delete(iframe);
    if (actionTimer) clearTimeout(actionTimer);
    window.removeEventListener('message', onMessage);
    unsubscribeTime();
    try {
      port?.postMessage({ type: 'dispose' });
    } catch {
      /* the port may already be closed */
    }
    port?.close();
    iframe.remove();
    finish();
  }

  container.append(iframe);
  return { dispose, done };
}

async function readableReplay(plugin: PluginRef, dispose: () => void): Promise<boolean> {
  const policy = await hostPolicy();
  const problems = [
    ...policyProblems(policy, plugin.manifest, plugin.scope ?? 'user'),
    ...pluginAdmissionProblems(
      policy,
      plugin.id,
      [...(policy.allow ?? []), ...(policy.deny ?? [])].some((selector) => selector.startsWith('sha256:'))
        ? await pluginPolicyHash(plugin.manifest, plugin.source)
        : '',
    ),
  ];
  if (problems.length) {
    plugin.log('error', problems.join('; '));
    dispose();
    return false;
  }
  return plugin.manifest.permissions.includes('replay:read') ? mayReadReplay(plugin) : false;
}
