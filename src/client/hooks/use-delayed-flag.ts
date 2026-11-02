import { useEffect, useState } from 'react';

/**
 * False until `ms` after mount, then true: a loading hint that only appears for waits long enough to need one.
 * State rather than a CSS delay, so it holds even where animations are disabled or cancelled.
 */
export function useDelayedFlag(ms: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setOn(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return on;
}
