import { assertReplayId } from '../../../shared/replay.ts';

/**
 * The comparison's shareable state, as plain query text:
 * `/compare?ids=a,b,c&pin=b&align=a:1200,b:-500&hide=c&mute=a&t=12.5`. A suite compares its runs in its own workspace
 * (`/s/<id>?layout=grid`), so a lone `suite` here only redirects links there (meeting-href.ts).
 * Older `?before=<id>&after=<id>` links open as the first two tiles; alongside `ids` or `suite` they are ignored.
 */
export interface MeetingSearch {
  ids?: string[];
  suite?: string;
  pin?: string;
  align?: Record<string, number>;
  hide?: string[];
  mute?: string[];
  /** Shared playhead in seconds. */
  t?: number;
}

export const MAX_TILES = 16;

const validId = (value: string) => {
  try {
    return assertReplayId(value.trim());
  } catch {
    return undefined;
  }
};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const idList = (value: unknown) => [
  ...new Set(
    text(value)
      .split(',')
      .flatMap((part) => validId(part) ?? []),
  ),
];

export function parseMeetingSearch(raw: Record<string, unknown>): MeetingSearch {
  const suite = validId(text(raw.suite));
  const listed = idList(raw.ids);
  const legacy = listed.length || suite ? [] : [text(raw.before), text(raw.after)].flatMap((part) => validId(part) ?? []);
  const ids = [...new Set([...listed, ...legacy])].slice(0, MAX_TILES);
  const align: Record<string, number> = {};
  for (const pair of text(raw.align).split(',')) {
    const [id, ms] = pair.split(':');
    const key = validId(id ?? '');
    const value = Number(ms);
    if (key && ms?.trim() && Number.isFinite(value) && Math.abs(value) <= 86_400_000) align[key] = Math.round(value);
  }
  const pin = validId(text(raw.pin));
  const hide = idList(raw.hide);
  const mute = idList(raw.mute);
  const t = Number(text(raw.t).replace(/s$/, ''));
  return {
    ...(ids.length ? { ids } : {}),
    ...(suite ? { suite } : {}),
    ...(pin ? { pin } : {}),
    ...(Object.keys(align).length ? { align } : {}),
    ...(hide.length ? { hide } : {}),
    ...(mute.length ? { mute } : {}),
    ...(text(raw.t).trim() && Number.isFinite(t) && t >= 0 ? { t } : {}),
  };
}

/** Plain text values in a stable order; empty ones are left out. */
export function meetingSearchParams(search: MeetingSearch) {
  const params = new URLSearchParams();
  if (search.suite) params.set('suite', search.suite);
  if (search.ids?.length) params.set('ids', search.ids.join(','));
  if (search.pin) params.set('pin', search.pin);
  const align = Object.entries(search.align ?? {}).filter(([, value]) => value !== 0);
  if (align.length) params.set('align', align.map(([id, value]) => `${id}:${value}`).join(','));
  if (search.hide?.length) params.set('hide', search.hide.join(','));
  if (search.mute?.length) params.set('mute', search.mute.join(','));
  if (search.t !== undefined) params.set('t', String(Math.round(search.t * 10) / 10));
  return params;
}

export function meetingQuery(search: MeetingSearch) {
  const query = meetingSearchParams(search).toString().replaceAll('%2C', ',').replaceAll('%3A', ':');
  return query ? `?${query}` : '';
}

/** The search as plain text values, for a router that serialises its own query strings. */
export function meetingSearchRecord(search: MeetingSearch): Record<string, string> {
  return Object.fromEntries(meetingSearchParams(search));
}
