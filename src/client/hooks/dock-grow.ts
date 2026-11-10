import { useEffect, useSyncExternalStore } from 'react';

import { maxInspectorHeight } from '../viewer/inspector-size.ts';

/** Below this window height the player needs all the room it has, so no panel grows on its own. */
export const SHORT_VIEWPORT = 640;

const claims = new Map<symbol, number>();
const listeners = new Set<() => void>();
let needed = 0;

function publish() {
  needed = Math.max(0, ...claims.values());
  for (const listener of listeners) listener();
}

/** A panel declares the content height it needs to be useful (headline, timeline, a few rows); the dock grows to fit it. */
export function useMinContentHeight(px: number | undefined) {
  useEffect(() => {
    if (px === undefined) return;
    const key = Symbol('min-content');
    claims.set(key, px);
    publish();
    return () => {
      claims.delete(key);
      publish();
    };
  }, [px]);
}

export function useDockNeeds() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => needed,
    () => 0,
  );
}

/**
 * The height to grow the dock to, or nothing. `content` is what the panel needs, `chrome` the dock's own tabs and padding,
 * `room` what the player can give up. Never shrinks; capped at the panel's maximum (60 % of the window); never on a short
 * window or when the person already sized it.
 */
export function growTarget({
  content,
  chrome,
  current,
  room,
  viewport,
  userSized,
}: {
  content: number;
  chrome: number;
  current: number;
  room: number;
  viewport: number;
  userSized: boolean;
}) {
  if (userSized || content <= 0 || viewport < SHORT_VIEWPORT) return;
  const target = Math.min(content + chrome, maxInspectorHeight(viewport), room);
  return target > current ? Math.round(target) : undefined;
}
