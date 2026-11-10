import {
  CURSOR_APPEARANCES,
  CURSOR_CLICK_EFFECTS,
  CURSOR_COLORS,
  CURSOR_MOTION_STYLES,
  isCursorAppearance,
  isCursorClickEffect,
  isCursorColor,
  isCursorMotionStyle,
} from './cursor.ts';
import { EDITS_VERSION, MAX_CUTS, MAX_HIGHLIGHTS, MAX_LABEL, MIN_EDIT_MS, type ReplayEdits, type StoredReplayEdits } from './edit-list.ts';
import { MAX_STEP_NAMES } from './step-rename-names.ts';
import { editTimeline } from './edit-timeline.ts';
import {
  BLUR_STYLES,
  MAX_CAPTION,
  MAX_EFFECTS,
  MAX_SPEED_RATE,
  MAX_ZOOM_SCALE,
  MIN_BLUR_SIZE,
  MIN_SPEED_RATE,
  MIN_ZOOM_SCALE,
} from './effects.ts';

type Fields = Record<string, unknown>;
type Range = { from: number; to: number };

const EDIT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const EDIT_FIELDS = ['version', 'trim', 'cuts', 'zooms', 'speeds', 'blurs', 'captions', 'highlights', 'cursor', 'stepNames'];
const STORED_FIELDS = [...EDIT_FIELDS, 'revision', 'updatedBy', 'updatedAt'];
/** The cursor's enumerated settings, in the order they are checked: the setting, its guard and its allowed values. */
const CURSOR_CHOICES = [
  ['motion', isCursorMotionStyle, CURSOR_MOTION_STYLES],
  ['appearance', isCursorAppearance, CURSOR_APPEARANCES],
  ['color', isCursorColor, Object.keys(CURSOR_COLORS)],
  ['clickEffect', isCursorClickEffect, CURSOR_CLICK_EFFECTS],
] as const;
const CURSOR_FIELDS = ['visible', 'size', 'hideWhenIdle', 'clickFeedback', 'motion', 'appearance', 'color', 'clickEffect'];

function object(value: unknown, name: string, allowed: readonly string[]): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const record: Fields = { ...value };
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${name}.${unknown} is not a supported field`);
  return record;
}

function list(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name} must be an array of at most ${max}`);
  return value;
}

function checkTime(value: unknown, name: string, duration: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a time in ms (0 or more)`);
  if (duration !== undefined && value > duration) throw new Error(`${name} is after the end of the replay`);
  return value;
}

function checkRange(item: Fields, field: string, duration: number | undefined): Range {
  const from = checkTime(item.from, `${field}.from`, duration);
  const to = checkTime(item.to, `${field}.to`, duration);
  if (to - from < MIN_EDIT_MS) throw new Error(`${field} must be at least ${MIN_EDIT_MS} ms long`);
  return { from, to };
}

/** invariant: ids are unique within one list, so undo, selection and links can name an item. */
function checkId(item: Fields, field: string, ids: Set<string>): void {
  if (typeof item.id !== 'string' || !EDIT_ID.test(item.id)) throw new Error(`${field}.id must be lowercase letters, digits and dashes`);
  if (ids.has(item.id)) throw new Error(`${field}.id is used twice`);
  ids.add(item.id);
}

function fraction(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${name} must be a fraction from 0 to 1`);
  return value;
}

function label(value: unknown, name: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length > MAX_LABEL) throw new Error(`${name} must be text of at most ${MAX_LABEL} characters`);
}

const kindOf = (raw: unknown): unknown => (typeof raw === 'object' && raw !== null && 'kind' in raw ? raw.kind : undefined);

/** Where a stretch list sits in the edit list and which fields its items carry besides `id`, `from` and `to`. */
interface StretchList {
  name: string;
  fields: readonly string[];
  duration: number | undefined;
}

