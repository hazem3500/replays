import type { ReplayBundle } from '../../shared/replay.ts';
import { collectErrors } from '../issues.ts';

export const TILE_COLOURS = 9;
const FALLBACK_ASPECT = 16 / 10;

/** One recording on the stage: who it is (letter, colour, label) and, once loaded, its bundle. */
export interface CompareTile {
  id: string;
  /** A, B, C… in tile order: the colour key, the scope switch and the labels use it. */
  letter: string;
  /** 1 to 9: `data-tile` picks `--tile-N` (compare.css). */
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

export const tileLetter = (index: number) => String.fromCodePoint(65 + (index % 26));

export interface TileInput {
  id: string;
  /** A suite run's label; ad-hoc recordings go by their title. */
  label?: string | undefined;
  bundle: ReplayBundle | undefined;
  failure?: string | undefined;
  removable?: boolean;
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

/** Identities follow tile order, so a shared link shows the same letters and colours to everyone. */
export function compareTiles(inputs: readonly TileInput[]): CompareTile[] {
  return inputs.map(({ id, label, bundle, failure = '', removable = false }, index) => ({
    id,
    letter: tileLetter(index),
    colour: (index % TILE_COLOURS) + 1,
    label: labelOf(id, label, bundle),
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
