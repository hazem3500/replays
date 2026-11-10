import { type BlurStyle, DEFAULT_ZOOM_SCALE, MAX_ZOOM_SCALE, MIN_ZOOM_SCALE } from '../shared/effects.ts';
import type { ReplayBlur, ReplayCaption, ReplaySpeedRange, ReplayZoomRegion } from '../shared/effects.ts';
import { type ReplayCut, type ReplayEdits, type ReplayHighlight, proposeWaitCuts, withStepName } from '../shared/edits.ts';
import { WAIT_PAD_MS } from '../shared/edits.ts';
import type { ReplayStep } from '../shared/replay.ts';
import { EditError, must, usageError } from './errors.ts';

/** What an edit needs to know about the replay it applies to. */
export interface EditContext {
  /** The replay's span in ms (the player's, so `end` and the validator agree with the viewer). */
  duration: number;
  viewport: { width: number; height: number };
  steps: readonly ReplayStep[];
}

interface Lists {
  cuts: ReplayCut;
  speeds: ReplaySpeedRange;
  zooms: ReplayZoomRegion;
  blurs: ReplayBlur;
  captions: ReplayCaption;
  highlights: ReplayHighlight;
}
export type ListKey = keyof Lists;
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

export const itemsOf = <K extends ListKey>(edits: ReplayEdits, key: K): Lists[K][] => (edits[key] ?? []) as Lists[K][];

function withItems<K extends ListKey>(edits: ReplayEdits, key: K, items: Lists[K][]): ReplayEdits {
  const next: Record<string, unknown> = { ...edits };
  if (key === 'cuts' || items.length) next[key] = items;
  else delete next[key];
  // why: only the one list under `key` changed, so the object still has ReplayEdits' shape.
  return next as unknown as ReplayEdits;
}

function nextId(prefix: string, items: ReadonlyArray<{ id: string }>) {
  const used = new Set(items.map((item) => item.id));
  for (let n = items.length + 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

const ID_PREFIX: Record<ListKey, string> = {
  cuts: 'cut',
  speeds: 'speed',
  zooms: 'zoom',
  blurs: 'blur',
  captions: 'caption',
  highlights: 'highlight',
};

export function addItem<K extends ListKey>(edits: ReplayEdits, key: K, make: (id: string) => Lists[K]): ReplayEdits {
  const items = itemsOf(edits, key);
  return withItems(edits, key, [...items, make(nextId(ID_PREFIX[key], items))]);
}

export function removeItem(edits: ReplayEdits, key: ListKey, id: string): ReplayEdits {
  return withItems(
    edits,
    key,
    itemsOf(edits, key).filter((item) => item.id !== id),
  );
}

export function updateItem<K extends ListKey>(edits: ReplayEdits, key: K, id: string, change: (item: Lists[K]) => Lists[K]): ReplayEdits {
  return withItems(
    edits,
    key,
    itemsOf(edits, key).map((item) => (item.id === id ? change(item) : item)),
  );
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

/** `x,y,w,h` as fractions of the recorded frame; each part is `0.25`, `25%` or `320px` (pixels of the recorded viewport). */
export function parseRect(text: string, viewport: { width: number; height: number }) {
  const parts = text.split(',');
  if (parts.length !== 4) throw usageError('--rect takes four values: x,y,w,h (for example 0.1,0.2,0.5,0.1 or 10%,20%,50%,10%)');
  const [x, y, width, height] = parts as [string, string, string, string];
  return {
    x: fractionOf(x, viewport.width, 'x'),
    y: fractionOf(y, viewport.height, 'y'),
    width: fractionOf(width, viewport.width, 'width'),
    height: fractionOf(height, viewport.height, 'height'),
  };
}

export function parsePoint(text: string, viewport: { width: number; height: number }) {
  const parts = text.split(',');
  if (parts.length !== 2) throw usageError('--at takes two values: x,y (for example 0.5,0.4 or 50%,40%)');
  return { x: fractionOf(must(parts[0]), viewport.width, 'x'), y: fractionOf(must(parts[1]), viewport.height, 'y') };
}

export function addCut(edits: ReplayEdits, from: number, to: number, label?: string): ReplayEdits {
  return addItem(edits, 'cuts', (id) => ({ id, from, to, ...(label ? { label } : {}) }));
}

export function addWaitCuts(edits: ReplayEdits, ctx: EditContext, minWait: number): ReplayEdits {
  const proposed = proposeWaitCuts(ctx.steps, ctx.duration, edits.cuts).filter((cut) => cut.to - cut.from + 2 * WAIT_PAD_MS >= minWait);
  if (proposed.length === 0) throw new EditError('no wait is long enough to cut (or every long wait is already cut)');
  const taken = new Set(edits.cuts.map((cut) => cut.id));
  return proposed.reduce((next, cut) => addItem(next, 'cuts', (id) => ({ ...cut, id: taken.has(cut.id) ? id : cut.id })), edits);
}

export const addSpeed = (edits: ReplayEdits, from: number, to: number, rate: number) =>
  addItem(edits, 'speeds', (id) => ({ id, from, to, rate }));

export function addZoom(
  edits: ReplayEdits,
  options: { from: number; to: number; rect?: ReturnType<typeof parseRect>; scale?: number; at?: { x: number; y: number } },
) {
  const { rect } = options;
  const centre = rect ? { x: round4(rect.x + rect.width / 2), y: round4(rect.y + rect.height / 2) } : options.at;
  const fit = rect && rect.width > 0 && rect.height > 0 ? Math.round(Math.min(1 / rect.width, 1 / rect.height) * 100) / 100 : undefined;
  const scale = options.scale ?? (fit === undefined ? DEFAULT_ZOOM_SCALE : Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, fit)));
  return addItem(edits, 'zooms', (id) => ({ id, from: options.from, to: options.to, scale, ...centre }));
}

export function addBlur(edits: ReplayEdits, from: number, to: number, rect: ReturnType<typeof parseRect>, style: BlurStyle) {
  return addItem(edits, 'blurs', (id) => ({ id, from, to, ...rect, ...(style === 'blur' ? {} : { style }) }));
}

export const addCaption = (edits: ReplayEdits, from: number, to: number, text: string) =>
  addItem(edits, 'captions', (id) => ({ id, from, to, text }));

export function addHighlight(edits: ReplayEdits, when: { at: number } | { from: number; to: number }, label?: string): ReplayEdits {
  const note = label ? { label } : {};
  return addItem(edits, 'highlights', (id) =>
    'at' in when ? { id, kind: 'point', at: when.at, ...note } : { id, kind: 'period', from: when.from, to: when.to, ...note },
  );
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
