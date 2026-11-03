/**
 * Edit mode's state, pure and unit-tested (test/editor-state.test.ts): the edit list being worked on with
 * undo/redo, the selection, what was last saved, the operations the editor offers (trim, cut, remove waits)
 * and its keyboard map. Every time here is on the original replay's timeline (src/shared/edits.ts).
 */

import {
  EMPTY_EDITS,
  editTimeline,
  MIN_EDIT_MS,
  normalizeEdits,
  proposeWaitCuts,
  type ReplayCut,
  type ReplayEdits,
  sameEdits,
} from '../../shared/edits.ts';
import {
  DEFAULT_ZOOM_SCALE,
  type ReplayBlur,
  type ReplayCaption,
  type ReplaySpeedRange,
  type ReplayZoomRegion,
} from '../../shared/effects.ts';
import { placeSpan, retimeSpan } from '../../shared/effect-room.ts';
import type { ReplayStep } from '../../shared/replay.ts';
import { isTypingTarget, type KeyLike, type TargetLike } from '../shortcuts.ts';

export { addPeriodHighlight, addPointHighlight, moveHighlight, removeHighlight, updateHighlight } from './highlight-edits.ts';

/**
 * What is selected: the trim, a cut by id, or a range dragged out on the track (not an edit yet: C or S cuts it).
 */
export type Selection =
  | { kind: 'trim' }
  | { kind: 'cut'; id: string }
  | { kind: 'highlight'; id: string }
  | { kind: EffectKind; id: string }
  | { kind: 'range'; from: number; to: number }
  | undefined;

/** The effect lanes, each a list of regions in the edit list. */
export type EffectKind = 'zoom' | 'speed' | 'blur' | 'caption';
export const EFFECT_KINDS: readonly EffectKind[] = ['zoom', 'speed', 'blur', 'caption'];
const LISTS = { zoom: 'zooms', speed: 'speeds', blur: 'blurs', caption: 'captions' } as const;
export type EffectRegion = ReplayZoomRegion | ReplaySpeedRange | ReplayBlur | ReplayCaption;

export interface EditorState {
  present: ReplayEdits;
  past: ReplayEdits[];
  future: ReplayEdits[];
  /** The list as last loaded or saved: the editor is dirty while `present` differs. */
  saved: ReplayEdits;
  selection: Selection;
}

/** Undo steps kept. */
export const MAX_HISTORY = 100;

export type EditorAction =
  /** `merge`: replace the present without a new undo step (the moves of one drag after its first). */
  | { type: 'change'; edits: ReplayEdits; merge?: boolean; select?: Selection }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; selection: Selection }
  /** A save landed: `edits` is what is stored now. */
  | { type: 'saved'; edits: ReplayEdits }
  /** Replace everything (someone else's newer list): history starts over. */
  | { type: 'load'; edits: ReplayEdits };

/** Applies an edit; `merge` folds it into the last undo step (every value after the first of one slider drag). */
export type ChangeEdits = (edits: ReplayEdits, select?: Selection, merge?: boolean) => void;

export function initialEditorState(edits: ReplayEdits = EMPTY_EDITS): EditorState {
  const present = normalizeEdits(edits);
  return { present, past: [], future: [], saved: present, selection: undefined };
}

/** Keeps the selection only if what it names still exists. */
function validSelection(edits: ReplayEdits, selection: Selection): Selection {
  if (selection?.kind === 'trim') return edits.trim ? selection : undefined;
  if (selection?.kind === 'cut') return edits.cuts.some((cut) => cut.id === selection.id) ? selection : undefined;
  if (selection?.kind === 'highlight') return edits.highlights?.some((item) => item.id === selection.id) ? selection : undefined;
  if (selection && selection.kind !== 'range')
    return effectList(edits, selection.kind).some((item) => item.id === selection.id) ? selection : undefined;
  return selection;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'change': {
      const edits = normalizeEdits(action.edits);
      const selection = validSelection(edits, action.select ?? state.selection);
      if (sameEdits(edits, state.present)) return selection === state.selection ? state : { ...state, selection };
      if (action.merge) return { ...state, present: edits, selection };
      return { ...state, present: edits, past: [...state.past, state.present].slice(-MAX_HISTORY), future: [], selection };
    }
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        present: previous,
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future],
        selection: validSelection(previous, state.selection),
      };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        ...state,
        present: next,
        past: [...state.past, state.present],
        future: rest,
        selection: validSelection(next, state.selection),
      };
    }
    case 'select':
      return { ...state, selection: validSelection(state.present, action.selection) };
    case 'saved':
      return { ...state, saved: normalizeEdits(action.edits) };
    case 'load':
      return initialEditorState(action.edits);
  }
}

