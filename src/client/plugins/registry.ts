import type { InspectorTabDefinition, ViewerActionDefinition, ViewerPanelDefinition, ViewerPluginApi } from './api.ts';

const ID = /^[a-z][a-z0-9-]*$/;

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

  private add<K extends keyof Snapshot>(kind: K, plugin: string, definition: Snapshot[K][number]['definition'], label: string) {
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
    for (const listener of this.listeners) listener();
  }

  /** The API one plugin's entry receives. Registration errors throw to the entry (and are logged by the loader). */
  apiFor(plugin: string): ViewerPluginApi {
    return {
      pluginName: plugin,
      registerInspectorTab: (definition) => this.add('tabs', plugin, definition, definition?.label),
      registerViewerAction: (definition) => this.add('actions', plugin, definition, definition?.label),
      registerViewerPanel: (definition) => this.add('panels', plugin, definition, definition?.title),
    };
  }

  /** Tests only. */
  reset() {
    this.snapshotValue = { tabs: [], actions: [], panels: [] };
    this.seq = 0;
    for (const listener of this.listeners) listener();
  }
}

export const viewerRegistry = new ViewerRegistry();
