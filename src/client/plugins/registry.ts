import type {
  IndexColumnDefinition,
  IndexFilterDefinition,
  IndexSectionDefinition,
  InspectorTabDefinition,
  ViewerActionDefinition,
  ViewerPanelDefinition,
  ViewerPluginApi,
} from './api.ts';

const ID = /^[a-z][a-z0-9-]*$/;
/**
 * Who may register: a host plugin by its name (no `:`, src/plugin/define.ts), or a sandboxed user plugin as `user:<id>`
 * (src/client/malleable/manager.ts). Keys are `plugin:<owner>:<id>`, so the two can never collide, and a user plugin's
 * replacePlugin/removePlugin only ever touches its own registrations.
 */
const OWNER = /^(user:)?[a-z][a-z0-9-]*$/;
/** The same rule as the server's `api.indexFilter` (src/plugin/registry.ts). */
export const INDEX_FILTER_PARAM = /^x-[a-z0-9][a-z0-9-]{0,38}$/;

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
  columns: readonly Registered<IndexColumnDefinition>[];
  filters: readonly Registered<IndexFilterDefinition>[];
  sections: readonly Registered<IndexSectionDefinition>[];
}

const EMPTY: Snapshot = { tabs: [], actions: [], panels: [], columns: [], filters: [], sections: [] };
const KINDS = Object.keys(EMPTY) as Array<keyof Snapshot>;

/** Per kind: the function a definition must have (none for filters, which only set a query parameter). */
const CALLBACK: Record<keyof Snapshot, 'render' | 'run' | undefined> = {
  tabs: 'render',
  actions: 'run',
  panels: 'render',
  columns: 'render',
  filters: undefined,
  sections: 'render',
};

/** A filter's own fields; a malformed one would break the filter menu for every plugin. */
function checkFilter(plugin: string, definition: IndexFilterDefinition, filters: Snapshot['filters']) {
  const fail = (message: string): never => {
    throw new ViewerPluginError(`${plugin}: filters "${definition.id}": ${message}`);
  };
  if (!['switch', 'choice', 'text'].includes(definition.type)) fail('type must be "switch", "choice" or "text"');
  if (typeof definition.param !== 'string' || !INDEX_FILTER_PARAM.test(definition.param))
    fail(`param must look like "x-env" (got ${JSON.stringify(definition.param)})`);
  if (filters.some((entry) => entry.definition.param === definition.param)) fail(`param ${definition.param} is already taken`);
  if (definition.type === 'choice') {
    const options = definition.options;
    if (!Array.isArray(options) || !options.length) fail('a choice needs options');
    for (const option of options!)
      if (!option || typeof option.value !== 'string' || !option.value || typeof option.label !== 'string' || !option.label.trim())
        fail('each option needs a value and a label');
  }
}

const byOrder = <T extends { order?: number }>(a: Registered<T>, b: Registered<T>) =>
  (a.definition.order ?? 0) - (b.definition.order ?? 0) || a.seq - b.seq;

/** What loaded client entries registered. A store: the UI subscribes and re-renders when plugins arrive. */
export class ViewerRegistry {
  private snapshotValue: Snapshot = EMPTY;
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
    const callback = CALLBACK[kind];
    if (callback && typeof d[callback] !== 'function')
      throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}" needs a ${callback} function`);
    const update = (d as { update?: unknown }).update;
    if (kind === 'sections' && update !== undefined && typeof update !== 'function')
      throw new ViewerPluginError(`${plugin}: sections "${d.id}": update must be a function`);
    const key = `plugin:${plugin}:${d.id}`;
    if (this.snapshotValue[kind].some((entry) => entry.key === key))
      throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}" is registered twice`);
    if (kind === 'filters') checkFilter(plugin, definition as IndexFilterDefinition, this.snapshotValue.filters);
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
      registerIndexColumn: (definition) => this.add('columns', plugin, definition, definition?.label, notify),
      registerIndexFilter: (definition) => this.add('filters', plugin, definition, definition?.label, notify),
      registerIndexSection: (definition) => this.add('sections', plugin, definition, definition?.title, notify),
    };
  }

  /**
   * Swaps everything one plugin registered for what `register` registers now, as one change: the UI re-renders once, a tab
   * that exists before and after keeps its place (and stays selected). This is how a plugin hot-reloads.
   */
  replacePlugin(plugin: string, register: (api: ViewerPluginApi) => void) {
    const before = this.snapshotValue;
    this.snapshotValue = Object.fromEntries(
      KINDS.map((kind) => [kind, (before[kind] as readonly Registered<unknown>[]).filter((entry) => entry.plugin !== plugin)]),
    ) as unknown as Snapshot;
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
    this.snapshotValue = EMPTY;
    this.seq = 0;
    for (const listener of this.listeners) listener();
  }
}

export const viewerRegistry = new ViewerRegistry();
