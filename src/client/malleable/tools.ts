import { PLUGIN_API_DOC } from '../../shared/malleable-tools.ts';
import { PluginFormatError } from '../../shared/malleable.ts';
import { surfaceId, targetsFor } from '../../shared/malleable-policy.ts';
import { viewerRegistry } from '../plugins/registry.ts';
import type { BuiltinInspectorTab } from '../viewer/context.ts';
import { permissions } from './broker.ts';
import { hostInfo } from './host.ts';
import { isDirty, latestSaved, manager, registryName } from './manager.ts';
import { themeVars } from './sandbox.ts';

/*
 * What each bridge tool does, in the page. Both doors use these: WebMCP's `execute` (webmcp.ts) and the MCP server's relayed
 * calls (bridge.ts). Reads return what the viewer shows; the only writes are loading a *draft* (sandboxed, unsaved),
 * navigating, and opening the keep dialog. Nothing here can save, delete or grant a permission.
 */

class ToolError extends Error {}

const BUILTIN_TABS: readonly BuiltinInspectorTab[] = ['console', 'network', 'performance', 'context'];

/** Every surface in the viewer now, by surface id (the ids `malleable.lockedSurfaces` uses), with who owns it. */
function surfaces() {
  const snapshot = viewerRegistry.getSnapshot();
  const locked = new Set(hostInfo().policy.lockedSurfaces);
  const entry = (id: string, owner: string, label: string) => ({ id, owner, label, ...(locked.has(id) ? { locked: true } : {}) });
  return [
    ...BUILTIN_TABS.map((tab) => entry(`inspector:${tab}`, 'built-in', tab)),
    ...snapshot.tabs.map((tab) => entry(surfaceId('tabs', tab.plugin, tab.definition.id), tab.plugin, tab.definition.label)),
    ...snapshot.panels.map((panel) => entry(surfaceId('panels', panel.plugin, panel.definition.id), panel.plugin, panel.definition.title)),
    ...snapshot.actions.map((action) =>
      entry(surfaceId('actions', action.plugin, action.definition.id), action.plugin, action.definition.label),
    ),
  ];
}

function viewer() {
  const context = manager.getSnapshot().viewer;
  if (!context) throw new ToolError('no replay is open: open a replay in the viewer first');
  return context;
}

function page<T>(items: readonly T[], input: Record<string, unknown>) {
  const limit = Math.min(500, Math.max(1, Number.isInteger(input.limit) ? (input.limit as number) : 100));
  const offset = Math.max(0, Number.isInteger(input.offset) ? (input.offset as number) : 0);
  return { total: items.length, offset, limit, items: items.slice(offset, offset + limit) };
}

function selectedTab() {
  return document.querySelector('[role="tab"][aria-selected="true"][id$="-tab"]')?.id.replace(/-tab$/, '') ?? null;
}

