import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a note stays. */
const NOTE_MS = 3200;

/**
 * A passing note for an action that did nothing ("Nothing to cut here"), shown where the eyes already are instead of
 * a toast. A newer note replaces the last.
 */
export function useNote(duration = NOTE_MS) {
  const [note, setNote] = useState<string>();
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const say = useCallback(
    (message: string) => {
      window.clearTimeout(timer.current);
      setNote(message);
      timer.current = window.setTimeout(() => setNote(undefined), duration);
    },
    [duration],
  );
  return [note, say] as const;
}
