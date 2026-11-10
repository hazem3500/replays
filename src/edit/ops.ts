import {
  type BlurStyle,
  DEFAULT_ZOOM_SCALE,
  MAX_ZOOM_SCALE,
  MIN_ZOOM_SCALE,
  type ReplayBlur,
  type ReplayCaption,
  type ReplaySpeedRange,
  type ReplayZoomRegion,
} from '../shared/effects.ts';
import { proposeWaitCuts, type ReplayCut, type ReplayEdits, type ReplayHighlight, WAIT_PAD_MS, withStepName } from '../shared/edits.ts';
import type { ReplayStep } from '../shared/replay.ts';
import { EditError, must, usageError } from './errors.ts';

/** What an edit needs to know about the replay it applies to. */
export interface EditContext {
  /** The replay's span in ms (the player's, so `end` and the validator agree with the viewer). */
  duration: number;
  viewport: { width: number; height: number };
  steps: readonly ReplayStep[];
}

export type EditItem = ReplayCut | ReplaySpeedRange | ReplayZoomRegion | ReplayBlur | ReplayCaption | ReplayHighlight;
export type ListKey = 'cuts' | 'speeds' | 'zooms' | 'blurs' | 'captions' | 'highlights';
export const LIST_KEYS: readonly ListKey[] = ['cuts', 'speeds', 'zooms', 'blurs', 'captions', 'highlights'];

/** The word a list's items go by in messages. */
export const ITEM_NAME: Record<ListKey, string> = {
  cuts: 'cut',
  speeds: 'speed range',
  zooms: 'zoom',
  blurs: 'blur or remove region',
  captions: 'caption',
  highlights: 'highlight',
};

export const itemsOf = (edits: ReplayEdits, key: ListKey): readonly EditItem[] => edits[key] ?? [];

/** The edit list without empty optional lists (the stored form leaves them out). */
function tidy(edits: ReplayEdits): ReplayEdits {
  const { zooms, speeds, blurs, captions, highlights, ...rest } = edits;
  return {
    ...rest,
    ...(zooms?.length ? { zooms } : {}),
    ...(speeds?.length ? { speeds } : {}),
    ...(blurs?.length ? { blurs } : {}),
    ...(captions?.length ? { captions } : {}),
    ...(highlights?.length ? { highlights } : {}),
  };
}

