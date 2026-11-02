import { fetchPage } from '../sign-in.tsx';

/*
 * The one way the client reaches its API: paths are relative to the app's base (`apiUrl('replays')` is
 * `/replays/api/replays` under `/replays`). A server render swaps this module's implementation for an in-process
 * call with the request's cookies, so every caller stays the same.
 */

/**
 * Where the app lives: `''` at the root of its domain, else a path prefix such as `/replays`. The server says so in
 * `<meta name="app-base">` (src/server/base-path.ts); without it (unit tests) the app is at the root.
 */
export function appBase() {
  const meta = typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="app-base"]');
  if (!meta?.content || meta.content === '/') return '';
  return meta.content.replace(/\/+$/, '');
}

export function apiUrl(path: string) {
  return `${appBase()}/api/${path}`;
}

/** `fetch` for an API path, with the app's sign-in handling (a 401 becomes a SignInError). */
export function apiFetch(path: string, init?: RequestInit) {
  return fetchPage(apiUrl(path), init);
}
