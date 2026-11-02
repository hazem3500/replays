import { PluginPageRegistry } from './pages.ts';
import { defaultPolicy, type MalleablePolicy } from '../../shared/malleable-policy.ts';
import { SlotRegistry, type SlotConfiguration, type SlotDescriptor } from './slots.ts';
import { isSafeIconUrl } from '../../shared/icon-url.ts';
import type {
  ContextSectionDefinition,
  IndexColumnDefinition,
  IndexFilterDefinition,
  IndexSectionDefinition,
  InspectorTabDefinition,
  SettingDefinition,
  TimelineTrackDefinition,
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
  tracks: readonly Registered<TimelineTrackDefinition>[];
  contextSections: readonly Registered<ContextSectionDefinition>[];
  settings: readonly Registered<SettingDefinition>[];
}

const EMPTY: Snapshot = {
  tabs: [],
  actions: [],
  panels: [],
  columns: [],
  filters: [],
  sections: [],
  tracks: [],
  contextSections: [],
  settings: [],
};
const SLOT_BY_KIND: Record<keyof Snapshot, string> = {
  tabs: 'viewer.inspector.tabs',
  panels: 'viewer.panels.side',
  actions: 'viewer.actions',
  tracks: 'viewer.scrubber.tracks',
  contextSections: 'viewer.context.sections',
  columns: 'index.row.columns',
  filters: 'index.filters',
  sections: 'index.sections',
  settings: 'settings.sections',
};
const KINDS = Object.keys(EMPTY) as (keyof Snapshot)[];

