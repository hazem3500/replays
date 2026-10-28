import type { CardMatch } from './shared-elements.ts';

/* why: where the keyboard goes once a page change has landed: back on the index, the card you came from; else the player. */

const PLAYER_SELECTOR = '.app-shell:not(.skeleton-shell) #replay-player';
/** How long a page may stay on its skeleton and still hand the keyboard to the player when it arrives. */
const PLAYER_WAIT_MS = 15_000;
let stopWaitingForPlayer: (() => void) | undefined;

export const stopFocusHandOff = () => stopWaitingForPlayer?.();

function handToPlayerWhenReady() {
  stopWaitingForPlayer?.();
  const startedOn = document.activeElement;
  const untouched = () => {
    const current = document.activeElement;
    return !current || current === document.body || current === startedOn || Boolean(current.closest('.skeleton-shell, .skeleton-overlay'));
  };
  const check = () => {
    const player = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
    if (!player) return false;
    stop();
    if (untouched()) player.focus({ preventScroll: true });
    return true;
  };
  const observer = new MutationObserver(() => void check());
  const timer = window.setTimeout(() => stop(), PLAYER_WAIT_MS);
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    stopWaitingForPlayer = undefined;
  };
  stopWaitingForPlayer = stop;
  if (check()) return;
  observer.observe(document.body, { childList: true, subtree: true });
}

export function settleFocus(toIndex: boolean, match: CardMatch | undefined) {
  if (toIndex) {
    if (match) {
      match.link.focus({ preventScroll: true });
      match.card.setAttribute('data-returned', '');
      window.setTimeout(() => match.card.removeAttribute('data-returned'), 1600);
    }
    return;
  }
  const player = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
  const heading = document.querySelector<HTMLElement>('.app-shell:not(.skeleton-shell) .app-topbar h1');
  const target = player ?? heading;
  if (!target) {
    /* why: still on the skeleton (a slow load, a skipped or slow transition): hand the keyboard to the player as soon as
       the viewer replaces it, unless the person has moved it somewhere themselves meanwhile. */
    handToPlayerWhenReady();
    return;
  }
  if (target === heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}
