import { interactionBreakdown, MAX_INTERACTIONS } from './interaction-math.ts';
import type { ReplayInteraction, ReplayInteractionTarget, ReplayPerformanceTrack } from '../shared/replay.ts';
import { CONTROL, controlName } from './interaction-steps.ts';
import { observeType } from './observe.ts';
import type { RecorderPrivacy } from './recorder-privacy.ts';

const DURATION_THRESHOLD_MS = 16;
const NAME_MAX = 40;
const IMPLICIT_ROLES: Record<string, string> = { button: 'button', a: 'link', select: 'combobox', textarea: 'textbox', input: 'textbox' };

interface EventEntry extends PerformanceEntry {
  interactionId?: number;
  processingStart?: number;
  processingEnd?: number;
  target?: Node | null;
}

/**
 * invariant: tag and role come from markup alone. The name goes through the same policy as step labels, so a masked or
 * blocked control, and every field value, contributes nothing.
 */
export function describeTarget(node: Node | null | undefined, privacy: RecorderPrivacy): ReplayInteractionTarget | undefined {
  if (!(node instanceof Element)) return;
  const blocked = String(privacy.rrwebOptions().blockSelector);
  const control = node.closest(CONTROL) ?? node;
  const tag = control.tagName.toLowerCase();
  const explicit = control.getAttribute('role')?.split(/\s+/).find(Boolean);
  const role = explicit ?? IMPLICIT_ROLES[tag];
  const target: ReplayInteractionTarget = { tag, ...(role ? { role: role.slice(0, 30) } : {}) };
  if (control.closest(blocked) || privacy.textMasked(control)) return target;
  const name = controlName(control, privacy, blocked);
  if (name) target.name = name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
  return target;
}

/** Index of the long frame that overlaps the interaction the most, if any. */
export function overlappingFrame(
  interaction: Pick<ReplayInteraction, 'at' | 'duration'>,
  frames: NonNullable<ReplayPerformanceTrack['longFrames']>,
): number | undefined {
  let best: number | undefined;
  let bestOverlap = 0;
  for (const [index, frame] of frames.entries()) {
    const overlap = Math.min(interaction.at + interaction.duration, frame.at + frame.duration) - Math.max(interaction.at, frame.at);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = index;
    }
  }
  return best;
}

/** Links each interaction to the long frame it overlaps; run whenever either list grows, since their entries arrive apart. */
export function linkInteractions(track: ReplayPerformanceTrack): void {
  for (const item of track.interactions ?? []) {
    const frame = item.frame === undefined && track.longFrames ? overlappingFrame(item, track.longFrames) : undefined;
    if (frame !== undefined) item.frame = frame;
  }
}

/**
 * Groups Event Timing entries by interactionId into `track.interactions`, keeping the slowest event of each group
 * (pointerdown, pointerup and click of one tap share an id). Returns the stop function.
 */
export function captureInteractions(
  track: ReplayPerformanceTrack,
  grow: (bytes: number) => void,
  privacy: RecorderPrivacy,
  stepAt: (wallTime: number) => number | undefined,
  fromLoad = false,
): () => void {
  const byId = new Map<number, ReplayInteraction>();
  let active = true;
  const retain = (entry: EventEntry) => {
    const id = entry.interactionId;
    if (!id || entry.duration < DURATION_THRESHOLD_MS) return;
    const known = byId.get(id);
    if (known && known.duration >= entry.duration) return;
    if (!known && byId.size >= MAX_INTERACTIONS) return;
    const at = performance.timeOrigin + entry.startTime;
    const target = describeTarget(entry.target, privacy);
    const processingStart = entry.processingStart ?? entry.startTime;
    const step = stepAt(performance.timeOrigin + processingStart);
    const item: ReplayInteraction = {
      at,
      interactionId: id,
      eventType: entry.name,
      duration: entry.duration,
      ...interactionBreakdown({
        startTime: entry.startTime,
        duration: entry.duration,
        processingStart,
        processingEnd: entry.processingEnd ?? processingStart,
      }),
      ...(target ? { target } : {}),
      ...(step === undefined ? {} : { step }),
    };
    const list = track.interactions ?? [];
    if (!track.interactions) Object.assign(track, { interactions: list });
    if (known) {
      grow(JSON.stringify(item).length - JSON.stringify(known).length);
      list[list.indexOf(known)] = item;
    } else {
      grow(JSON.stringify(item).length);
      list.push(item);
    }
    byId.set(id, item);
  };
  const observer = observeType(
    'event',
    (entries) => {
      if (!active) return;
      for (const entry of entries) retain(entry);
      linkInteractions(track);
    },
    fromLoad,
    { durationThreshold: DURATION_THRESHOLD_MS },
  );
  if (!observer) return () => {};
  return () => {
    active = false;
    for (const entry of observer.takeRecords()) retain(entry);
    linkInteractions(track);
    observer.disconnect();
  };
}
