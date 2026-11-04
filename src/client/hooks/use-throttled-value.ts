import { useEffect, useRef, useState } from 'react';

/**
 * `value`, changing at most once every `ms`: a change after a quiet spell lands at once, and while changes keep coming
 * the latest one lands when the wait ends. For live regions, so a scrub reads out where it settles instead of every
 * value it passes.
 */
export function useThrottledValue<T>(value: T, ms: number) {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        last.current = Date.now();
        setShown(value);
      },
      Math.max(0, last.current + ms - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return shown;
}
