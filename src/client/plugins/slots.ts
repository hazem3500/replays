import { assertMayOverride, defaultPolicy, type MalleablePolicy } from '../../shared/malleable-policy.ts';

/** Public slot names. Distributions may also define names of their own. */
export const SLOT_NAMES = [
  'viewer.inspector.tabs',
  'viewer.panels.side',
  'viewer.actions',
  'viewer.shortcuts',
  'viewer.scrubber.tracks',
  'viewer.context.sections',
  'index.row.columns',
  'index.filters',
  'index.sections',
  'settings.sections',
  'index.chips',
  'inspector.network.columns',
  'performance.vitals',
  'editor.topbar.actions',
  'editor.inspector.sections',
  'editor.tools',
  'editor.timeline.lanes',
  'export.formats',
] as const;

export interface SlotDescriptor<C, R = unknown> {
  /** `core:<id>` or `plugin:<owner>:<id>`. */
  id: string;
  /** Lower first. Built-ins conventionally use 100, 200, … */
  order: number;
  when?(context: C): boolean;
  render(context: C): R;
}

export interface SlotConfiguration {
  /** These ids come first, in this order; unspecified items retain numeric order. */
  order?: readonly string[];
  hide?: readonly string[];
}

/** Context for DOM contributions made with the existing register* methods. */
export interface SlotMountContext<C> {
  container: HTMLElement;
  context: C;
}

const ITEM_ID = /^(core:[a-z][a-z0-9-]*|plugin:(?:user:)?[a-z][a-z0-9-]*:[a-z][a-z0-9-]*)$/;

function surface(slot: string, id: string) {
  const kinds: Record<string, string> = {
    'viewer.inspector.tabs': 'inspector',
    'viewer.panels.side': 'panel',
    'viewer.actions': 'action',
  };
  const kind = kinds[slot];
  return kind ? `${kind}:${id.replace(/^(core|plugin):/, '')}` : `${slot}/${id}`;
}

/** One ordered list, including core items. Resolution never mutates descriptors or calls render. */
export class SlotRegistry<C, R = unknown> {
  private items: readonly SlotDescriptor<C, R>[] = [];
  private configuration: SlotConfiguration = {};
  readonly name: string;
  private readonly policy: () => MalleablePolicy;
  constructor(name: string, policy: () => MalleablePolicy = defaultPolicy) {
    this.name = name;
    this.policy = policy;
  }

  register(item: SlotDescriptor<C, R>) {
    if (
      !ITEM_ID.test(item.id) ||
      !Number.isFinite(item.order) ||
      typeof item.render !== 'function' ||
      (item.when !== undefined && typeof item.when !== 'function')
    )
      throw new TypeError(`invalid descriptor for slot ${this.name}: ${item.id}`);
    if (this.items.some((existing) => existing.id === item.id)) throw new Error(`${this.name}: ${item.id} is registered twice`);
    this.items = [...this.items, { ...item }];
  }

  configure(configuration: SlotConfiguration) {
    for (const key of Object.keys(configuration))
      if (key !== 'order' && key !== 'hide') throw new TypeError(`unknown slot configuration: ${key}`);
    for (const ids of [configuration.order, configuration.hide]) {
      if (ids === undefined) continue;
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !ITEM_ID.test(id)))
        throw new TypeError('slot order/hide must contain unique namespaced item ids');
      for (const id of ids) {
        assertMayOverride(this.policy(), surface(this.name, String(id)));
        assertMayOverride(this.policy(), `${this.name}/${id}`);
      }
    }
    this.configuration = { order: [...(configuration.order ?? [])], hide: [...(configuration.hide ?? [])] };
  }

  /** Pure, deterministic merge. Built-ins are supplied by their owning view, in the same descriptor format. */
  resolve(context: C, builtins: readonly SlotDescriptor<C, R>[] = [], evaluateWhen = true): readonly SlotDescriptor<C, R>[] {
    const ids = new Set<string>();
    const merged = [...builtins, ...this.items];
    for (const item of merged) {
      if (ids.has(item.id)) throw new Error(`${this.name}: ${item.id} is registered twice`);
      ids.add(item.id);
    }
    const { order = [], hide = [] } = this.configuration;
    // invariant: a stricter policy cannot leave an earlier override in force.
    const locked = (id: string) =>
      this.policy().lockedSurfaces.includes(surface(this.name, id)) || this.policy().lockedSurfaces.includes(`${this.name}/${id}`);
    const rank = (id: string) => (locked(id) ? -1 : order.indexOf(id));
    return merged
      .filter((item) => (!hide.includes(item.id) || locked(item.id)) && (!evaluateWhen || !item.when || item.when(context)))
      .sort((a, b) => {
        const ar = rank(a.id),
          br = rank(b.id);
        return ar >= 0 || br >= 0 ? (ar < 0 ? Infinity : ar) - (br < 0 ? Infinity : br) : a.order - b.order;
      });
  }

  /** Internal lifecycle support: hot reload removes only the owner's items. */
  removeOwner(owner: string) {
    this.items = this.items.filter((item) => !item.id.startsWith(`plugin:${owner}:`));
  }
  checkpoint() {
    return { items: this.items, configuration: this.configuration };
  }
  restore(state: ReturnType<SlotRegistry<C, R>['checkpoint']>) {
    this.items = state.items;
    this.configuration = state.configuration;
  }
}
