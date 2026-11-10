import type { ReplayInteraction, ReplayLongFrame, ReplayPerformanceTrack } from './replay.ts';

/* why: the recorder bundle may not import shared source, so these caps are mirrored in src/recorder/interaction-math.ts;
   a parity test keeps the two in step. */
export const MAX_LONG_FRAMES = 300;
export const MAX_INTERACTIONS = 200;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function validScript(script: unknown): boolean {
  if (!record(script)) return false;
  return (
    typeof script.sourceURL === 'string' &&
    typeof script.sourceFunctionName === 'string' &&
    typeof script.invoker === 'string' &&
    typeof script.invokerType === 'string' &&
    finite(script.duration) &&
    finite(script.forcedStyleAndLayoutDuration)
  );
}

const validScripts = (scripts: unknown) => Array.isArray(scripts) && scripts.length <= 3 && scripts.every(validScript);

const validTarget = (target: ReplayInteraction['target']) =>
  target === undefined ||
  (typeof target.tag === 'string' &&
    (target.role === undefined || typeof target.role === 'string') &&
    (target.name === undefined || typeof target.name === 'string'));

const validFrame = (frame: ReplayLongFrame) =>
  finite(frame.at) &&
  finite(frame.duration) &&
  finite(frame.blockingDuration) &&
  finite(frame.renderStart) &&
  finite(frame.styleAndLayoutStart) &&
  validScripts(frame.scripts);

const validLink = (item: ReplayInteraction, frames: number) =>
  (item.step === undefined || Number.isInteger(item.step)) &&
  (item.frame === undefined || (Number.isInteger(item.frame) && item.frame < frames));

const validInteraction = (item: ReplayInteraction, frames: number) =>
  finite(item.at) &&
  Number.isInteger(item.interactionId) &&
  typeof item.eventType === 'string' &&
  finite(item.duration) &&
  finite(item.inputDelay) &&
  finite(item.processing) &&
  finite(item.presentation) &&
  validTarget(item.target) &&
  validLink(item, frames);

/** Throws when the optional long-frame and interaction tracks are malformed or past their caps. */
export function assertWhyTracks(track: Pick<ReplayPerformanceTrack, 'longFrames' | 'interactions'>): void {
  const { longFrames, interactions } = track;
  if (
    longFrames !== undefined &&
    (!Array.isArray(longFrames) || longFrames.length > MAX_LONG_FRAMES || !longFrames.every((frame) => record(frame) && validFrame(frame)))
  )
    throw new Error('Invalid long animation frame track');
  const frames = longFrames?.length ?? 0;
  if (
    interactions !== undefined &&
    (!Array.isArray(interactions) ||
      interactions.length > MAX_INTERACTIONS ||
      !interactions.every((item) => record(item) && validInteraction(item, frames)))
  )
    throw new Error('Invalid interaction track');
}