function summary() {
  return manager.getSnapshot().entries.map((entry) => ({
    id: entry.id,
    name: entry.manifest.name,
    scope: entry.scope,
    origin: entry.origin,
    savedVersion: latestSaved(entry)?.n ?? null,
    unsavedChanges: isDirty(entry),
    permissions: entry.manifest.permissions,
    registryKey: registryName(entry.id),
    enabled: !manager.getSnapshot().disabled.includes(entry.id),
  }));
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

export const toolHandlers: Record<string, ToolHandler> = {
  get_app_state() {
    const context = manager.getSnapshot().viewer;
    return {
      route: location.pathname,
      replay: context
        ? {
            id: context.replay.meta.id,
            title: context.replay.meta.title,
            url: context.replay.meta.url,
            durationMs: context.replay.meta.duration,
            counts: {
              steps: context.replay.steps.length,
              console: context.replay.console.length,
              consoleErrors: context.replay.console.filter((entry) => entry.level === 'error').length,
              network: context.replay.network.length,
              failedRequests: context.replay.network.filter((entry) => entry.status >= 400 || entry.status === 0).length,
            },
            playheadMs: Math.round(context.getTime()),
            theme: context.theme,
          }
        : null,
      selectedTab: selectedTab(),
      pluginTabs: [...document.querySelectorAll('[role="tab"][id^="plugin:"]')].map((tab) => tab.id.replace(/-tab$/, '')),
      plugins: summary(),
    };
  },

  get_replay_data(input) {
    const { replay } = viewer();
    const part = String(input.part);
    switch (part) {
      case 'meta':
        return replay.meta;
      case 'context':
        return replay.context ?? null;
      case 'performance':
        return replay.performance ?? null;
      case 'steps':
      case 'console':
      case 'network':
        return page(replay[part] as readonly unknown[], input);
      default:
        throw new ToolError('part must be one of meta, steps, console, network, performance, context');
    }
  },

  async get_comments() {
    const context = viewer();
    const { fetchComments } = await import('../comments/api.ts');
    const { comments } = await fetchComments(context.replay.meta.id);
    return { comments };
  },

  /** The reference, plus what this deployment looks like and allows, so a plugin written now fits it. */
  get_plugin_api: () => {
    const { policy, versions } = hostInfo();
    return {
      markdown: PLUGIN_API_DOC,
      theme: {
        scheme: manager.getSnapshot().viewer?.theme ?? (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
        tokens: themeVars(),
      },
      policy: { scopes: policy.scopes, capabilities: policy.capabilities, lockedSurfaces: policy.lockedSurfaces },
      versions: targetsFor(versions),
      surfaces: surfaces(),
    };
  },

  list_plugins: () => ({ plugins: summary() }),

  get_plugin(input) {
    const entry = manager.get(String(input.id));
    if (!entry) throw new ToolError(`no plugin "${String(input.id)}"`);
    return {
      id: entry.id,
      scope: entry.scope,
      manifest: entry.manifest,
      source: entry.source,
      unsavedChanges: isDirty(entry),
      versions: entry.versions.map(({ n, at, by, message }) => ({ n, at, by, message })),
    };
  },

  install_plugin_draft(input) {
    try {
      const existing =
        typeof (input.manifest as { id?: unknown } | undefined)?.id === 'string'
          ? manager.get((input.manifest as { id: string }).id)
          : undefined;
      const entry = manager.upsert({ manifest: input.manifest, source: input.source, origin: 'agent' });
      return {
        installed: true,
        id: entry.id,
        replaced: Boolean(existing),
        registryKey: registryName(entry.id),
        note: 'Loaded as a draft in a sandbox; nothing is saved. Check get_plugin_diagnostics, then ask the person with request_keep if they want to keep it.',
        grants: permissions.grantedFor(entry),
      };
    } catch (error) {
      if (error instanceof PluginFormatError) return { installed: false, error: error.message };
      throw error;
    }
  },

  remove_plugin_draft(input) {
    const id = String(input.id);
    if (!manager.get(id)) throw new ToolError(`no plugin "${id}"`);
    manager.discard(id);
    return { removed: true };
  },

  get_plugin_diagnostics(input) {
    const entry = manager.get(String(input.id));
    if (!entry) throw new ToolError(`no plugin "${String(input.id)}"`);
    return { revision: entry.revision, diagnostics: entry.diagnostics.map(({ level, message, at }) => ({ level, message, at })) };
  },

  open_tab(input) {
    const key = String(input.tab);
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (element) => element.id === `${key}-tab` || element.id === key,
    );
    if (!tab) throw new ToolError(`no tab "${key}"; see get_app_state`);
    tab.click();
    return { selectedTab: key };
  },

  seek(input) {
    const ms = Number(input.ms);
    if (!Number.isFinite(ms) || ms < 0) throw new ToolError('ms must be a non-negative number');
    viewer().seek(ms);
    return { playheadMs: Math.round(ms) };
  },

  request_keep(input) {
    const id = String(input.id);
    manager.requestKeep(id);
    return { asked: true, note: 'The approval dialog is open. The plugin is saved only if the person approves it.' };
  },
};

export { ToolError };
