import { playheadX, REST_FILLED, SEGMENTS } from '../index/mark-burst.ts';

/**
 * The built-in mark: a timeline of rounded segments, the played ones in the accent, and the accent playhead (a stem
 * with a knob on top) just after them; unplayed segments are the text colour at 35 %. The header draws HEADER_MARK
 * (brand-mark.tsx ProductMark; mark-burst.ts animates it) and scripts/build-icons.mjs draws both cuts as icons.
 */
export interface MarkGeometry {
  /** The square grid the coordinates live on. */
  grid: number;
  /** [x, width] per segment, all on one track. */
  segments: ReadonlyArray<readonly [number, number]>;
  /** The track's top and height; segments are fully rounded. */
  top: number;
  height: number;
  /** How many segments come before the playhead. */
  played: number;
  /** Stem centre, stem width (also the knob's radius), knob centre and stem bottom. */
  playhead: { x: number; width: number; knob: number; bottom: number };
}

export const HEADER_MARK: MarkGeometry = {
  grid: 24,
  segments: SEGMENTS,
  top: 10,
  height: 4.2,
  played: REST_FILLED,
  playhead: { x: playheadX(REST_FILLED - 1), width: 1.9, knob: 6.6, bottom: 17.8 },
};

/**
 * The 16 px cut for the favicon. Five segments blur below 24 px, so it keeps the structure (two played, the playhead,
 * the unplayed tail) in four heavier segments: every shape at least 2 px, every gap 1 px, at 16 px.
 */
export const FAVICON_MARK: MarkGeometry = {
  grid: 32,
  segments: [
    [1, 7],
    [9.8, 3],
    [21.2, 4.4],
    [27.6, 3.4],
  ],
  top: 15,
  height: 6,
  played: 2,
  playhead: { x: 17, width: 4.4, knob: 8.8, bottom: 27.5 },
};

/** The mark as SVG markup on its grid, in two CSS colours; the unplayed segments draw at 35 % like the header's. */
export function markShapes(mark: MarkGeometry, colors: { accent: string; rest: string }) {
  const radius = mark.height / 2;
  const segments = mark.segments.map(([x, width], index) => {
    const fill = index < mark.played ? `fill="${colors.accent}"` : `fill="${colors.rest}" fill-opacity="0.35"`;
    return `<rect x="${x}" y="${mark.top}" width="${width}" height="${mark.height}" rx="${radius}" ${fill}/>`;
  });
  const { x, width, knob, bottom } = mark.playhead;
  const stem = `<rect x="${round(x - width / 2)}" y="${knob}" width="${width}" height="${round(bottom - knob)}" rx="${width / 2}" fill="${colors.accent}"/>`;
  const head = `<circle cx="${x}" cy="${knob}" r="${width}" fill="${colors.accent}"/>`;
  return segments.join('') + stem + head;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