/** A list of stretches, each checked by `check`; returns their validated ranges (none when the list is absent). */
function stretches(value: unknown, at: StretchList, check: (item: Fields, field: string) => void): Range[] {
  if (value === undefined) return [];
  const ids = new Set<string>();
  return list(value, at.name, MAX_EFFECTS).map((raw, index) => {
    const field = `${at.name}[${index}]`;
    const item = object(raw, field, ['id', 'from', 'to', ...at.fields]);
    checkId(item, field, ids);
    const range = checkRange(item, field, at.duration);
    check(item, field);
    return range;
  });
}

function checkZoom(item: Fields, field: string): void {
  const scale = item.scale;
  if (typeof scale !== 'number' || !(scale >= MIN_ZOOM_SCALE && scale <= MAX_ZOOM_SCALE))
    throw new Error(`${field}.scale must be from ${MIN_ZOOM_SCALE} to ${MAX_ZOOM_SCALE}`);
  if (item.x !== undefined) fraction(item.x, `${field}.x`);
  if (item.y !== undefined) fraction(item.y, `${field}.y`);
}

function checkBlur(item: Fields, field: string): void {
  const x = fraction(item.x, `${field}.x`);
  const y = fraction(item.y, `${field}.y`);
  const width = fraction(item.width, `${field}.width`);
  const height = fraction(item.height, `${field}.height`);
  if (item.style !== undefined && !BLUR_STYLES.some((style) => style === item.style))
    throw new Error(`${field}.style must be one of ${BLUR_STYLES.join(', ')}`);
  if (width < MIN_BLUR_SIZE || height < MIN_BLUR_SIZE) throw new Error(`${field} is too small`);
  if (x + width > 1.0001 || y + height > 1.0001) throw new Error(`${field} must stay inside the frame`);
}

/** The effect lists of an edit list (zoom, speed, blur, captions: src/shared/effects.ts); returns the speed-ups. */
function assertEffects(edits: Fields, name: string, duration: number | undefined): Array<Range & { rate: number }> {
  stretches(edits.zooms, { name: `${name}.zooms`, fields: ['scale', 'x', 'y'], duration }, checkZoom);
  const rates: number[] = [];
  const speeds = stretches(edits.speeds, { name: `${name}.speeds`, fields: ['rate'], duration }, (item, field) => {
    const rate = item.rate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < MIN_SPEED_RATE || rate > MAX_SPEED_RATE)
      throw new Error(`${field}.rate must be a number from ${MIN_SPEED_RATE} to ${MAX_SPEED_RATE}`);
    rates.push(rate);
  });
  const sorted = speeds.map((range, index) => ({ ...range, rate: rates[index] ?? 1 })).toSorted((a, b) => a.from - b.from);
  if (sorted.some((range, index) => index > 0 && range.from < (sorted[index - 1]?.to ?? 0)))
    throw new Error(`${name}.speeds must not overlap`);
  stretches(edits.blurs, { name: `${name}.blurs`, fields: ['x', 'y', 'width', 'height', 'style'], duration }, checkBlur);
  stretches(edits.captions, { name: `${name}.captions`, fields: ['text'], duration }, (item, field) => {
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_CAPTION)
      throw new Error(`${field}.text must be text of 1 to ${MAX_CAPTION} characters`);
  });
  return sorted;
}

function assertHighlights(value: unknown, duration: number | undefined, name: string): void {
  if (value === undefined) return;
  const ids = new Set<string>();
  for (const [index, raw] of list(value, name, MAX_HIGHLIGHTS).entries()) {
    const field = `${name}[${index}]`;
    const item = object(raw, field, kindOf(raw) === 'point' ? ['id', 'kind', 'at', 'label'] : ['id', 'kind', 'from', 'to', 'label']);
    checkId(item, field, ids);
    label(item.label, `${field}.label`);
    if (item.kind === 'point') checkTime(item.at, `${field}.at`, duration);
    else if (item.kind === 'period') checkRange(item, field, duration);
    else throw new Error(`${field}.kind must be point or period`);
  }
}

