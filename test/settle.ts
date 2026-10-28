import { act } from 'react';

/** Runs `work` inside React's async act so effects and pending microtasks settle before the test continues. */
export function settle(work: () => void) {
  return act(() => Promise.resolve().then(work));
}
