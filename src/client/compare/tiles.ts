import type { ReplayBundle } from '../../shared/replay.ts';
import { collectErrors } from '../issues.ts';

export const TILE_COLOURS = 9;

/** The colour (1 to 9) of the recording at `index` on the stage; colours repeat after nine. */
export const tileColour = (index: number) => (index % TILE_COLOURS) + 1;
const FALLBACK_ASPECT = 16 / 10;

/** One recording on the stage: who it is (letter, colour, label) and, once loaded, its bundle. */
export interface CompareTile {
  id: string;
  /** What tells this recording apart from the others ("Before", "Firefox", "Run 3"): tiles, scope and panels use it. */
  name: string;
  /** 1 to 9: `data-tile` picks `--tile-N` (compare.css), the recording's colour wherever it appears. */
  colour: number;
  /** The run label in a suite; else the recording's own title. */
  label: string;
  bundle: ReplayBundle | undefined;
  failure: string;
  errors: number;
  aspect: number;
  /** An ad-hoc addition the person can take off the stage again (never the page's own recording or a suite run). */
  removable: boolean;
}

export type LoadedTile = CompareTile & { bundle: ReplayBundle };

export const isLoaded = (tile: CompareTile): tile is LoadedTile => tile.bundle !== undefined;

const SEPARATOR = /\s+[·|•-]\s+|:\s+/;
const TRAILING_NOTE = /\s*\([^()]*\)$/;

function sharedEnds(lists: readonly string[][]) {
  const shortest = Math.min(...lists.map((list) => list.length));
  let lead = 0;
  while (lead < shortest - 1 && lists.every((list) => list[lead] === lists[0]?.[lead])) lead += 1;
  let tail = 0;
  while (tail < shortest - 1 - lead && lists.every((list) => list.at(-1 - tail) === lists[0]?.at(-1 - tail))) tail += 1;
  return { lead, tail };
}

const capitalised = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/**
 * Short names that tell recordings apart: the parts every label shares ("Checkout performance · …", a common
 * "(fictional demo)") are dropped, so "Checkout performance · Before" and "… · After" read "Before" and "After".
 * Labels with nothing in common stay whole; names that would repeat are numbered.
 */
export function shortNames(labels: readonly string[]) {
  const notes = labels.map((label) => TRAILING_NOTE.exec(label)?.[0] ?? '');
  const sameNote = labels.length > 1 && notes.every((note) => note && note === notes[0]);
  const parts = labels.map((label) => (sameNote ? label.replace(TRAILING_NOTE, '') : label).split(SEPARATOR));
  const { lead, tail } = labels.length > 1 ? sharedEnds(parts) : { lead: 0, tail: 0 };
  const trimmed = sameNote || lead > 0 || tail > 0;
  const names = parts.map((list, index) =>
    trimmed ? capitalised(list.slice(lead, list.length - tail).join(' · ')) : capitalised(labels[index] ?? ''),
  );
  return names.map((name, index) => {
    const before = names.slice(0, index).filter((other) => other === name).length;
    return before ? `${name} ${before + 1}` : name;
  });
}

/**
 * One-glyph marks for a slim run switcher: each short name's first letter or digit when those are all different
 * ("Chrome", "Firefox" read C and F), otherwise every run's position (1, 2, …) so no two marks repeat.
 */
export function monograms(names: readonly string[]) {
  const initials = names.map((name) => (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? '').toLocaleUpperCase());
  const distinct = initials.every((initial, index) => initial && initials.indexOf(initial) === index);
  return distinct ? initials : names.map((_, index) => String(index + 1));
}

export interface TileInput {
  id: string;
  /** A suite run's label; ad-hoc recordings go by their title. */
  label?: string | undefined;
  /** What tells it apart from the others, when the page knows better than the labels do (a suite target). */
  name?: string | undefined;
  bundle: ReplayBundle | undefined;
  failure?: string | undefined;
  removable?: boolean;
  /** A colour the page already gave this recording (a suite run's sidebar row); else its position picks one. */
  colour?: number | undefined;
}

function labelOf(id: string, label: string | undefined, bundle: ReplayBundle | undefined) {
  if (label) return label;
  if (bundle?.meta.title) return bundle.meta.title;
  return id;
}

function aspectOf(bundle: ReplayBundle | undefined) {
  const width = bundle?.meta.viewport.width ?? 0;
  const height = bundle?.meta.viewport.height ?? 0;
  return width > 0 && height > 0 ? width / height : FALLBACK_ASPECT;
}

/** Identities follow tile order, so a shared link shows the same names and colours to everyone. */
export function compareTiles(inputs: readonly TileInput[]): CompareTile[] {
  const labels = inputs.map(({ id, label, bundle }) => labelOf(id, label, bundle));
  const names = shortNames(labels);
  return inputs.map(({ id, bundle, failure = '', removable = false, colour, name }, index) => ({
    id,
    name: name ?? names[index] ?? id,
    colour: colour ?? tileColour(index),
    label: labels[index] ?? id,
    bundle,
    failure,
    errors: bundle ? collectErrors(bundle).length : 0,
    aspect: aspectOf(bundle),
    removable,
  }));
}

/** The aspect most loaded tiles share (median width/height), so one cell shape fits the grid. */
export function cellAspect(tiles: readonly CompareTile[]) {
  const aspects = tiles
    .filter(isLoaded)
    .map((tile) => tile.aspect)
    .toSorted((a, b) => a - b);
  return aspects[Math.floor(aspects.length / 2)] ?? FALLBACK_ASPECT;
}
