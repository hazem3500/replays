import { bindUserSettings } from '../plugins/settings.ts';
import { useSyncExternalStore } from 'react';

import {
  authoredManifest,
  parseManifest,
  parsePluginFile,
  parseSource,
  PluginFormatError,
  type PluginScope,
  type PluginVersion,
  pluginFile,
  type UserPluginManifest,
} from '../../shared/malleable.ts';
import type { ViewerPluginContext } from '../plugins/api.ts';
import { viewerRegistry } from '../plugins/registry.ts';
import { acceptWorkspacePlugin, deletePlugin, getHistory, listPlugins, mintApproval, savePlugin } from './api.ts';
import { permissions, type PluginRef } from './broker.ts';
import { recordLoad } from './health.ts';
import { hostInfo } from './host.ts';
import { mountSandbox } from './sandbox.ts';
import { setMalleableUi } from './ui-state.ts';

export type Origin = 'saved' | 'workshop' | 'agent';

export interface Diagnostic {
  at: number;
  level: string;
  message: string;
}

export interface PluginEntry {
  id: string;
  scope: PluginScope;
  manifest: UserPluginManifest;
  source: string;
  /** Where the working copy came from: the store, the editor (new or imported), or an agent. */
  origin: Origin;
  /** The saved history, when this plugin has been saved (latest last). */
  versions: PluginVersion[];
  /** Bumped on every (re)load: a hot reload is a new revision. */
  revision: number;
  diagnostics: Diagnostic[];
  /** Saved workspace version is not run until this person accepts its notice. */
  needsAcceptance?: boolean;
}

export interface ManagerState {
  entries: readonly PluginEntry[];
  /** Plugins the person switched off on this device (kept saved, not loaded). */
  disabled: readonly string[];
  /** The open replay's context, when a viewer is mounted. */
  viewer: ViewerPluginContext | undefined;
}

const MAX_DIAGNOSTICS = 200;
const DISABLED_KEY = 'replays-malleable-disabled';
/**
 * A user plugin's name in the viewer registry: `user:<id>`, so its keys are `plugin:user:<id>:<contribution>`. Host plugin
 * names cannot contain `:` (src/plugin/define.ts), so a user plugin can never take, replace or remove a host plugin's
 * registrations, whatever its id.
 */
export const registryName = (id: string) => `user:${id}`;

