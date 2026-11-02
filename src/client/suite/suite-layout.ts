import { meetingSearchParams, parseMeetingSearch, type MeetingSearch } from '../comparison/meeting/url.ts';
import { layoutOf, withLayout, type MeetingLayout } from '../comparison/meeting/view-state.ts';
import { formatSeconds } from '../permalink.ts';
import { suiteHref } from '../route.ts';

/**
 * How a suite shows its runs, in its own URL: no `layout` (or `single`) is one run in the full viewer;
 * `?layout=grid|spotlight` shows every run as a tile, with the meeting view's `pin`, `hide`, `mute`, `align`,
 * `ids` (a changed order) and `t` beside it. A pin always means the spotlight.
 */
export interface SuiteView {
  layout: MeetingLayout;
  meeting: MeetingSearch;
}

const OWN = new Set(['layout', 'ids', 'suite', 'pin', 'align', 'hide', 'mute', 't']);

export function parseSuiteView(search: string): SuiteView {
  const params = new URLSearchParams(search);
  const layout = params.get('layout');
  if (layout !== 'grid' && layout !== 'spotlight') return { layout: 'single', meeting: {} };
  const { suite: _suite, ...meeting } = parseMeetingSearch(Object.fromEntries(params));
  return { layout: meeting.pin ? 'spotlight' : layout, meeting };
}

/**
 * What the suite shows for its playable runs `runIds`: single below two runs; a listed order only of its own runs;
 * `layout=spotlight` without a pin pins the `selected` run.
 */
export function settleSuiteView(view: SuiteView, runIds: readonly string[], selected?: string): SuiteView {
  if (view.layout === 'single' || runIds.length < 2) return { layout: 'single', meeting: view.meeting };
  const { ids: listed, ...rest } = view.meeting;
  const own = listed?.filter((id) => runIds.includes(id)) ?? [];
  const ids = own.length >= 2 ? own : undefined;
  const meeting: MeetingSearch = ids ? { ...rest, ids } : rest;
  const placed = view.layout === 'spotlight' ? withLayout(meeting, 'spotlight', ids ?? runIds, selected) : meeting;
  return { layout: layoutOf(placed), meeting: placed };
}

/** Pins a run to the large view, showing it if it was hidden. */
export function pinRun(meeting: MeetingSearch, id: string): MeetingSearch {
  const hide = meeting.hide?.filter((item) => item !== id);
  return { ...meeting, pin: id, ...(hide ? { hide } : {}) };
}

/**
 * `path` with `view` as its query. Query values the suite does not own (such as `original`) stay; `singleTime`
 * becomes the single viewer's `?t=` so it opens where the tiles were.
 */
export function suiteViewHref(path: string, view: SuiteView, current = '', singleTime?: number) {
  const params = new URLSearchParams(current);
  for (const key of OWN) params.delete(key);
  if (view.layout !== 'single') {
    params.set('layout', view.meeting.pin ? 'spotlight' : view.layout);
    for (const [key, value] of meetingSearchParams(view.meeting)) if (key !== 'suite') params.set(key, value);
  } else if (singleTime !== undefined) params.set('t', formatSeconds(singleTime));
  const query = params.toString().replaceAll('%2C', ',').replaceAll('%3A', ':');
  return `${path}${query ? `?${query}` : ''}`;
}

/** A suite's runs side by side: its workspace in the grid layout. */
export function suiteGridHref(id: string) {
  return `${suiteHref(id)}?layout=grid`;
}
