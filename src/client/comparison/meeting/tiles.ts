import type { ReplayBundle } from '../../../shared/replay.ts';
import { collectErrors } from '../../issues.ts';

/** Seconds an error keeps its tile highlighted after it happens. */
export const ERROR_GLOW_MS = 1500;
export const TILE_COLOURS = 9;

export interface TileSource {
  id: string;
  /** Run label, Before/After, or the recording's title. */
  label: string;
  /** A, B, C… for markers, announcements and the colour key. */
  letter: string;
  colour: number;
}

export interface TileModel extends TileSource {
  title: string;
  aspect: number;
  duration: number;
  /** Local times of captured errors, ascending. */
  errors: Array<{ at: number; label: string }>;
}

export const tileLetter = (index: number) =>
  index < 26
    ? String.fromCharCode(65 + index)
    : `${String.fromCharCode(65 + Math.floor(index / 26) - 1)}${String.fromCharCode(65 + (index % 26))}`;

/** Labels, letters and colours follow the URL order, so a shared link shows the same identities. */
export function tileSources(ids: readonly string[], labels: Readonly<Record<string, string>> = {}): TileSource[] {
  return ids.map((id, index) => ({ id, label: labels[id] ?? '', letter: tileLetter(index), colour: index % TILE_COLOURS }));
}

export function tileModel(source: TileSource, bundle: ReplayBundle): TileModel {
  const { width, height } = bundle.meta.viewport;
  return {
    ...source,
    label: source.label || bundle.meta.title || source.id,
    title: bundle.meta.title,
    aspect: width > 0 && height > 0 ? width / height : 16 / 10,
    duration: bundle.meta.duration,
    errors: collectErrors(bundle).map(({ at, label }) => ({ at, label })),
  };
}

/** Index of the last error at or before `local`, or -1. */
function lastAtOrBefore(errors: TileModel['errors'], local: number) {
  let low = 0;
  let high = errors.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (errors[middle]!.at > local) {
      high = middle - 1;
      continue;
    }
    found = middle;
    low = middle + 1;
  }
  return found;
}

/** The error a tile is showing right now (within the glow window), if any. */
export function errorNow(errors: TileModel['errors'], local: number) {
  const index = lastAtOrBefore(errors, local);
  const error = errors[index];
  return error && local - error.at <= ERROR_GLOW_MS ? error : undefined;
}

export interface Marker {
  id: string;
  tile: string;
  colour: number;
  letter: string;
  /** Shared time. */
  at: number;
  label: string;
}

/** Every visible, unmuted tile's errors on the shared timeline, in time order; ones outside it are left off. */
export function mergedMarkers(
  tiles: readonly TileModel[],
  offsets: Readonly<Record<string, number>>,
  duration: number,
  excluded: ReadonlySet<string>,
): Marker[] {
  return tiles
    .filter((tile) => !excluded.has(tile.id))
    .flatMap((tile) =>
      tile.errors.map((error, index) => ({
        id: `${tile.id}:${index}`,
        tile: tile.id,
        colour: tile.colour,
        letter: tile.letter,
        at: error.at - (offsets[tile.id] ?? 0),
        label: error.label,
      })),
    )
    .filter((marker) => marker.at >= 0 && marker.at <= duration)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** "Starts in 1.2s" for a waiting tile; whole seconds past ten. */
export function startsIn(local: number) {
  const seconds = -local / 1000;
  return `Starts in ${seconds >= 10 ? Math.ceil(seconds) : Math.max(0.1, Math.ceil(seconds * 10) / 10).toFixed(1)}s`;
}
