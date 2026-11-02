import { type RefObject, useLayoutEffect, useRef } from 'react';

import { queueReveal, staggerIn } from '../viewer/stagger.ts';

/** The rows of the inspector's panels that stagger in. */
const PANEL_ROWS = 'tbody > tr, .ctx-summary, .ctx-heading, .ctx-source, .ctx-row, .empty';

/**
 * The chosen panel's visible rows rise in (stagger.ts): on the page's reveal clock the first time the dock is
 * `ready` (rows fill after the page transition), alone on each later tab switch. `section` is the dock; nothing
 * moves while it is folded or for `skip` panels (lists that stagger themselves).
 */
export function usePanelReveal(
  section: RefObject<HTMLElement | null>,
  { ready, panel, skip }: { ready: boolean; panel: string; skip?: string },
) {
  const revealed = useRef(false);
  useLayoutEffect(() => {
    const dock = section.current;
    if (!ready || !dock) return;
    const first = !revealed.current;
    revealed.current = true;
    if (panel === skip || dock.hasAttribute('data-collapsed')) return;
    const shown = dock.querySelector<HTMLElement>('.inspector-panel:not([data-ending-style]):not([hidden])');
    if (!shown) return;
    if (first) queueReveal(shown, PANEL_ROWS);
    else staggerIn(shown, PANEL_ROWS);
  }, [section, ready, panel, skip]);
}
