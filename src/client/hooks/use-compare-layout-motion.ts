import { useLayoutEffect, useState } from 'react';

import { afterPageTransition } from '../transitions/state.ts';

/** Initial measurement and the route morph settle before local tile projection takes over. */
export function useCompareLayoutMotion(measured: boolean) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (!measured) return;
    let live = true;
    void afterPageTransition().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [measured]);
  return measured && ready;
}
