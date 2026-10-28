import { PRODUCT_SLUG } from '../../shared/brand.ts';
import { appBase } from '../api/fetch.ts';
import { readSessionStorage, writeSessionStorage } from '../storage.ts';

/*
 * why: the app's public addresses, base included (`/replays/r/<id>` under `/replays`): plain hrefs for links, copy-link
 * menus and the CLI's output. In-app clicks on them go through the router (routing/navigate.ts).
 */

export function indexHref() {
  return `${appBase()}/`;
}

export function replayHref(id: string) {
  return `${appBase()}/r/${encodeURIComponent(id)}`;
}

/** Edit mode for a replay. */
export function editHref(id: string) {
  return `${replayHref(id)}/edit`;
}

export function suiteHref(id: string) {
  return `${appBase()}/s/${encodeURIComponent(id)}`;
}

/** A recording inside its suite workspace. */
export function replayInSuiteHref(id: string, suiteId: string) {
  return `${suiteHref(suiteId)}/r/${encodeURIComponent(id)}`;
}

function under(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True for a page of this app (not its API, assets or anything else on the host). */
export function isAppPage(pathname: string, base = appBase()) {
  if (base && !under(pathname, base)) return false;
  const rest = pathname.slice(base.length) || '/';
  return !/^\/(api|assets|internal|_plugins)(\/|$)/.test(rest) && rest !== '/healthz' && !rest.endsWith('.html');
}

/** A path segment decoded, or undefined when it is missing or malformed. */
export function decodeSegment(value: string | undefined) {
  if (value === undefined) return;
  try {
    return decodeURIComponent(value);
  } catch {
    return;
  }
}

/** The suite and run a public pathname shows (`<base>/s/<suite>/r/<id>`), for code that reads a popped address. */
export function suiteRunOf(pathname: string, base = appBase()) {
  const rest = base && under(pathname, base) ? pathname.slice(base.length) : pathname;
  const [, suite, run] = /^\/s\/([^/]+)(?:\/r\/([^/]+))?\/?$/.exec(rest) ?? [];
  const suiteId = decodeSegment(suite);
  if (!suiteId) return;
  const replayId = decodeSegment(run);
  return { suiteId, ...(replayId ? { replayId } : {}) };
}

const INDEX_SEARCH_KEY = `${PRODUCT_SLUG}-index-search`;

/** The index stores its current filters and sort so "back to Replays" links return to the same list. */
export function rememberIndexSearch(search: string) {
  writeSessionStorage(INDEX_SEARCH_KEY, search);
}

/** The index with the filters and sort it last showed in this tab. */
export function indexReturnHref() {
  const search = readSessionStorage(INDEX_SEARCH_KEY) ?? '';
  return `${indexHref()}${search.startsWith('?') ? search : ''}`;
}
