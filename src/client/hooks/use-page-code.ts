import { useEffect, useState } from 'react';

/**
 * Whether a page's code chunk is in: at once when it already loaded, else once `load` settles. A page crossfade
 * never delays ready content or forces a loading placeholder to finish animating.
 */
export function usePageCode(loaded: () => boolean, load: () => Promise<unknown>) {
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void load()
      .catch(() => undefined)
      .then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready, load]);
  return ready;
}
