import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Keeps the server title literal and starts character measurements after hydration. */
export function useTitleHydrated() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}

/** Seeds a remounted run from its previous title, then retargets directly to the latest title. */
export function useTitleMorph(text: string, from?: string) {
  const [displayed, setDisplayed] = useState(from ?? text);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setDisplayed(text));
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return displayed;
}