function assertTrim(value: unknown, name: string, duration: number | undefined): { start: number; end: number } | undefined {
  if (value === undefined) return;
  const trim = object(value, `${name}.trim`, ['start', 'end']);
  const start = checkTime(trim.start, `${name}.trim.start`, duration);
  const end = checkTime(trim.end, `${name}.trim.end`, duration);
  if (end - start < MIN_EDIT_MS) throw new Error(`${name}.trim must keep at least ${MIN_EDIT_MS} ms (start before end)`);
  return { start, end };
}

function assertCuts(value: unknown, name: string, duration: number | undefined): Range[] {
  const ids = new Set<string>();
  return list(value, `${name}.cuts`, MAX_CUTS).map((raw, index) => {
    const field = `${name}.cuts[${index}]`;
    const cut = object(raw, field, ['id', 'from', 'to', 'label']);
    checkId(cut, field, ids);
    const range = checkRange(cut, field, duration);
    label(cut.label, `${field}.label`);
    return range;
  });
}

function assertStepNames(value: unknown, name: string): void {
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const entries = Object.entries(value);
  if (entries.length > MAX_STEP_NAMES) throw new Error(`${name} must name at most ${MAX_STEP_NAMES} steps`);
  for (const [key, text] of entries) {
    if (!/^\d{1,12}(?:#\d{1,4})?$/.test(key)) throw new Error(`${name}.${key} is not a step key`);
    label(text, `${name}.${key}`);
    if (typeof text === 'string' && !text.trim()) throw new Error(`${name}.${key} must not be empty`);
  }
}

function assertCursor(value: unknown, name: string): void {
  if (value === undefined) return;
  const cursor = object(value, `${name}.cursor`, CURSOR_FIELDS);
  for (const key of ['visible', 'hideWhenIdle', 'clickFeedback']) {
    if (cursor[key] !== undefined && typeof cursor[key] !== 'boolean') throw new Error(`${name}.cursor.${key} must be a boolean`);
  }
  const size = cursor.size;
  if (size !== undefined && (typeof size !== 'number' || !Number.isFinite(size) || size < 0.5 || size > 2))
    throw new Error(`${name}.cursor.size must be from 0.5 to 2`);
  for (const [key, valid, choices] of CURSOR_CHOICES) {
    if (cursor[key] !== undefined && !valid(cursor[key])) throw new Error(`${name}.cursor.${key} must be one of ${choices.join(', ')}`);
  }
}

/**
 * Validates an edit list (the editor's PUT body). With `duration` (the replay's, ms) every time must fall inside the replay
 * and something must remain once trimmed and cut. Throws an Error naming the field, like the other validators in src/shared.
 */
export function assertReplayEdits(value: unknown, duration?: number, name = 'edits'): asserts value is ReplayEdits {
  const edits = object(value, name, EDIT_FIELDS);
  if (edits.version !== EDITS_VERSION) throw new Error(`${name}.version must be ${EDITS_VERSION}`);
  const trim = assertTrim(edits.trim, name, duration);
  const cuts = assertCuts(edits.cuts, name, duration);
  assertCursor(edits.cursor, name);
  const speeds = assertEffects(edits, name, duration);
  assertHighlights(edits.highlights, duration, `${name}.highlights`);
  assertStepNames(edits.stepNames, `${name}.stepNames`);
  if (duration !== undefined && editTimeline({ trim, cuts, speeds }, duration).duration < MIN_EDIT_MS) {
    throw new Error(`${name} remove the whole replay`);
  }
}

/** A stored sidecar: an edit list plus revision and authorship. */
export function assertStoredReplayEdits(value: unknown): asserts value is StoredReplayEdits {
  const stored = object(value, 'edits', STORED_FIELDS);
  const { revision, updatedBy, updatedAt, ...edits } = stored;
  assertReplayEdits(edits);
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('edits.revision is invalid');
  if (updatedBy !== undefined && (typeof updatedBy !== 'string' || updatedBy.length > 254)) throw new Error('edits.updatedBy is invalid');
  if (updatedAt !== undefined && (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))))
    throw new Error('edits.updatedAt is invalid');
}
