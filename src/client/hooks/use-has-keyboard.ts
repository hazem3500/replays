import { useSyncExternalStore } from 'react';

import { readSessionStorage, writeSessionStorage } from '../storage.ts';

/** A touch screen with nothing to hover: a phone or tablet that may have no keyboard at all. */
const TOUCH_ONLY = '(hover: none) and (pointer: coarse)';
const SEEN_KEY = 'replays-hardware-keyboard';

const listeners = new Set<() => void>();
let seen = false;

function onKeyDown(event: KeyboardEvent) {
  // why: soft keyboards send composition or "Unidentified" / "Process" keys; only a hardware key counts.
  if (event.isComposing || event.key === 'Unidentified' || event.key === 'Process') return;
  seen = true;
  writeSessionStorage(SEEN_KEY, '1');
  window.removeEventListener('keydown', onKeyDown, true);
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  const touch = matchMedia(TOUCH_ONLY);
  listeners.add(onChange);
  touch.addEventListener('change', onChange);
  if (!seen) window.addEventListener('keydown', onKeyDown, true);
  return () => {
    listeners.delete(onChange);
    touch.removeEventListener('change', onChange);
    if (listeners.size === 0) window.removeEventListener('keydown', onKeyDown, true);
  };
}

function snapshot() {
  return seen || !matchMedia(TOUCH_ONLY).matches || readSessionStorage(SEEN_KEY) === '1';
}

/**
 * Whether keyboard shortcuts are worth showing: true wherever there is a pointer to hover, and on touch-only devices
 * once a hardware keyboard has typed a key (remembered for the session). Shortcut menu items, key hints and keycaps
 * render only when it is true; the server render assumes a keyboard.
 */
export function useHasKeyboard() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
