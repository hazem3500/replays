import type { AnyRouter } from '@tanstack/react-router';

import { decodeSegment } from './links.ts';

/*
 * why: which page an address shows. A change of page is what page motion animates and what an in-app link click routes;
 * a change within one page (filters, `?t=`, a suite's run) is not.
 */

export interface Page {
  kind: 'index' | 'replay' | 'edit' | 'suite' | 'plugin' | 'other';
  /** Equal for two addresses of the same page. */
  key: string;
  /** The recording the address opens on, when it names one (a replay, or a suite's run). */
  replayId?: string;
  suiteId?: string;
}

/** The page at a router pathname (the base already stripped: `/r/<id>`). */
export function pageOf(router: AnyRouter, pathname: string): Page {
  const [, params, found] = router.getMatchedRoutes(pathname);
  const id: unknown = found?.id;
  if (id === '/' || id === '/r/') return { kind: 'index', key: 'index' };
  const replayId = decodeSegment(params.id ?? params.replayId);
  const suiteId = decodeSegment(params.suiteId);
  if (suiteId) return { kind: 'suite', key: `suite:${suiteId}`, suiteId, ...(replayId ? { replayId } : {}) };
  if (id === '/r/$id/edit' && replayId) return { kind: 'edit', key: `edit:${replayId}`, replayId };
  if (id === '/r/$id/' && replayId) return { kind: 'replay', key: `replay:${replayId}`, replayId };
  if (id === '/p/$plugin/$') return { kind: 'plugin', key: `plugin:${params.plugin ?? ''}` };
  return { kind: 'other', key: `other:${pathname}` };
}

/** The page at a public pathname (`/replays/r/<id>` under `/replays`). */
export function pageOfPublicPath(router: AnyRouter, pathname: string, base: string) {
  const internal = base && (pathname === base || pathname.startsWith(`${base}/`)) ? pathname.slice(base.length) || '/' : pathname;
  return pageOf(router, internal);
}