/** The function each kind must have (settings have none). */
const NEEDS: Record<keyof Snapshot, string | undefined> = {
  tabs: 'render',
  actions: 'run',
  panels: 'render',
  columns: 'render',
  filters: undefined,
  sections: 'render',
  tracks: 'markers',
  contextSections: 'render',
  settings: undefined,
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

/** Kind-specific checks beyond id, label, order and the function. */
function check(kind: keyof Snapshot, plugin: string, definition: Record<string, unknown>) {
  const fail = (problem: string) => {
    throw new ViewerPluginError(`${plugin}: ${kind} "${String(definition.id)}": ${problem}`);
  };
  if (kind === 'actions') {
    if (definition.placement !== undefined && definition.placement !== 'more' && definition.placement !== 'bar')
      fail(`placement must be 'more' or 'bar'`);
    if (definition.icon !== undefined && !isSafeIconUrl(definition.icon)) fail('icon must be a data:image/svg+xml URL or an https URL');
  }
  if (kind === 'settings') {
    if (definition.type === 'boolean') {
      if (typeof definition.default !== 'boolean') fail('a boolean setting needs a boolean default');
    } else if (definition.type === 'choice') {
      const options = definition.options;
      if (
        !Array.isArray(options) ||
        options.length < 2 ||
        !options.every(
          (option) => typeof option?.value === 'string' && option.value && (option.label === undefined || typeof option.label === 'string'),
        )
      )
        fail('a choice setting needs at least two options with string values');
      const values = (options as { value: string }[]).map((option) => option.value);
      if (new Set(values).size !== values.length) fail('option values must be unique');
      if (!values.includes(definition.default as string)) fail('the default must be one of the option values');
    } else fail(`type must be 'boolean' or 'choice'`);
  }
}

/** What loaded client entries registered. A store: the UI subscribes and re-renders when plugins arrive. */
export class ViewerRegistry {
  readonly pages = new PluginPageRegistry();
  private snapshotValue: Snapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private seq = 0;
  private readonly slots = new Map<string, SlotRegistry<unknown>>();
  private readonly policy: () => MalleablePolicy;
  private policyValue: MalleablePolicy | undefined;
  constructor(policy: () => MalleablePolicy = defaultPolicy) {
    this.policy = policy;
  }
  setPolicy(policy: MalleablePolicy) {
    this.policyValue = policy;
    this.snapshotValue = { ...this.snapshotValue };
    for (const listener of this.listeners) listener();
  }

  private slot(name: string) {
    let slot = this.slots.get(name);
    if (!slot) {
      slot = new SlotRegistry(name, () => this.policyValue ?? this.policy());
      this.slots.set(name, slot);
    }
    return slot;
  }

  configureSlot(name: string, configuration: SlotConfiguration, notify = true) {
    this.slot(name).configure(configuration);
    // why: slot configuration needs a new store snapshot so subscribed views resolve the new order.
    this.snapshotValue = { ...this.snapshotValue };
    if (notify) for (const listener of this.listeners) listener();
  }

  registerSlotItem<C, R>(name: string, descriptor: SlotDescriptor<C, R>, notify = true) {
    this.slot(name).register(descriptor as SlotDescriptor<unknown>);
    this.snapshotValue = { ...this.snapshotValue };
    if (notify) for (const listener of this.listeners) listener();
  }

  resolveSlot<C, R>(name: string, builtins: readonly SlotDescriptor<C, R>[], context: C): readonly SlotDescriptor<C, R>[] {
    return this.slot(name).resolve(context, builtins as readonly SlotDescriptor<unknown>[]) as readonly SlotDescriptor<C, R>[];
  }

  /** Apply the same slot policy to legacy entries, preserving their metadata for existing renderers. */
  private visibleSnapshot(): Snapshot {
    const snapshot = { ...this.snapshotValue };
    for (const kind of KINDS) {
      const entries = this.snapshotValue[kind];
      const ids = new Set(
        this.slot(SLOT_BY_KIND[kind])
          .resolve(undefined, [], false)
          .map((item) => item.id),
      );
      const rank = [...ids];
      (snapshot as Record<keyof Snapshot, unknown>)[kind] = entries
        .filter((entry) => ids.has(entry.key))
        .sort((a, b) => rank.indexOf(a.key) - rank.indexOf(b.key));
    }
    return snapshot;
  }
  private cachedSnapshot: Snapshot | undefined;
  private cachedSource: Snapshot | undefined;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => {
    if (this.cachedSource !== this.snapshotValue) {
      this.cachedSnapshot = this.visibleSnapshot();
      this.cachedSource = this.snapshotValue;
    }
    return this.cachedSnapshot ?? this.visibleSnapshot();
  };

  private add<K extends keyof Snapshot>(
    kind: K,
    plugin: string,
    definition: Snapshot[K][number]['definition'],
    label: string,
    notify = true,
  ) {
    if (!OWNER.test(plugin)) throw new ViewerPluginError(`${JSON.stringify(plugin)} is not a plugin name`);
    const d = definition as unknown as Record<string, unknown> | undefined;
    if (!d || typeof d.id !== 'string' || !ID.test(d.id))
      throw new ViewerPluginError(`${plugin}: ${kind} id must match ${ID} (got ${JSON.stringify(d?.id)})`);
    if (typeof label !== 'string' || !label.trim()) throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}" needs a label`);
    if (d.order !== undefined && !Number.isFinite(d.order))
      throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}": order must be a number`);
    const needs = NEEDS[kind];
    if (needs && typeof d[needs] !== 'function') throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}" needs a ${needs} function`);
    check(kind, plugin, d);
    if (kind === 'sections' && d.update !== undefined && typeof d.update !== 'function')
      throw new ViewerPluginError(`${plugin}: sections "${d.id}": update must be a function`);
    const key = `plugin:${plugin}:${d.id}`;
    if (this.snapshotValue[kind].some((entry) => entry.key === key))
      throw new ViewerPluginError(`${plugin}: ${kind} "${d.id}" is registered twice`);
    if (kind === 'filters') checkFilter(plugin, definition as IndexFilterDefinition, this.snapshotValue.filters);
    const entry = { plugin, key, definition, seq: this.seq++ };
    this.slot(SLOT_BY_KIND[kind]).register({
      id: key,
      order: 1000 + ((d.order as number | undefined) ?? 0),
      render: (input: unknown) => {
        const mount = input as { container: HTMLElement; context: unknown };
        if (needs === 'render') return (d.render as (container: HTMLElement, context: unknown) => unknown)(mount.container, mount.context);
        if (needs) return (d[needs] as (context: unknown) => unknown)(input);
        return definition;
      },
    });
    const next = [...this.snapshotValue[kind], entry].sort(byOrder as never);
    this.snapshotValue = { ...this.snapshotValue, [kind]: next };
    if (notify) for (const listener of this.listeners) listener();
  }

  /** The API one plugin's entry receives. Registration errors throw to the entry (and are logged by the loader). */
  apiFor(plugin: string, notify = true): ViewerPluginApi {
    return {
      pluginName: plugin,
      registerPluginPage: (definition) => {
        if (!OWNER.test(plugin) || plugin.startsWith('user:')) throw new ViewerPluginError('only host plugins may register pages');
        this.pages.register(plugin, definition);
      },
      configureSlot: (name, configuration) => {
        if (plugin.startsWith('user:')) throw new ViewerPluginError('sandboxed plugins cannot configure host slots');
        this.configureSlot(name, configuration, notify);
      },
      registerSlotItem: (name, descriptor) => {
        if (!descriptor.id.startsWith(`plugin:${plugin}:`)) throw new ViewerPluginError('slot items must use their plugin namespace');
        this.registerSlotItem(name, descriptor, notify);
      },
      registerInspectorTab: (definition) => this.add('tabs', plugin, definition, definition?.label, notify),
      registerViewerAction: (definition) => this.add('actions', plugin, definition, definition?.label, notify),
      registerViewerPanel: (definition) => this.add('panels', plugin, definition, definition?.title, notify),
      registerIndexColumn: (definition) => this.add('columns', plugin, definition, definition?.label, notify),
      registerIndexFilter: (definition) => this.add('filters', plugin, definition, definition?.label, notify),
      registerIndexSection: (definition) => this.add('sections', plugin, definition, definition?.title, notify),
      registerTimelineTrack: (definition) => this.add('tracks', plugin, definition, definition?.label, notify),
      registerContextSection: (definition) => this.add('contextSections', plugin, definition, definition?.title, notify),
      registerSetting: (definition) => this.add('settings', plugin, definition, definition?.label, notify),
    };
  }

  /**
   * Swaps everything one plugin registered for what `register` registers now, as one change: the UI re-renders once, a tab
   * that exists before and after keeps its place (and stays selected). This is how a plugin hot-reloads.
   */
  replacePlugin(plugin: string, register: (api: ViewerPluginApi) => void) {
    const before = this.snapshotValue;
    const pageState = this.pages.checkpoint();
    this.pages.removeOwner(plugin);
    const slotState = new Map([...this.slots].map(([name, slot]) => [name, slot.checkpoint()]));
    for (const slot of this.slots.values()) slot.removeOwner(plugin);
    const without = <T>(list: readonly Registered<T>[]) => list.filter((entry) => entry.plugin !== plugin);
    const next = { ...before };
    for (const kind of KINDS) (next as Record<keyof Snapshot, unknown>)[kind] = without(before[kind] as readonly Registered<unknown>[]);
    this.snapshotValue = next;
    try {
      register(this.apiFor(plugin, false));
    } catch (error) {
      this.snapshotValue = before;
      this.pages.restore(pageState);
      for (const [name, slot] of this.slots) {
        const state = slotState.get(name);
        if (state) slot.restore(state);
        else this.slots.delete(name);
      }
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
    this.slots.clear();
    this.pages.restore({ pages: new Map() });
    this.seq = 0;
    for (const listener of this.listeners) listener();
  }
}

export const viewerRegistry = new ViewerRegistry();
export const resolveSlot = <C, R>(name: string, builtins: readonly SlotDescriptor<C, R>[], context: C) =>
  viewerRegistry.resolveSlot(name, builtins, context);
