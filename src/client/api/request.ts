import { fetchPage } from '../sign-in.tsx';
import { apiUrl } from './fetch.ts';

type ServerApi = (path: string, init?: RequestInit) => Promise<Response>;

let serverApi: ServerApi | undefined;

/**
 * On a Start server, API paths are answered in process with the page request's credentials (start/router.tsx sets it;
 * the call reads the request being rendered, so concurrent renders never share one).
 */
export function setServerApi(api: ServerApi) {
  serverApi = api;
}

/** `GET <base>/api/<path>` for page data: in process on a server render, `fetch` with sign-in handling in the browser. */
export function apiFetch(path: string, init?: RequestInit) {
  return serverApi ? serverApi(path, init) : fetchPage(apiUrl(path), init);
}
