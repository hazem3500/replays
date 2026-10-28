import { useEffect, useState } from 'react';

import { useLatest } from './use-latest.ts';

/** Waits between automatic attempts; the last one repeats (2 s, 5 s, 10 s, then every 30 s). */
export const RETRY_BACKOFF_MS: readonly number[] = [2_000, 5_000, 10_000, 30_000];

export interface AutoRetry {
  /** Whole seconds until the next attempt; undefined while not failing or while an attempt is in flight. */
  secondsLeft: number | undefined;
  /** Attempts made since the failure started (automatic and manual). */
  attempt: number;
  /** Try now; the backoff continues from the next step. */
  retryNow: () => void;
}

/**
 * Retries a failed load on a backoff while `failing`, and at once when the browser comes back online or the tab is
 * shown again. `pending` (a request in flight) pauses the countdown. Recovering resets the backoff.
 */
export function useAutoRetry({
  failing,
  pending = false,
  retry,
  schedule = RETRY_BACKOFF_MS,
}: {
  failing: boolean;
  pending?: boolean;
  retry: () => void;
  schedule?: readonly number[];
}): AutoRetry {
  const [attempt, setAttempt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number>();
  // why: adjusted during render, not in an effect, so the next failure starts from the first step without a stale frame.
  if (!failing && (attempt !== 0 || secondsLeft !== undefined)) {
    setAttempt(0);
    setSecondsLeft(undefined);
  }
  const retryNow = () => {
    setAttempt((count) => count + 1);
    setSecondsLeft(undefined);
    retry();
  };
  // why: the timers below outlive renders; they call the latest retry without restarting the countdown.
  const latestRetry = useLatest(retryNow);

  const waiting = failing && !pending;
  const steps = useLatest(schedule);
  useEffect(() => {
    const delay = steps.current[Math.min(attempt, steps.current.length - 1)] ?? 0;
    if (!waiting || delay <= 0) return;
    const end = Date.now() + delay;
    const tick = () => setSecondsLeft(Math.max(1, Math.ceil((end - Date.now()) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1000);
    // why: a hidden tab waits for `visibilitychange` instead of polling a server nobody is looking at.
    const timer = window.setTimeout(() => document.visibilityState !== 'hidden' && latestRetry.current(), delay);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
    };
  }, [waiting, attempt, steps, latestRetry]);

  // why: coming back online or to the tab is the best moment to try; no reason to sit out the rest of a 30 s wait.
  useEffect(() => {
    if (!waiting) return;
    const wake = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) latestRetry.current();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [waiting, latestRetry]);

  return { secondsLeft: waiting ? secondsLeft : undefined, attempt, retryNow };
}
