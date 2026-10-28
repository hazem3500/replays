import { readDeployment } from '../deployment.ts';

/*
 * The one way the client names its API: paths are relative to the app's base (`apiUrl('replays')` is
 * `/replays/api/replays` under `/replays`). A server render can swap this module for one that reads the request's
 * deployment, so every caller stays the same.
 */

/** Where the app lives: `''` at the root of its domain, else a path prefix such as `/replays`. */
export function appBase() {
  return readDeployment().base;
}

export function apiUrl(path: string) {
  return `${appBase()}/api/${path}`;
}