export const isDirty = (state: EditorState) => !sameEdits(state.present, state.saved);
export const canUndo = (state: EditorState) => state.past.length > 0;
export const canRedo = (state: EditorState) => state.future.length > 0;

/* ---------- Operations ---------- */

const clamp = (value: number, low: number, high: number) => Math.round(Math.min(high, Math.max(low, value)));

/** The trim as it applies: the stored one, or the whole replay. */
export function trimOf(edits: ReplayEdits, duration: number) {
  return edits.trim ?? { start: 0, end: duration };
}

/**
 * Sets one end of the trim (`edge`) to `time`, keeping at least MIN_EDIT_MS between the two. A trim back to the
 * whole replay is dropped (no trim).
 */
export function setTrimEdge(edits: ReplayEdits, edge: 'start' | 'end', time: number, duration: number): ReplayEdits {
  const trim = trimOf(edits, duration);
  const next =
    edge === 'start'
      ? { start: clamp(time, 0, trim.end - MIN_EDIT_MS), end: trim.end }
      : { start: trim.start, end: clamp(time, trim.start + MIN_EDIT_MS, duration) };
  const { trim: _old, ...rest } = edits;
  return next.start <= 0 && next.end >= duration ? rest : { ...rest, trim: next };
}

export function clearTrim(edits: ReplayEdits): ReplayEdits {
  const { trim: _old, ...rest } = edits;
  return rest;
}

/** A fresh id: `cut-<n>` for the first n not taken. */
export function nextCutId(edits: ReplayEdits, prefix = 'cut') {
  const taken = new Set(edits.cuts.map((cut) => cut.id));
  for (let index = 1; ; index++) if (!taken.has(`${prefix}-${index}`)) return `${prefix}-${index}`;
}

/** Default length of a cut added at the playhead. */
export const NEW_CUT_MS = 1000;

/**
 * A new cut at `time`: NEW_CUT_MS long (shorter near the end, moved back so it fits), inside the trim. Returns the
 * edits and the new cut's id, or undefined when there is no room.
 */
export function addCut(edits: ReplayEdits, time: number, duration: number): { edits: ReplayEdits; id: string } | undefined {
  const trim = trimOf(edits, duration);
  const length = Math.min(NEW_CUT_MS, trim.end - trim.start - MIN_EDIT_MS);
  if (length < MIN_EDIT_MS) return undefined;
  const from = clamp(time, trim.start, trim.end - length);
  const id = nextCutId(edits);
  return { edits: { ...edits, cuts: [...edits.cuts, { id, from, to: from + length }] }, id };
}

/**
 * A cut over [from, to) (a range dragged out on the track), kept inside the trim. Undefined when what is left of it
 * is shorter than MIN_EDIT_MS.
 */
export function cutRange(edits: ReplayEdits, from: number, to: number, duration: number): { edits: ReplayEdits; id: string } | undefined {
  const trim = trimOf(edits, duration);
  const start = clamp(Math.min(from, to), trim.start, trim.end);
  const end = clamp(Math.max(from, to), trim.start, trim.end);
  if (end - start < MIN_EDIT_MS) return undefined;
  const id = nextCutId(edits);
  return { edits: { ...edits, cuts: [...edits.cuts, { id, from: start, to: end }] }, id };
}

/** Moves one edge of a cut (or the whole cut, `edge: 'move'` by `time` as the new start), clamped to the replay. */
export function moveCut(edits: ReplayEdits, id: string, edge: 'from' | 'to' | 'move', time: number, duration: number): ReplayEdits {
  return {
    ...edits,
    cuts: edits.cuts.map((cut): ReplayCut => {
      if (cut.id !== id) return cut;
      if (edge === 'from') return { ...cut, from: clamp(time, 0, cut.to - MIN_EDIT_MS) };
      if (edge === 'to') return { ...cut, to: clamp(time, cut.from + MIN_EDIT_MS, duration) };
      const length = cut.to - cut.from;
      const from = clamp(time, 0, duration - length);
      return { ...cut, from, to: from + length };
    }),
  };
}

export function removeCut(edits: ReplayEdits, id: string): ReplayEdits {
  return { ...edits, cuts: edits.cuts.filter((cut) => cut.id !== id) };
}

export function setCutLabel(edits: ReplayEdits, id: string, label: string): ReplayEdits {
  const text = label.trim().slice(0, 120);
  return {
    ...edits,
    cuts: edits.cuts.map((cut) => {
      if (cut.id !== id) return cut;
      const { label: _old, ...rest } = cut;
      return text ? { ...rest, label: text } : rest;
    }),
  };
}