function readDisabled(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISABLED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export const latestSaved = (entry: PluginEntry) => entry.versions.at(-1);
/** Same as authored: `targets` is the server's record of where a version was kept, not part of what the author wrote. */
export const sameManifest = (a: UserPluginManifest, b: UserPluginManifest) =>
  JSON.stringify(authoredManifest(a)) === JSON.stringify(authoredManifest(b));
/** The saved, unchanged version a plugin is running, if it is running one: what load health is recorded for. */
const runningSaved = (entry: PluginEntry) => (isDirty(entry) ? undefined : latestSaved(entry));
/** The working copy differs from the latest saved version (or was never saved). */
export function isDirty(entry: PluginEntry) {
  const saved = latestSaved(entry);
  return !saved || saved.source !== entry.source || !sameManifest(saved.manifest, entry.manifest);
}

/**
 * The live plugin set: what is loaded in this tab (saved plugins and unsaved drafts), kept in step with the viewer's plugin
 * registry (src/client/plugins/registry.ts). A plugin's tabs, panels and actions are registered there like any browser
 * plugin's, but each `render`/`run` starts a sandboxed frame (sandbox.ts) instead of running the author's code in the
 * page. A change to a plugin replaces its registrations in one step (`replacePlugin`): that is the hot reload.
 */
class PluginManager {
  private state: ManagerState = { entries: [], disabled: [], viewer: undefined };
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  /** A PUT may commit even when its response/history request is cancelled. Reconcile before any retry. */
  private readonly pendingSaves = new Map<string, { scope: PluginScope; baseVersion: number }>();
  /** What is mounted right now, so a reload can tear the old frames down. */
  private mounted = new Map<string, Set<{ dispose(): void }>>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.state;

  private set(patch: Partial<ManagerState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  get(id: string) {
    return this.state.entries.find((entry) => entry.id === id);
  }

  setViewer(viewer: ViewerPluginContext | undefined) {
    this.set({ viewer });
  }

  /** Loads the person's saved plugins (user and workspace) at start-up. A broken one is logged and skipped. */
  async loadSaved() {
    this.set({ disabled: readDisabled() });
    const summaries = await listPlugins();
    await Promise.all(
      summaries.map(async (summary) => {
        try {
          const history = await getHistory(summary.scope, summary.id);
          const latest = history.versions.at(-1);
          if (!latest) return;
          this.put({
            id: summary.id,
            scope: summary.scope,
            manifest: authoredManifest(latest.manifest),
            source: latest.source,
            origin: 'saved',
            needsAcceptance: summary.requiresReview === true,
            versions: history.versions,
            revision: ++this.revision,
            diagnostics: [],
          });
        } catch (error) {
          console.error(`plugin ${summary.id} could not be loaded:`, error);
        }
      }),
    );
  }

  private put(entry: PluginEntry, reload = true) {
    const others = this.state.entries.filter((existing) => existing.id !== entry.id);
    this.set({ entries: [...others, entry].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)) });
    if (reload) this.sync(entry.id);
  }

  /** Registers (or re-registers) the plugin's contributions in the viewer registry; unloads them when disabled or gone. */
  private sync(id: string) {
    const entry = this.get(id);
    for (const handle of this.mounted.get(id) ?? []) handle.dispose();
    this.mounted.delete(id);
    permissions.drop(id);
    if (!entry || entry.needsAcceptance || this.state.disabled.includes(id)) {
      viewerRegistry.removePlugin(registryName(id));
      return;
    }
    const track = (handle: { dispose(): void }) => {
      let set = this.mounted.get(id);
      if (!set) this.mounted.set(id, (set = new Set()));
      set.add(handle);
      return () => {
        handle.dispose();
        set.delete(handle);
      };
    };
    // The frame reads the entry at mount time, so a reload that lands while a tab is open shows the new source.
    const ref = (): PluginRef => {
      const current = this.get(id) ?? entry;
      return {
        id,
        scope: current.scope,
        manifest: current.manifest,
        source: current.source,
        log: (level, message) => this.log(id, level, message),
      };
    };
    const saved = runningSaved(entry);
    try {
      this.register(entry, ref, track);
    } catch (error) {
      if (saved) recordLoad(hostInfo().versions, id, saved.sha256, false);
      throw error;
    }
    if (saved) recordLoad(hostInfo().versions, id, saved.sha256, true);
  }

  private register(entry: PluginEntry, ref: () => PluginRef, track: (handle: { dispose(): void }) => () => void) {
    const { contributes } = entry.manifest;
    if (entry.manifest.settings?.length) bindUserSettings(registryName(entry.id), entry.scope, entry.id);
    viewerRegistry.replacePlugin(registryName(entry.id), (api) => {
      for (const setting of entry.manifest.settings ?? []) api.registerSetting(setting);
      for (const tab of contributes.tabs ?? [])
        api.registerInspectorTab({
          id: tab.id,
          label: tab.label,
          order: 100,
          render: (container, context) => track(mountSandbox({ plugin: ref(), mode: 'tab', contribution: tab.id, container, context })),
        });
      for (const panel of contributes.panels ?? [])
        api.registerViewerPanel({
          id: panel.id,
          title: panel.label,
          render: (container, context) => track(mountSandbox({ plugin: ref(), mode: 'panel', contribution: panel.id, container, context })),
        });
      for (const action of contributes.actions ?? [])
        api.registerViewerAction({
          id: action.id,
          label: action.label,
          run: async (context) => {
            const host = document.body;
            const handle = mountSandbox({ plugin: ref(), mode: 'action', contribution: action.id, container: host, context });
            const untrack = track(handle);
            await handle.done;
            untrack();
          },
        });
    });
  }

  log(id: string, level: string, message: string) {
    const entry = this.get(id);
    if (!entry) return;
    const diagnostics = [...entry.diagnostics, { at: Date.now(), level, message }].slice(-MAX_DIAGNOSTICS);
    // An error from a saved, unchanged version is a failed load of that version (src/client/malleable/health.ts).
    const saved = level === 'error' ? runningSaved(entry) : undefined;
    if (saved) recordLoad(hostInfo().versions, id, saved.sha256, false);
    // Diagnostics change often and must not reload anything: replace the entry without syncing.
    this.set({ entries: this.state.entries.map((existing) => (existing.id === id ? { ...existing, diagnostics } : existing)) });
  }

  /**
   * Loads a working copy: from the editor (`workshop`) or an agent. The same id replaces the loaded copy (hot reload);
   * nothing is stored. Throws PluginFormatError for a manifest or source that does not validate.
   */
  upsert(input: { manifest: unknown; source: unknown; origin: Origin; scope?: PluginScope }): PluginEntry {
    const manifest = parseManifest(input.manifest);
    const source = parseSource(input.source);
    const existing = this.get(manifest.id);
    const entry: PluginEntry = {
      id: manifest.id,
      // A new plugin goes to the first scope the host keeps (malleable.scopes): `user` unless only `workspace` is on.
      scope: existing?.scope ?? input.scope ?? hostInfo().policy.scopes[0] ?? 'user',
      manifest,
      source,
      origin: input.origin,
      ...(existing?.needsAcceptance ? { needsAcceptance: true } : {}),
      versions: existing?.versions ?? [],
      revision: ++this.revision,
      diagnostics: [],
    };
    this.put(entry);
    // A tab someone is looking at stays selected only if the id survived; nothing to do here.
    return entry;
  }

  /** Reloads the loaded copy as it is (the editor's "Run"). */
  reload(id: string) {
    const entry = this.get(id);
    if (entry) this.upsert({ manifest: entry.manifest, source: entry.source, origin: entry.origin, scope: entry.scope });
  }

  /** Drops the working copy: a never-saved draft disappears, a saved plugin returns to its latest saved version. */
  discard(id: string) {
    const entry = this.get(id);
    if (!entry) return;
    const saved = latestSaved(entry);
    if (saved)
      this.put({
        ...entry,
        manifest: authoredManifest(saved.manifest),
        source: saved.source,
        origin: 'saved',
        revision: ++this.revision,
        diagnostics: [],
      });
    else {
      this.set({ entries: this.state.entries.filter((existing) => existing.id !== id) });
      this.sync(id);
    }
  }

  /** Where a never-saved plugin will be stored: just this person, or everyone in the workspace. Fixed after the first save. */
  setScope(id: string, scope: PluginScope) {
    const entry = this.get(id);
    if (!entry || entry.versions.length) return;
    this.put({ ...entry, scope, revision: ++this.revision }, false);
  }

  async acceptWorkspace(id: string) {
    const entry = this.get(id);
    const version = entry && latestSaved(entry);
    if (entry?.scope !== 'workspace' || !version || !entry.needsAcceptance) throw new Error('no workspace version awaiting review');
    if (isDirty(entry)) throw new Error('discard the draft before enabling the saved workspace version');
    await acceptWorkspacePlugin(id, version.sha256);
    if (this.get(id) !== entry) throw new Error('plugin changed; review it again');
    this.put({ ...entry, needsAcceptance: false });
  }

  setEnabled(id: string, enabled: boolean) {
    const disabled = enabled ? this.state.disabled.filter((item) => item !== id) : [...new Set([...this.state.disabled, id])];
    try {
      localStorage.setItem(DISABLED_KEY, JSON.stringify(disabled));
    } catch {
      /* private mode: the switch lasts for this page */
    }
    this.set({ disabled });
    this.sync(id);
  }

  /**
   * Stores the working copy as the next version. Called only by the approval dialog after the person clicked Approve: it
   * is the one place that asks the server for a consent token.
   */
  private async reconcileSave(id: string, keepPending = false) {
    const pending = this.pendingSaves.get(id);
    if (!pending) return false;
    const versions = await getHistory(pending.scope, id, AbortSignal.timeout(10_000))
      .then((history) => history.versions)
      .catch((error: unknown) => {
        if (error instanceof Error && 'status' in error && error.status === 404) return [];
        throw error;
      });
    const current = this.get(id);
    if (current && current.scope === pending.scope) {
      const latest = versions.at(-1);
      const saved = latest && latest.source === current.source && sameManifest(latest.manifest, current.manifest);
      // Reconcile receipt/history only. Never put an older source back over a newer working draft.
      this.put({ ...current, versions, origin: saved ? 'saved' : current.origin }, false);
    }
    if (!keepPending) this.pendingSaves.delete(id);
    return (versions.at(-1)?.n ?? 0) !== pending.baseVersion;
  }

  async saveApproved(id: string, message: string, options: { revision?: number; signal?: AbortSignal } = {}) {
    let entry = this.get(id);
    if (!entry) throw new Error('no such plugin');
    const revision = entry.revision;
    const check = () => {
      options.signal?.throwIfAborted();
      if (this.get(id)?.revision !== revision || (options.revision !== undefined && options.revision !== revision))
        throw new Error('The draft changed; review it again before saving');
    };
    check();
    if (this.pendingSaves.has(id)) {
      const changed = await this.reconcileSave(id);
      check();
      entry = this.get(id)!;
      if (!isDirty(entry)) return; // The previously approved write already committed; do not append a duplicate version.
      if (changed) throw new Error('Saved history was refreshed; review the changes again before saving');
    }
    const approval = await mintApproval(
      { action: 'save', scope: entry.scope, id, manifest: entry.manifest, source: entry.source },
      options.signal,
    );
    check();
    const baseVersion = latestSaved(entry)?.n ?? 0;
    this.pendingSaves.set(id, { scope: entry.scope, baseVersion });
    try {
      await savePlugin(entry.scope, id, { manifest: entry.manifest, source: entry.source, message, baseVersion, approval }, options.signal);
    } catch (error) {
      // Cancellation cannot roll back a server commit. A bounded read may recover it, and retry reads again.
      await this.reconcileSave(id, true).catch(() => {});
      throw error;
    }
    await this.reconcileSave(id);
    check();
  }

  async deleteApproved(id: string) {
    const entry = this.get(id);
    if (!entry) return;
    if (entry.versions.length) {
      const approval = await mintApproval({ action: 'delete', scope: entry.scope, id });
      await deletePlugin(entry.scope, id, approval);
    }
    this.set({ entries: this.state.entries.filter((existing) => existing.id !== id) });
    this.sync(id);
  }

  /** Puts an old version in the editor as the working copy (unsaved until approved: that is "revert"). */
  loadVersion(id: string, n: number) {
    const entry = this.get(id);
    const version = entry?.versions.find((candidate) => candidate.n === n);
    if (!entry || !version) throw new Error(`no version ${n}`);
    this.put({
      ...entry,
      manifest: authoredManifest(version.manifest),
      source: version.source,
      origin: 'workshop',
      revision: ++this.revision,
      diagnostics: [],
    });
  }

  /** The `.replays-plugin.json` content for a plugin (working copy, optionally with its saved history). */
  exportFile(id: string, withVersions: boolean) {
    const entry = this.get(id);
    if (!entry) throw new Error('no such plugin');
    return pluginFile(entry.manifest, entry.source, withVersions && entry.versions.length ? entry.versions : undefined);
  }

  /** Loads a plugin file as a draft. */
  importFile(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PluginFormatError('that is not a JSON file');
    }
    const file = parsePluginFile(parsed);
    return this.upsert({ manifest: file.manifest, source: file.source, origin: 'workshop' });
  }

  requestKeep(id: string) {
    if (!this.get(id)) throw new Error('no such plugin');
    setMalleableUi({ keepFor: id });
  }
}

export const manager = new PluginManager();
export const useManager = () => useSyncExternalStore(manager.subscribe, manager.getSnapshot);
