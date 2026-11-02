import { useEffect } from 'react';

import { preloadPanel } from '../viewer/inspector-panels.tsx';

/**
 * Starts loading the active inspector tab's code while the page around it is still loading (the bundle, the player),
 * so a lazily loaded panel (Issues, Network, Performance) is usually ready on its first frame.
 */
export function usePreloadPanel(panel: string) {
  useEffect(() => {
    preloadPanel(panel);
  }, [panel]);
}
