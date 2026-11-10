import type { ReplayInteraction, ReplayPerformanceTrack } from './replay.ts';

export const MAX_LONG_FRAMES = 300;
export const MAX_INTERACTIONS = 200;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * INP-style phases of one Event Timing entry. invariant: the three parts add up to `duration`; a browser that rounds
 * `processingEnd` past the end of the frame leaves presentation at 0 rather than negative.
 */
export function interactionBreakdown(entry: { startTime: number; duration: number; processingStart: number; processingEnd: number }) {
  const inputDelay = Math.max(0, entry.processingStart - entry.startTime);
  const processing = Math.max(0, entry.processingEnd - entry.processingStart);
  const presentation = Math.max(0, entry.startTime + entry.duration - entry.processingEnd);
  return { inputDelay, processing, presentation };
}

function validScripts(scripts: unknown): boolean {
  return (
    Array.isArray(scripts) &&
    scripts.length <= 3 &&
    scripts.every(
      (script) =>
        script &&
        typeof script.sourceURL === 'string' &&
        typeof script.sourceFunctionName === 'string' &&
        typeof script.invoker === 'string' &&
        typeof script.invokerType === 'string' &&
        finite(script.duration) &&
        finite(script.forcedStyleAndLayoutDuration),
    )
  );
}

const validTarget = (target: ReplayInteraction['target']) =>
  target === undefined ||
  (typeof target.tag === 'string' &&
    (target.role === undefined || typeof target.role === 'string') &&
    (target.name === undefined || typeof target.name === 'string'));

/** Throws when the optional long-frame and interaction tracks are malformed or past their caps. */
export function assertWhyTracks(track: Pick<ReplayPerformanceTrack, 'longFrames' | 'interactions'>): void {
  const { longFrames, interactions } = track;
  if (
    longFrames !== undefined &&
    (!Array.isArray(longFrames) ||
      longFrames.length > MAX_LONG_FRAMES ||
      longFrames.some(
        (frame) =>
          !frame ||
          !finite(frame.at) ||
          !finite(frame.duration) ||
          !finite(frame.blockingDuration) ||
          !finite(frame.renderStart) ||
          !finite(frame.styleAndLayoutStart) ||
          !validScripts(frame.scripts),
      ))
  )
    throw new Error('Invalid long animation frame track');
  if (
    interactions !== undefined &&
    (!Array.isArray(interactions) ||
      interactions.length > MAX_INTERACTIONS ||
      interactions.some(
        (item) =>
          !item ||
          !finite(item.at) ||
          !Number.isInteger(item.interactionId) ||
          typeof item.eventType !== 'string' ||
          !finite(item.duration) ||
          !finite(item.inputDelay) ||
          !finite(item.processing) ||
          !finite(item.presentation) ||
          !validTarget(item.target) ||
          (item.step !== undefined && !Number.isInteger(item.step)) ||
          (item.frame !== undefined && (!Number.isInteger(item.frame) || item.frame >= (longFrames?.length ?? 0))),
      ))
  )
    throw new Error('Invalid interaction track');
}
