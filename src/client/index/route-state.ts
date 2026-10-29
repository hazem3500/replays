import { PRODUCT_SLUG } from '../../shared/brand.ts';
import type { ReplayFilters } from '../../shared/replay.ts';
import { appBase } from '../api/fetch.ts';
import { pageCookie, writePageCookie } from '../page-meta.ts';
import { readStorage } from '../storage.ts';

type IndexView = 'list' | 'grid';

/** The index request preloaded by index.html. */
export const INDEX_SUITES_URL = 'suites?expand=runs&limit=100';

/** Plugin filter params (registerIndexFilter / api.indexFilter): the same rule as the server's. */
const PLUGIN_PARAM = /^x-[a-z0-9][a-z0-9-]{0,38}$/;

export function filtersFromSearch(search: string): ReplayFilters {
  const params = new URLSearchParams(search);
  const filters: ReplayFilters = {};
  const q = params.get('q');
  if (q) filters.q = q;
  const host = params.get('host');
  if (host) filters.host = host;
  if (params.get('errors') === '1') filters.errors = true;
  const source = params.get('source');
  if (source === 'agent' || source === 'human') filters.source = source;
  const tag = params.get('tag');
  if (tag) filters.tag = tag;
  // why: plugin filters survive before their browser entry loads; the server owns matching.
  const plugin: Record<string, string> = {};
  for (const [key, value] of params)
    if (PLUGIN_PARAM.test(key) && value.trim() && !(key in plugin)) plugin[key] = value.trim().slice(0, 200);
  if (Object.keys(plugin).length) filters.params = plugin;
  return filters;
}

export function searchFromFilters(filters: ReplayFilters) {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.host) params.set('host', filters.host);
  if (filters.errors) params.set('errors', '1');
  if (filters.source) params.set('source', filters.source);
  if (filters.tag) params.set('tag', filters.tag);
  for (const key of Object.keys(filters.params ?? {}).sort()) {
    const value = filters.params?.[key];
    if (value !== undefined) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const VIEW_KEY = `${PRODUCT_SLUG}-index-view`;

/** List or grid, remembered per browser; phones always get the list. */
export function storedView(): IndexView {
  return readStorage(VIEW_KEY) === 'grid' ? 'grid' : 'list';
}

/** The view a server render shows: the choice mirrored into a cookie (this browser's storage stays the source). */
export function renderedView(): IndexView {
  return pageCookie(VIEW_KEY) === 'grid' ? 'grid' : 'list';
}

/** Keeps the cookie a server render reads in step with the saved view (choices made before it existed included). */
export function syncViewCookie() {
  const view = storedView();
  if (renderedView() !== view) writePageCookie(VIEW_KEY, view, appBase());
}

