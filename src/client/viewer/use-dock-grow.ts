import { type RefObject, useEffect, useRef } from 'react';

import { growTarget, useDockNeeds } from './dock-grow.ts';

/** The player keeps at least this share of the viewer when the dock grows. */
const MIN_PLAYER_SHARE = 0.4;

/**
 * Grows the dock to what the open tab declared it needs (`useMinContentHeight`), animated by `grow`. Stops for good once the
 * person has sized the panel (`markSized`), and starts that way when a height was saved.
 */
export function useDockGrow({
  shell,
  height,
  active,
  tab,
  savedHeight,
  grow,
}: {
  shell: RefObject<HTMLElement | null>;
  height: number;
  /** The dock is open on a desktop layout. */
  active: boolean;
  tab: string;
  savedHeight: boolean;
  grow: (to: number) => void;
}) {
  const content = useDockNeeds();
  const sized = useRef(savedHeight);
  const latest = useRef(height);
  useEffect(() => {
    latest.current = height;
  }, [height]);
  useEffect(() => {
    const element = shell.current;
    if (!element || !active) return;
    const panel = element.querySelector<HTMLElement>('.inspector-panel:not([hidden]):not([data-ending-style])');
    const dock = element.querySelector<HTMLElement>('.inspector');
    if (!panel || !dock) return;
    const chrome = Math.max(0, dock.offsetHeight - panel.clientHeight);
    const topbar = element.querySelector<HTMLElement>('.app-topbar')?.offsetHeight ?? 0;
    const transport = element.querySelector<HTMLElement>('.transport')?.offsetHeight ?? 0;
    const room = Math.round(element.clientHeight - topbar - transport - element.clientHeight * MIN_PLAYER_SHARE);
    const to = growTarget({
      content,
      chrome,
      current: latest.current,
      room,
      viewport: window.innerHeight,
      userSized: sized.current,
    });
    if (to !== undefined) grow(to);
  }, [active, content, grow, shell, tab]);
  return () => {
    sized.current = true;
  };
}
