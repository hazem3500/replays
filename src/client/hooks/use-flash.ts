import { useEffect, useState } from 'react';

/** A confirmation that shows for `ms` after `flash()` (a "Copied" check), then clears itself. */
export function useFlash(ms: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(timer);
  }, [on, ms]);
  return [on, () => setOn(true)] as const;
}