/* ---------- Effects (zoom, speed, blur, captions) ---------- */

/** One lane's regions. */
export function effectList(edits: ReplayEdits, kind: EffectKind): EffectRegion[] {
  return (edits[LISTS[kind]] ?? []) as EffectRegion[];
}

/** Whether any effect lane (zoom, speed, blur, caption) holds a region. */
export function hasEffectLanes(edits: ReplayEdits) {
  return EFFECT_KINDS.some((kind) => effectList(edits, kind).length > 0);
}

/** The edits with one lane's regions replaced (an empty lane leaves no list behind). */
export function withEffectList(edits: ReplayEdits, kind: EffectKind, list: readonly EffectRegion[]): ReplayEdits {
  const { [LISTS[kind]]: _old, ...rest } = edits;
  return list.length ? ({ ...rest, [LISTS[kind]]: list } as ReplayEdits) : (rest as ReplayEdits);
}

/** What a new region of each kind starts as. */
const DEFAULTS: { [K in EffectKind]: Record<string, unknown> } = {
  zoom: { scale: DEFAULT_ZOOM_SCALE },
  speed: { rate: 4 },
  blur: { x: 0.35, y: 0.38, width: 0.3, height: 0.14 },
  caption: { text: 'Caption' },
};

/** Default length of a region added at the playhead. */
export const NEW_EFFECT_MS = 3000;

/** Lanes whose regions take turns (src/shared/effect-room.ts): playback shows one zoom, speed or caption at a time. */
const TAKES_TURNS: ReadonlySet<EffectKind> = new Set(['zoom', 'speed', 'caption']);

/**
 * A new region of `kind` over [from, to) (clamped to the replay; zooms, speed-ups and captions to the free stretch
 * around `from`), with `extra` fields over the kind's defaults. Undefined when it would be shorter than MIN_EDIT_MS.
 */
export function addEffect(
  edits: ReplayEdits,
  kind: EffectKind,
  from: number,
  to: number,
  duration: number,
  extra: Record<string, unknown> = {},
): { edits: ReplayEdits; id: string } | undefined {
  const list = effectList(edits, kind);
  const placed = TAKES_TURNS.has(kind)
    ? placeSpan(list, from, to, duration)
    : { from: clamp(Math.min(from, to), 0, duration), to: clamp(Math.max(from, to), 0, duration) };
  if (!placed || placed.to - placed.from < MIN_EDIT_MS) return undefined;
  const id = nextCutId({ ...edits, cuts: list as ReplayCut[] }, kind);
  const region = { id, ...placed, ...DEFAULTS[kind], ...extra } as EffectRegion;
  return { edits: withEffectList(edits, kind, [...list, region]), id };
}

/**
 * Moves one edge of a region (or the whole region, `move`, with `time` as its new start), clamped like cuts; a zoom,
 * speed-up or caption also stops at its neighbours' edges.
 */
export function moveEffect(
  edits: ReplayEdits,
  kind: EffectKind,
  id: string,
  edge: 'from' | 'to' | 'move',
  time: number,
  duration: number,
): ReplayEdits {
  const list = effectList(edits, kind);
  const region = list.find((item) => item.id === id);
  if (!region) return edits;
  const { from, to } = retimeSpan(list, region, { edge, time, duration, exclusive: TAKES_TURNS.has(kind) });
  return withEffectList(
    edits,
    kind,
    list.map((item) => (item.id === id ? { ...item, from, to } : item)),
  );
}

const NO_ROOM: Partial<Record<EffectKind, string>> = {
  zoom: 'Already zoomed here',
  speed: 'Already sped up here',
  caption: 'A caption already shows here',
};

/** The status line when `addEffect` found no room: what is in the way and what to do. */
export function noRoomFor(kind: EffectKind) {
  return NO_ROOM[kind] ?? 'No room here for another one';
}

export function removeEffect(edits: ReplayEdits, kind: EffectKind, id: string): ReplayEdits {
  return withEffectList(
    edits,
    kind,
    effectList(edits, kind).filter((item) => item.id !== id),
  );
}

/** Changes a region's own fields (zoom scale, speed rate, blur box, caption text). */
export function updateEffect(edits: ReplayEdits, kind: EffectKind, id: string, patch: Record<string, unknown>): ReplayEdits {
  return withEffectList(
    edits,
    kind,
    effectList(edits, kind).map((item) => (item.id === id ? ({ ...item, ...patch } as EffectRegion) : item)),
  );
}

