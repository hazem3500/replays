import type { InspectorTabDefinition, ViewerActionDefinition, ViewerPanelDefinition, ViewerPluginApi } from './api.ts';

const ID = /^[a-z][a-z0-9-]*$/;
/**
 * Who may register: a host plugin by its name (no `:`, src/plugin/define.ts), or a sandboxed user plugin as `user:<id>`
 * (src/client/malleable/manager.ts). Keys are `plugin:<owner>:<id>`, so the two can never collide, and a user plugin's
 * replacePlugin/removePlugin only ever touches its own registrations.
 */
const OWNER = /^(user:)?[a-z][a-z0-9-]*$/;

export class ViewerPluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewerPluginError';
  }
}

interface Registered<T> {
  plugin: string;
  /** Unique across plugins: `plugin:<plugin>:<id>`. */
  key: string;
  definition: T;
  seq: number;
}

export interface Snapshot {
  tabs: readonly Registered<InspectorTabDefinition>[];
  actions: readonly Registered<ViewerActionDefinition>[];
  panels: readonly Registered<ViewerPanelDefinition>[];
}

const byOrder = <T extends { order?: number }>(a: Registered<T>, b: Registered<T>) =>
  (a.definition.order ?? 0) - (b.definition.order ?? 0) || a.seq - b.seq;

/** What loaded client entries registered. A store: the UI subscribes and re-renders when plugins arrive. */
export class ViewerRegistry {
  private snapshotValue: Snapshot = { tabs: [], actions: [], panels: [] };
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.snapshotValue;

  private add<K extends keyof Snapshot>(
    kind: K,
    plugin: string,
    definition: Snapshot[K][number]['definition'],
    label: string,
    notify = true,
  ) {
    if (!OWNER.test(plugin)) throw new ViewerPluginError(`${JSON.stringify(plugin)} is not a plugin name`);
    const d = definition as { id?: unknown; order?: unknown; render?: unknown; run?: unknown };
    if (!d || typeof d.id !== 'string' || !ID.test(d.id))
      throw new ViewerPluginError(`${plugin}: ${kind} id must match ${ID} (got ${JSON.stringify(d?.id)})`);
    if (typeof label !== 'string' || !label.trim()) throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}" needs a label`);
    if (d.order !== undefined && !Number.isFinite(d.order))
      throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}": order must be a number`);
    if (kind === 'actions' ? typeof d.run !== 'function' : typeof d.render !== 'function')
      throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}" needs a ${kind === 'actions' ? 'run' : 'render'} function`);
    const key = `plugin:${plugin}:${d.id}`;
    if (this.snapshotValue[kind].some((entry) => entry.key === key))
      throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}" is registered twice`);
    const entry = { plugin, key, definition, seq: this.seq++ };
    const next = [...this.snapshotValue[kind], entry].sort(byOrder as never);
    this.snapshotValue = { ...this.snapshotValue, [kind]: next };
    if (notify) for (const listener of this.listeners) listener();
  }

  /** The API one plugin's entry receives. Registration errors throw to the entry (and are logged by the loader). */
  apiFor(plugin: string, notify = true): ViewerPluginApi {
    return {
      pluginName: plugin,
      registerInspectorTab: (definition) => this.add('tabs', plugin, definition, definition?.label, notify),
      registerViewerAction: (definition) => this.add('actions', plugin, definition, definition?.label, notify),
      registerViewerPanel: (definition) => this.add('panels', plugin, definition, definition?.title, notify),
    };
  }

  /**
   * Swaps everything one plugin registered for what `register` registers now, as one change: the UI re-renders once, a tab
   * that exists before and after keeps its place (and stays selected). This is how a plugin hot-reloads.
   */
  replacePlugin(plugin: string, register: (api: ViewerPluginApi) => void) {
    const before = this.snapshotValue;
    const without = <T>(list: readonly Registered<T>[]) => list.filter((entry) => entry.plugin !== plugin);
    this.snapshotValue = { tabs: without(before.tabs), actions: without(before.actions), panels: without(before.panels) };
    try {
      register(this.apiFor(plugin, false));
    } catch (error) {
      this.snapshotValue = before;
      throw error;
    } finally {
      for (const listener of this.listeners) listener();
    }
  }

  removePlugin(plugin: string) {
    this.replacePlugin(plugin, () => {});
  }

  /** Tests only. */
  reset() {
    this.snapshotValue = { tabs: [], actions: [], panels: [] };
    this.seq = 0;
    for (const listener of this.listeners) listener();
  }
}

export const viewerRegistry = new ViewerRegistry();
