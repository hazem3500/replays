import type { Owned } from '../plugin/registry.ts';
import type { ProfileInfo } from '../shared/profiles.ts';
import { assertViewPreset, BUILT_IN_VIEWS, type ViewInfo, type ViewPreset } from '../shared/views.ts';

/** The deployment's views: core's built-ins, retuned or extended by the config file (`views`) and plugins (`api.view`). */
export class ViewCatalog {
  readonly list: readonly ViewInfo[];
  private readonly byId: ReadonlyMap<string, ViewInfo>;

  constructor(views: readonly ViewInfo[] = BUILT_IN_VIEWS.map((view) => ({ ...view, order: view.order ?? 0, builtIn: true as const }))) {
    this.list = views;
    this.byId = new Map(views.map((view) => [view.id, view]));
  }

  has(id: string | undefined) {
    return id !== undefined && this.byId.has(id);
  }

  get(id: string | undefined) {
    return id === undefined ? undefined : this.byId.get(id);
  }
}

/** Throws unless the config file's `views` is a list of well-formed views with distinct ids. */
export function assertConfigViews(value: unknown): asserts value is ViewPreset[] {
  if (!Array.isArray(value)) throw new Error("the config file's views must be an array of { id, label, … }");
  const seen = new Set<string>();
  for (const [index, view] of value.entries()) {
    assertViewPreset(view, `views[${index}]`);
    if (seen.has(view.id)) throw new Error(`views[${index}]: ${JSON.stringify(view.id)} is declared twice`);
    seen.add(view.id);
  }
}

/** `override` over `base`, with `inspector` and `stage` merged key by key so a config can retune one field. */
function over(base: ViewPreset, override: ViewPreset): ViewPreset {
  const inspector = base.inspector || override.inspector ? { inspector: { ...base.inspector, ...override.inspector } } : {};
  const stage = base.stage || override.stage ? { stage: { ...base.stage, ...override.stage } } : {};
  return { ...base, ...override, ...inspector, ...stage };
}

/**
 * Built-ins first, then plugin views, each overridden field by field by a config entry with its id; config-only views
 * follow. Sorted by `order` (stable). Every profile's `view` must name one of them.
 */
export function createViewCatalog(
  options: {
    config?: readonly ViewPreset[] | undefined;
    plugins?: readonly Owned<ViewPreset>[];
    profiles?: readonly ProfileInfo[];
  } = {},
): ViewCatalog {
  const config = options.config ?? [];
  assertConfigViews(config);
  const declared: Array<{ view: ViewPreset; builtIn: boolean }> = [
    ...BUILT_IN_VIEWS.map((view) => ({ view, builtIn: true })),
    ...(options.plugins ?? []).map(({ value }) => ({ view: value, builtIn: false })),
  ];
  for (const entry of config) {
    const own = declared.find((item) => item.view.id === entry.id);
    if (own) Object.assign(own, { view: over(own.view, entry), builtIn: false });
    else declared.push({ view: entry, builtIn: false });
  }
  const list = declared
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.view.order ?? 0) - (b.item.view.order ?? 0) || a.index - b.index)
    .map(({ item }): ViewInfo => ({
      ...item.view,
      label: item.view.label.trim(),
      order: item.view.order ?? 0,
      ...(item.builtIn ? { builtIn: true } : {}),
    }));
  const catalog = new ViewCatalog(list);
  for (const profile of options.profiles ?? [])
    if (profile.view !== undefined && !catalog.has(profile.view))
      throw new Error(`profile ${JSON.stringify(profile.id)} opens in view ${JSON.stringify(profile.view)}, which is not defined`);
  return catalog;
}
