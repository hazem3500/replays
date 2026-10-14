import { PRODUCT_SLUG } from '../shared/brand.ts';

export type Route =
  | { kind: 'index' }
  | { kind: 'replay'; id: string }
  /** The suite workspace; without `replayId` it picks the first failed run (else the first recording). */
  | { kind: 'suite'; id: string; replayId?: string };

function decode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * Where the app lives: `''` at the root of its domain, else a path prefix such as `/replays`. The server says so in
 * `<meta name="app-base">` (src/server/base-path.ts); without it (unit tests) the app is at the root.
 */
export function appBase() {
  const meta = typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="app-base"]');
  if (!meta?.content || meta.content === '/') return '';
  return meta.content.replace(/\/+$/, '');
}

function under(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True for a page of this app (not its API, assets or anything else on the host). */
export function isAppPage(pathname: string, base = appBase()) {
  if (base && !under(pathname, base)) return false;
  const rest = pathname.slice(base.length) || '/';
  return !/^\/(api|assets|internal)(\/|$)/.test(rest) && rest !== '/healthz' && !rest.endsWith('.html');
}

/**
 * `<base>/r/<id>` is a replay; `<base>/s/<suite>` and `<base>/s/<suite>/r/<id>` open the suite workspace, and so
 * do older `<base>/r/<id>?suite=<suite>` links. Anything else is the index.
 */
export function parseRoute(pathname: string, search = '', base = appBase()): Route {
  const rest = base && under(pathname, base) ? pathname.slice(base.length) : pathname;
  const suite = /^\/s\/([^/]+)(?:\/r\/([^/]+))?\/?$/.exec(rest);
  if (suite) {
    const id = decode(suite[1]!);
    const replayId = suite[2] ? decode(suite[2]) : undefined;
    if (!id || (suite[2] && !replayId)) return { kind: 'index' };
    return { kind: 'suite', id, ...(replayId ? { replayId } : {}) };
  }
  const match = /^\/r\/([^/]+)\/?$/.exec(rest);
  if (!match) return { kind: 'index' };
  const id = decode(match[1]!);
  if (!id) return { kind: 'index' };
  const suiteId = new URLSearchParams(search).get('suite');
  return suiteId ? { kind: 'suite', id: suiteId, replayId: id } : { kind: 'replay', id };
}

export function indexHref() {
  return `${appBase()}/`;
}

const INDEX_SEARCH_KEY = `${PRODUCT_SLUG}-index-search`;

/** The index stores its current filters and sort so "back to Replays" links return to the same list. */
export function rememberIndexSearch(search: string) {
  try {
    if (search) sessionStorage.setItem(INDEX_SEARCH_KEY, search);
    else sessionStorage.removeItem(INDEX_SEARCH_KEY);
  } catch {
    // Storage can be unavailable (privacy modes); the plain index link still works.
  }
}

/** The index with the filters and sort it last showed in this tab. */
export function indexReturnHref() {
  let search = '';
  try {
    search = sessionStorage.getItem(INDEX_SEARCH_KEY) ?? '';
  } catch {
    search = '';
  }
  return `${indexHref()}${search.startsWith('?') ? search : ''}`;
}

export function replayHref(id: string) {
  return `${appBase()}/r/${encodeURIComponent(id)}`;
}

export function suiteHref(id: string) {
  return `${appBase()}/s/${encodeURIComponent(id)}`;
}

/** A recording inside its suite workspace. */
export function replayInSuiteHref(id: string, suiteId: string) {
  return `${suiteHref(suiteId)}/r/${encodeURIComponent(id)}`;
}

export function apiUrl(path: string) {
  return `${appBase()}/api/${path}`;
}