function nextId(prefix: string, items: ReadonlyArray<{ id: string }> = []) {
  const used = new Set(items.map((item) => item.id));
  for (let n = items.length + 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

export function removeItem(edits: ReplayEdits, key: ListKey, id: string): ReplayEdits {
  const keep = (item: { id: string }) => item.id !== id;
  switch (key) {
    case 'cuts':
      return tidy({ ...edits, cuts: edits.cuts.filter(keep) });
    case 'speeds':
      return tidy({ ...edits, ...(edits.speeds ? { speeds: edits.speeds.filter(keep) } : {}) });
    case 'zooms':
      return tidy({ ...edits, ...(edits.zooms ? { zooms: edits.zooms.filter(keep) } : {}) });
    case 'blurs':
      return tidy({ ...edits, ...(edits.blurs ? { blurs: edits.blurs.filter(keep) } : {}) });
    case 'captions':
      return tidy({ ...edits, ...(edits.captions ? { captions: edits.captions.filter(keep) } : {}) });
    case 'highlights':
      return tidy({ ...edits, ...(edits.highlights ? { highlights: edits.highlights.filter(keep) } : {}) });
  }
}

export function updateCaption(edits: ReplayEdits, id: string, change: Partial<Pick<ReplayCaption, 'from' | 'to' | 'text'>>): ReplayEdits {
  return tidy({
    ...edits,
    ...(edits.captions ? { captions: edits.captions.map((caption) => (caption.id === id ? { ...caption, ...change } : caption)) } : {}),
  });
}

/**
 * Resolves "the Nth item" to an id on the first read and keeps to that id on a retry, so a numbered target cannot slide
 * onto another item when someone else's save lands between two attempts.
 */
export function pinnedTarget(key: ListKey, number: number) {
  let id: string | undefined;
  return (edits: ReplayEdits): string => {
    const items = itemsOf(edits, key);
    if (id === undefined) {
      const item = items[number - 1];
      if (!item)
        throw usageError(
          `there is no ${ITEM_NAME[key]} ${number}; the replay has ${items.length} (run \`replays edit <id> show\` for the numbers)`,
        );
      id = item.id;
    } else if (!items.some((item) => item.id === id)) {
      throw new EditError(`${ITEM_NAME[key]} ${number} was removed by someone else while you were editing; run show and try again`);
    }
    return id;
  };
}

export function parseNumber(text: string | undefined, what: string): number {
  if (text === undefined || !/^#?\d+$/.test(text.trim()))
    throw usageError(`${what} must be a number from the list (run \`replays edit <id> show\`), not "${String(text)}"`);
  return Number(text.replace('#', ''));
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function fractionOf(part: string, total: number, name: string): number {
  const match = /^(\d+(?:\.\d+)?)(%|px)?$/.exec(part.trim());
  if (!match) throw usageError(`${name} "${part}" is not a number; write 0.25, 25% or 320px`);
  const value = Number(match[1]);
  if (match[2] === '%') return round4(value / 100);
  if (match[2] === 'px') return round4(value / total);
  if (value > 1) throw usageError(`${name} ${part} is above 1; write a fraction (0.25), a percentage (25%) or pixels (320px)`);
  return round4(value);
}

type Viewport = { width: number; height: number };
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `x,y,w,h` as fractions of the recorded frame; each part is `0.25`, `25%` or `320px` (pixels of the recorded viewport). */
export function parseRect(text: string, viewport: Viewport): Rect {
  const parts = text.split(',');
  if (parts.length !== 4) throw usageError('--rect takes four values: x,y,w,h (for example 0.1,0.2,0.5,0.1 or 10%,20%,50%,10%)');
  const [x, y, width, height] = parts.map((part) => must(part));
  return {
    x: fractionOf(must(x), viewport.width, 'x'),
    y: fractionOf(must(y), viewport.height, 'y'),
    width: fractionOf(must(width), viewport.width, 'width'),
    height: fractionOf(must(height), viewport.height, 'height'),
  };
}

export function parsePoint(text: string, viewport: Viewport) {
  const parts = text.split(',');
  if (parts.length !== 2) throw usageError('--at takes two values: x,y (for example 0.5,0.4 or 50%,40%)');
  return { x: fractionOf(must(parts[0]), viewport.width, 'x'), y: fractionOf(must(parts[1]), viewport.height, 'y') };
}

export function addCut(edits: ReplayEdits, from: number, to: number, label?: string): ReplayEdits {
  return { ...edits, cuts: [...edits.cuts, { id: nextId('cut', edits.cuts), from, to, ...(label ? { label } : {}) }] };
}

export function addWaitCuts(edits: ReplayEdits, ctx: EditContext, minWait: number): ReplayEdits {
  const proposed = proposeWaitCuts(ctx.steps, ctx.duration, edits.cuts).filter((cut) => cut.to - cut.from + 2 * WAIT_PAD_MS >= minWait);
  if (proposed.length === 0) throw new EditError('no wait is long enough to cut (or every long wait is already cut)');
  const taken = new Set(edits.cuts.map((cut) => cut.id));
  const fresh = proposed.map((cut) => (taken.has(cut.id) ? { ...cut, id: nextId('cut', [...edits.cuts, ...proposed]) } : cut));
  return { ...edits, cuts: [...edits.cuts, ...fresh] };
}

export const addSpeed = (edits: ReplayEdits, range: { from: number; to: number }, rate: number): ReplayEdits =>
  tidy({ ...edits, speeds: [...(edits.speeds ?? []), { id: nextId('speed', edits.speeds), ...range, rate }] });

export function addZoom(
  edits: ReplayEdits,
  options: { from: number; to: number; rect?: Rect; scale?: number; at?: { x: number; y: number } },
) {
  const { rect } = options;
  const centre = rect ? { x: round4(rect.x + rect.width / 2), y: round4(rect.y + rect.height / 2) } : options.at;
  const fit = rect && rect.width > 0 && rect.height > 0 ? Math.round(Math.min(1 / rect.width, 1 / rect.height) * 100) / 100 : undefined;
  const scale = options.scale ?? (fit === undefined ? DEFAULT_ZOOM_SCALE : Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, fit)));
  const zoom = { id: nextId('zoom', edits.zooms), from: options.from, to: options.to, scale, ...centre };
  return tidy({ ...edits, zooms: [...(edits.zooms ?? []), zoom] });
}

export function addBlur(edits: ReplayEdits, region: { from: number; to: number; rect: Rect; style: BlurStyle }): ReplayEdits {
  const { from, to, rect, style } = region;
  const blur = { id: nextId('blur', edits.blurs), from, to, ...rect, ...(style === 'blur' ? {} : { style }) };
  return tidy({ ...edits, blurs: [...(edits.blurs ?? []), blur] });
}

export const addCaption = (edits: ReplayEdits, range: { from: number; to: number }, text: string): ReplayEdits =>
  tidy({ ...edits, captions: [...(edits.captions ?? []), { id: nextId('caption', edits.captions), ...range, text }] });

export function addHighlight(edits: ReplayEdits, when: { at: number } | { from: number; to: number }, label?: string): ReplayEdits {
  const note = label ? { label } : {};
  const id = nextId('highlight', edits.highlights);
  const highlight: ReplayHighlight = 'at' in when ? { id, kind: 'point', at: when.at, ...note } : { id, kind: 'period', ...when, ...note };
  return tidy({ ...edits, highlights: [...(edits.highlights ?? []), highlight] });
}

export function setStepName(edits: ReplayEdits, key: string, name: string): ReplayEdits {
  const { stepNames: _old, ...rest } = edits;
  const next = withStepName(edits.stepNames, key, name);
  return next ? { ...rest, stepNames: next } : rest;
}

export function setTrim(edits: ReplayEdits, trim: { start: number; end: number } | undefined): ReplayEdits {
  const { trim: _old, ...rest } = edits;
  return trim ? { ...rest, trim } : rest;
}

export function setCursor(edits: ReplayEdits, cursor: ReplayEdits['cursor']): ReplayEdits {
  const { cursor: _old, ...rest } = edits;
  return cursor && Object.keys(cursor).length ? { ...rest, cursor } : rest;
}
