import { useSyncExternalStore } from 'react';

import { countAtOrBefore } from '../timeline.ts';

/**
 * The time under the pointer while the scrubber is hovered or dragged (null otherwise), so other views can
 * preview it (the step list highlights the step there). Writes are coalesced to one notification per
 * animation frame; keyboard use never sets it.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let current: number | null = null;
let pending: number | null = null;
let scheduled = 0;

const schedule =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16) as unknown as number;
const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id: number) => clearTimeout(id);

function flush() {
  scheduled = 0;
  if (pending === current) return;
  current = pending;
  for (const listener of listeners) listener();
}

/** Sets the preview time (ms) or clears it (null). Notifies at most once per frame, with the latest value. */
export function setPreviewTime(ms: number | null) {
  pending = ms === null || !Number.isFinite(ms) ? null : ms;
  if (!scheduled) scheduled = schedule(flush);
}

export function getPreviewTime() {
  return current;
}

export function subscribePreviewTime(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Flushes a pending write at once (tests, and teardown). */
export function flushPreviewTime() {
  if (scheduled) cancel(scheduled);
  flush();
}

/** The preview time, re-rendering on every (frame-coalesced) change. Prefer usePreviewStepIndex. */
export function usePreviewTime() {
  return useSyncExternalStore(subscribePreviewTime, getPreviewTime, getPreviewTime);
}

/**
 * Index of the step on screen at the preview time (the last step starting at or before it; the first step
 * before any has started, like activeStepIndex), or -1 when there is no preview or no steps.
 */
export function previewStepIndex(stepTimes: readonly number[], time: number | null) {
  if (time === null || stepTimes.length === 0) return -1;
  return Math.max(0, countAtOrBefore(stepTimes, time) - 1);
}

/**
 * The step under the scrubber pointer, or -1. Re-renders only when that index changes, not on every
 * pointer move. `stepTimes` must be ascending (ReplayStep order).
 */
export function usePreviewStepIndex(stepTimes: readonly number[]) {
  return useSyncExternalStore(
    subscribePreviewTime,
    () => previewStepIndex(stepTimes, current),
    () => -1,
  );
}
