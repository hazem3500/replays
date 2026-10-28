import { assertReplayId } from '../../shared/replay.ts';
import { formatSeconds, parsePermalink } from '../permalink.ts';

export type CompareLayout = 'single' | 'grid' | 'spotlight';

/** Recordings on one stage; more would be thumbnails too small to read. */
export const MAX_RECORDINGS = 9;

export interface CompareSearch {
  /** Recordings beside the page's own, in tile order (B, C, …); empty: the plain viewer. */
  with: string[];
  layout: CompareLayout;
  /** The recording the inspector, steps and transport markers describe; absent: the page's own. */
  focus?: string;
  /** The shared playhead in ms (`?t=` in seconds, as every permalink); on a write, absent keeps the URL's own. */
  t?: number;
}

const isLayout = (value: string): value is CompareLayout => value === 'single' || value === 'grid' || value === 'spotlight';

function validId(value: string) {
  try {
    return assertReplayId(value);
  } catch {
    return;
  }
}

/**
 * Compare state on a viewer URL: `?with=<id>,<id>&layout=grid|spotlight&focus=<id>&t=<seconds>`. One parse and
 * write pair with no routing imports, so a router can adopt it as its search schema. Without `layout` the page
 * shows one recording at a time (`fallback`, Single on `/r/<id>`; a suite passes Grid). Invalid, repeated and
 * surplus ids are dropped, so a hand-edited link still opens.
 */
export function parseCompareSearch(search: string, own: string, fallback: CompareLayout = 'single'): CompareSearch {
  const params = new URLSearchParams(search);
  const ids: string[] = [];
  for (const raw of (params.get('with') ?? '').split(',')) {
    const id = validId(raw.trim());
    if (id && id !== own && !ids.includes(id) && ids.length < MAX_RECORDINGS - 1) ids.push(id);
  }
  const layout = params.get('layout') ?? '';
  const focus = params.get('focus') ?? '';
  const { time } = parsePermalink(search, '', 0);
  return {
    with: ids,
    layout: isLayout(layout) ? layout : fallback,
    ...(focus && (focus === own || ids.includes(focus)) ? { focus } : {}),
    ...(time === undefined ? {} : { t: time }),
  };
}

/** `search` with the compare keys rewritten (other keys kept); a value equal to its default is left out. */
export function writeCompareSearch(search: string, next: CompareSearch, fallback: CompareLayout = 'single') {
  const params = new URLSearchParams(search);
  for (const key of ['with', 'layout', 'focus']) params.delete(key);
  if (next.with.length) params.set('with', next.with.join(','));
  if (next.layout !== fallback) params.set('layout', next.layout);
  if (next.focus) params.set('focus', next.focus);
  if (next.t !== undefined) params.set('t', formatSeconds(next.t));
  const text = params.toString().replaceAll('%2C', ',');
  return text ? `?${text}` : '';
}
