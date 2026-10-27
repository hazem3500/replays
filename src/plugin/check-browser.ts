import type { Cleanup, PluginPageDefinition, ViewerPlugin, ViewerPluginContext } from '../client/plugins/api.ts';
import type { ViewerRegistry } from '../client/plugins/registry.ts';
import type { ReplayBundle, ReplaySummary } from '../shared/replay.ts';
import type { Capability, UserPluginFile } from '../shared/malleable.ts';
import type { PluginSettingValue } from '../shared/plugin-settings.ts';

interface CheckReport {
  output: string[];
  errors: string[];
}
interface BrowserFixture {
  replay: ReplayBundle;
  summary: ReplaySummary;
}
interface UserCheck extends CheckReport {
  file: UserPluginFile;
  replay: ReplayBundle;
  settings: Record<string, PluginSettingValue>;
}
interface SandboxCall {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

function display(value: unknown): string {
  return String(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function makeHost(slot: string, id: string): HTMLElement {
  const host = document.createElement('section');
  host.dataset.slot = slot;
  host.dataset.slotItem = id;
  document.body.append(host);
  return host;
}
function fixtureContext(registry: ViewerRegistry, replay: ReplayBundle, report: CheckReport): ViewerPluginContext {
  return {
    replay,
    theme: 'dark',
    basePath: '',
    apiUrl: (path) => `/fixture-api/${path}`,
    getTime: () => 0,
    onTime: () => () => {},
    seek: (ms) => {
      report.output.push(`seek ${ms}`);
    },
    notify: (message) => {
      report.output.push(`notify ${message}`);
    },
    settings: {
      get: (id) =>
        registry.getSnapshot().settings.find((setting) => setting.plugin === 'check' && setting.definition.id === id)?.definition.default,
      onChange: () => () => {},
    },
  };
}
async function renderPage(page: PluginPageDefinition, context: ViewerPluginContext, report: CheckReport): Promise<void> {
  const host = makeHost('pages', 'plugin:check:page');
  const load = { path: '', search: {}, signal: new AbortController().signal };
  try {
    const data = await page.loader?.(load);
    const cleanup = page.render(host, {
      ...context,
      ...load,
      data,
      navigate: (path) => {
        report.output.push(`navigate ${path}`);
      },
    });
    report.output.push(`pages plugin:check:page: ${host.textContent?.slice(0, 1000) ?? ''}`);
    if (typeof cleanup === 'function') cleanup();
  } catch (error) {
    report.errors.push(`plugin:check:page: ${display(error)}`);
  }
}
function renderEntries<C>(
  entries: readonly { key: string; definition: { render(container: HTMLElement, context: C): Cleanup } }[],
  context: C,
  kind: string,
  report: CheckReport,
): void {
  for (const { key, definition } of entries) {
    report.output.push(`${kind} ${key}`);
    const host = makeHost(kind, key);
    try {
      const cleanup = definition.render(host, context);
      report.output.push(`${key}: ${host.textContent?.slice(0, 1000) ?? ''}`);
      if (typeof cleanup === 'function') cleanup();
    } catch (error) {
      report.errors.push(`${key}: ${display(error)}`);
    }
  }
}
async function checkLegacy(
  registry: ViewerRegistry,
  context: ViewerPluginContext,
  fixture: BrowserFixture,
  report: CheckReport,
): Promise<void> {
  const snapshot = registry.getSnapshot();
  renderEntries(snapshot.tabs, context, 'tabs', report);
  renderEntries(snapshot.panels, context, 'panels', report);
  renderEntries(snapshot.contextSections, context, 'contextSections', report);
  renderEntries(snapshot.columns, { ...context, summary: fixture.summary }, 'columns', report);
  renderEntries(snapshot.sections, { ...context, summaries: [] }, 'sections', report);
  for (const { key, definition } of snapshot.actions) {
    report.output.push(`actions ${key}`);
    try {
      if (definition.when?.(context) !== false) await definition.run(context);
    } catch (error) {
      report.errors.push(`${key}: ${display(error)}`);
    }
  }
  for (const { key, definition } of snapshot.tracks) {
    report.output.push(`tracks ${key}`);
    try {
      report.output.push(`${key}: ${JSON.stringify(await definition.markers(context))}`);
    } catch (error) {
      report.errors.push(`${key}: ${display(error)}`);
    }
  }
  for (const kind of ['filters', 'settings'] as const) for (const item of snapshot[kind]) report.output.push(`${kind} ${item.key}`);
}
/** Runs browser contributions against the public registry and validated fixture. */
export async function checkBrowserEntry(entry: ViewerPlugin, Registry: typeof ViewerRegistry, fixture: BrowserFixture): Promise<void> {
  const report: CheckReport = { output: [], errors: [] };
  const registry = new Registry();
  const context = fixtureContext(registry, fixture.replay, report);
  try {
    if (entry.apiVersion !== undefined && entry.apiVersion !== 1) throw new Error(`unsupported viewer API ${entry.apiVersion}`);
    const generic: Array<{ slot: string; id: string }> = [];
    const api = registry.apiFor('check');
    const register = api.registerSlotItem.bind(api);
    api.registerSlotItem = (slot, descriptor) => {
      register(slot, descriptor);
      generic.push({ slot, id: descriptor.id });
    };
    await entry(api);
    const page = registry.pages.get('check');
    if (page) await renderPage(page, context, report);
    for (const { slot, id } of generic) {
      const descriptor = registry.resolveSlot(slot, [], context).find((item) => item.id === id);
      if (!descriptor) continue;
      report.output.push(`${slot} ${id}`);
      try {
        report.output.push(`${id}: ${display(await descriptor.render(context))}`);
      } catch (error) {
        report.errors.push(`${id}: ${display(error)}`);
      }
    }
    await checkLegacy(registry, context, fixture, report);
  } catch (error) {
    report.errors.push(display(error));
  }
  Object.assign(window, { __pluginCheck: { ...report, done: true } });
}
function settingReply(state: UserCheck, call: SandboxCall): unknown {
  const definition = state.file.manifest.settings?.find((setting) => setting.id === call.params.id);
  if (!definition) throw new Error('unknown setting');
  if (call.method === 'settings.get') return state.settings[definition.id];
  const value = call.params.value;
  const valid =
    definition.type === 'boolean'
      ? typeof value === 'boolean'
      : typeof value === 'string' && definition.options.some((option) => option.value === value);
  if (call.method !== 'settings.set' || !valid || (typeof value !== 'string' && typeof value !== 'boolean'))
    throw new Error('invalid setting value');
  const settings = state.settings;
  settings[definition.id] = value;
  return value;
}
function fixtureReply(state: UserCheck, call: SandboxCall): unknown {
  const { method, params } = call;
  const permissions: Record<string, Capability> = {
    seek: 'playback:seek',
    notify: 'notify',
    'comments.list': 'comments:read',
    'comments.add': 'comments:write',
    download: 'export:download',
  };
  const capability = permissions[method];
  if (capability && !state.file.manifest.permissions.includes(capability)) throw new Error(`permission-denied: ${capability}`);
  if (method.startsWith('settings.')) return settingReply(state, call);
  switch (method) {
    case 'comments.list':
      return [];
    case 'comments.add':
      state.output.push(`fixture comment: ${display(params.body)}`);
      return { id: 'fixture-comment' };
    case 'download':
      state.output.push(`fixture download: ${display(params.name)} ${display(params.text).slice(0, 2000)}`);
      return null;
    case 'notify':
      state.output.push(`notify: ${display(params.message)}`);
      return null;
    case 'seek':
      state.output.push(`seek: ${display(params.ms)}`);
      return null;
    default:
      throw new Error(`unknown method ${method}`);
  }
}
function sandboxMessage(state: UserCheck, value: unknown, port: MessagePort, finish: () => void): void {
  if (!record(value) || typeof value.method !== 'string') return;
  const params = record(value.params) ? value.params : {};
  switch (value.method) {
    case 'heartbeat':
      return;
    case 'error':
      state.errors.push(display(params.message));
      finish();
      return;
    case 'log':
      state.output.push(display(params.message));
      return;
    case 'done':
    case 'rendered':
      state.output.push('completed');
      finish();
      return;
  }
  if (typeof value.id !== 'number') return;
  try {
    port.postMessage({ id: value.id, ok: true, result: fixtureReply(state, { id: value.id, method: value.method, params }) });
  } catch (error) {
    port.postMessage({ id: value.id, ok: false, error: display(error) });
  }
}
function runSandbox(state: UserCheck, mode: string, contribution: string): Promise<void> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.src = '/_malleable/sandbox.html';
  document.body.append(iframe);
  return new Promise((resolve) => {
    let port: MessagePort | undefined;
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener('message', ready);
      port?.close();
      if (mode === 'action') iframe.remove();
      resolve();
    };
    const timer = setTimeout(() => {
      state.errors.push('timed out after 3 seconds');
      finish();
    }, 3000);
    const ready = (event: MessageEvent<unknown>) => {
      if (event.source !== iframe.contentWindow || !record(event.data) || event.data.replaysSandbox !== 'ready') return;
      window.removeEventListener('message', ready);
      const channel = new MessageChannel();
      const current = channel.port1;
      port = current;
      current.addEventListener('message', (message: MessageEvent<unknown>) => sandboxMessage(state, message.data, current, finish));
      current.start();
      iframe.contentWindow?.postMessage(
        {
          type: 'init',
          mode,
          contribution,
          source: state.file.source,
          theme: 'dark',
          vars: {},
          time: 0,
          ...(state.file.manifest.permissions.includes('replay:read') ? { replay: { ...state.replay, events: undefined } } : {}),
        },
        '*',
        [channel.port2],
      );
    };
    window.addEventListener('message', ready);
  });
}
/** Runs the real CSP sandbox; fixture writes are reported without persistence. */
export async function checkUserPlugin(file: UserPluginFile, replay: ReplayBundle): Promise<void> {
  const report: CheckReport = { output: [], errors: [] };
  const settings = Object.fromEntries((file.manifest.settings ?? []).map((setting) => [setting.id, setting.default]));
  const modes = { tabs: 'tab', panels: 'panel', actions: 'action' };
  for (const kind of ['tabs', 'panels', 'actions'] as const) {
    for (const contribution of file.manifest.contributes[kind] ?? []) {
      const state: UserCheck = { file, replay, settings, output: [], errors: [] };
      await runSandbox(state, modes[kind], contribution.id);
      const prefix = `${modes[kind]}:${contribution.id}`;
      report.output.push(...state.output.map((message) => `${prefix}: ${message}`));
      report.errors.push(...state.errors.map((message) => `${prefix}: ${message}`));
    }
  }
  Object.assign(window, { __pluginCheck: { ...report, done: true } });
}
/** Serializes the harness with its helpers for both source execution and the bundled CLI. */
export function browserHarnessSource(kind: 'user' | 'browser'): string {
  const functions = [
    display,
    record,
    makeHost,
    fixtureContext,
    renderPage,
    renderEntries,
    checkLegacy,
    settingReply,
    fixtureReply,
    sandboxMessage,
    runSandbox,
    checkBrowserEntry,
    checkUserPlugin,
  ];
  return `${functions.map((fn) => fn.toString()).join('\n')}\n${kind === 'user' ? checkUserPlugin.name : checkBrowserEntry.name}`;
}
