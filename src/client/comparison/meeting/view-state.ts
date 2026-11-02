import { MAX_TILES, type MeetingSearch } from './url.ts';

/** What the viewer arranged: order, pin, hidden and muted tiles, scenario starts. Mirrored into the URL. */
export interface ViewState {
  ids: string[];
  pin: string | undefined;
  hide: string[];
  mute: string[];
  align: Record<string, number>;
}

export function viewFromSearch(search: MeetingSearch, fallbackIds: readonly string[] = []): ViewState {
  const ids = search.ids?.length ? search.ids : fallbackIds.slice(0, MAX_TILES);
  const known = (list: readonly string[] | undefined) => (list ?? []).filter((id) => ids.includes(id));
  return {
    ids: [...ids],
    pin: search.pin && ids.includes(search.pin) && !search.hide?.includes(search.pin) ? search.pin : undefined,
    hide: known(search.hide),
    mute: known(search.mute),
    align: Object.fromEntries(Object.entries(search.align ?? {}).filter(([id]) => ids.includes(id))),
  };
}

/** A suite's runs (`suiteIds`) are written as `ids` only once the viewer changed the set or its order. */
export function searchFromView(view: ViewState, base: Pick<MeetingSearch, 'suite'>, suiteIds?: readonly string[]): MeetingSearch {
  const sameAsSuite = suiteIds !== undefined && suiteIds.join(',') === view.ids.join(',');
  return {
    ...(base.suite ? { suite: base.suite } : {}),
    ...(sameAsSuite ? {} : { ids: view.ids }),
    ...(view.pin ? { pin: view.pin } : {}),
    ...(Object.keys(view.align).length ? { align: view.align } : {}),
    ...(view.hide.length ? { hide: view.hide } : {}),
    ...(view.mute.length ? { mute: view.mute } : {}),
  };
}

const toggle = (list: readonly string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

export const views = {
  /** Pins `id` to the large view, or unpins it. */
  pin: (view: ViewState, id: string): ViewState => ({
    ...view,
    pin: view.pin === id ? undefined : id,
    hide: view.hide.filter((item) => item !== id),
  }),
  unpin: (view: ViewState): ViewState => (view.pin ? { ...view, pin: undefined } : view),
  hide: (view: ViewState, id: string): ViewState =>
    view.ids.length - view.hide.length <= 1 && !view.hide.includes(id)
      ? view
      : { ...view, hide: toggle(view.hide, id), pin: view.pin === id ? undefined : view.pin },
  mute: (view: ViewState, id: string): ViewState => ({ ...view, mute: toggle(view.mute, id) }),
  /** Dropping onto the large view pins the dragged tile; otherwise the two trade places. */
  swap: (view: ViewState, from: string, to: string): ViewState => {
    if (view.pin === to) return { ...view, pin: from };
    if (view.pin === from) return { ...view, pin: to };
    const ids = [...view.ids];
    const a = ids.indexOf(from);
    const b = ids.indexOf(to);
    if (a < 0 || b < 0) return view;
    [ids[a], ids[b]] = [ids[b]!, ids[a]!];
    return { ...view, ids };
  },
  add: (view: ViewState, ids: readonly string[]): ViewState => ({
    ...view,
    ids: [...view.ids, ...ids.filter((id) => !view.ids.includes(id))].slice(0, MAX_TILES),
  }),
  align: (view: ViewState, starts: Readonly<Record<string, number>>): ViewState => ({
    ...view,
    align: Object.fromEntries(Object.entries(starts).filter(([id, value]) => view.ids.includes(id) && value !== 0)),
  }),
};

/**
 * How recordings are arranged: `single` is the suite's one-run viewer (outside the meeting view), `grid` shows
 * equal tiles, `spotlight` one large tile with the rest in a filmstrip.
 */
export type MeetingLayout = 'single' | 'grid' | 'spotlight';
export type TileLayout = Exclude<MeetingLayout, 'single'>;

/** A pinned tile is the spotlight; otherwise the grid. */
export const layoutOf = (search: Pick<MeetingSearch, 'pin'>): TileLayout => (search.pin ? 'spotlight' : 'grid');

/** The search for `layout`: spotlight keeps its pin, else pins `preferred` (or the first shown tile); grid unpins. */
export function withLayout(search: MeetingSearch, layout: TileLayout, ids: readonly string[], preferred?: string): MeetingSearch {
  if (layout === 'grid') {
    const { pin: _pin, ...rest } = search;
    return rest;
  }
  const shown = ids.filter((id) => !search.hide?.includes(id));
  if (search.pin && shown.includes(search.pin)) return search;
  const pin = preferred && shown.includes(preferred) ? preferred : shown[0];
  return pin ? { ...search, pin } : search;
}