/** "Remove waits": cuts proposed from the wait steps (src/shared/edits.ts proposeWaitCuts), with fresh ids. */
export function removeWaits(edits: ReplayEdits, steps: readonly ReplayStep[], duration: number): { edits: ReplayEdits; added: number } {
  const taken = new Set(edits.cuts.map((cut) => cut.id));
  const proposals = proposeWaitCuts(steps, duration, edits.cuts, (index) => {
    let id = `wait-${index + 1}`;
    for (let n = 2; taken.has(id); n++) id = `wait-${index + 1}-${n}`;
    taken.add(id);
    return id;
  });
  return { edits: { ...edits, cuts: [...edits.cuts, ...proposals] }, added: proposals.length };
}

/** The cuts "Remove waits" would add, shown on the track as suggestions before they are applied. */
export function waitSuggestions(edits: ReplayEdits, steps: readonly ReplayStep[], duration: number): ReplayCut[] {
  const { edits: next } = removeWaits(edits, steps, duration);
  return next.cuts.slice(edits.cuts.length);
}

/** False when the edits would leave (almost) nothing to play: saving is refused then. */
export function leavesSomething(edits: ReplayEdits, duration: number) {
  return editTimeline(edits, duration).duration >= MIN_EDIT_MS;
}

/* ---------- Keyboard ---------- */

export type EditorShortcut =
  | 'undo'
  | 'redo'
  | 'save'
  | 'play-pause'
  | 'seek-back'
  | 'seek-forward'
  | 'seek-back-long'
  | 'seek-forward-long'
  | 'nudge-back'
  | 'nudge-forward'
  | 'previous-step'
  | 'next-step'
  | 'trim-start'
  | 'trim-end'
  | 'add-cut'
  | 'remove-waits'
  | 'zoom'
  | 'speed'
  | 'blur'
  | 'caption'
  | 'highlight'
  | 'apply'
  | 'delete'
  | 'deselect'
  | 'shortcuts';

/** The editor's keys; `mac` picks ⌘ over Ctrl for undo, redo and save. Typing in a field is left alone. */
export function editorShortcutFor(event: KeyLike, target?: TargetLike | null, mac = true): EditorShortcut | undefined {
  const mod = mac ? event.metaKey : event.ctrlKey;
  if (mod && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !mac) return 'redo';
    if (key === 's') return 'save';
    return undefined;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  if (isTypingTarget(target)) return undefined;
  const tag = target?.tagName?.toLowerCase();
  if ((event.key === ' ' || event.key === 'Enter') && (tag === 'button' || tag === 'a')) return undefined;
  if (event.key === 'Enter' && tag !== 'button' && tag !== 'a') return 'apply';
  switch (event.key) {
    case ' ':
    case 'k':
      return 'play-pause';
    // ←/→ step a tenth of a second (a frame or so of a recording); Shift a whole second.
    case 'ArrowLeft':
      return event.shiftKey ? 'seek-back' : 'nudge-back';
    case 'ArrowRight':
      return event.shiftKey ? 'seek-forward' : 'nudge-forward';
    case 'J':
    case 'j':
      return 'seek-back-long';
    case 'L':
    case 'l':
      return 'seek-forward-long';
    case ',':
      return 'nudge-back';
    case '.':
      return 'nudge-forward';
    case '[':
      return 'previous-step';
    case ']':
      return 'next-step';
    case 'i':
    case 'I':
      return 'trim-start';
    case 'o':
    case 'O':
      return 'trim-end';
    case 'c':
    case 'C':
    case 's':
    case 'S':
      return 'add-cut';
    case 'w':
    case 'W':
      return 'remove-waits';
    case 'z':
    case 'Z':
      return 'zoom';
    case 'f':
    case 'F':
      return 'speed';
    case 'b':
    case 'B':
      return 'blur';
    case 't':
    case 'T':
      return 'caption';
    case 'm':
    case 'M':
      return 'highlight';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case 'Escape':
      return 'deselect';
    case '?':
      return 'shortcuts';
    default:
      return undefined;
  }
}

/** A typed time ("1:02.5", "62.5", "62") in ms; undefined when it is not one. */
export function parseClock(text: string): number | undefined {
  const match = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return undefined;
  const seconds = Number(match[2]);
  if (match[1] && seconds >= 60) return undefined;
  return Math.round(((match[1] ? Number(match[1]) : 0) * 60 + seconds) * 1000);
}

/** "3 min ago", "2 h ago", "yesterday"…: when an edit list was saved, relative to `now`. */
export function savedAgo(iso: string | undefined, now = Date.now()) {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
