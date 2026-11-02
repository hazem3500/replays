import { describe, expect, it } from 'vitest';

import { bestGrid, cellAspect, gridRects, neighbour, spotlightRects } from '../src/client/comparison/meeting/layout.ts';
import { errorNow, mergedMarkers, startsIn, tileLetter, type TileModel } from '../src/client/comparison/meeting/tiles.ts';
import { meetingQuery, parseMeetingSearch } from '../src/client/comparison/meeting/url.ts';

describe('meeting layout', () => {
  it('picks the grid that gives each tile the most area', () => {
    expect(bestGrid(2, { width: 1200, height: 600 }, 16 / 10)).toMatchObject({ columns: 2, rows: 1 });
    expect(bestGrid(4, { width: 1200, height: 750 }, 16 / 10)).toMatchObject({ columns: 2, rows: 2 });
    expect(bestGrid(9, { width: 1200, height: 750 }, 16 / 10)).toMatchObject({ columns: 3, rows: 3 });
    expect(bestGrid(3, { width: 400, height: 900 }, 16 / 10)).toMatchObject({ columns: 1, rows: 3 });
  });

  it('keeps every tile at the cell aspect and centres a short last row', () => {
    const rects = gridRects(5, { width: 1200, height: 700 }, 1.6);
    for (const rect of rects) expect(rect.width / rect.height).toBeCloseTo(1.6);
    const last = rects.at(-1)!;
    const lastRowWidth = last.x + last.width - rects[3]!.x;
    expect(rects[3]!.x).toBeCloseTo((1200 - lastRowWidth) / 2);
  });

  it('puts the filmstrip beside a wide stage and under a tall one', () => {
    const wide = spotlightRects(4, 2, { width: 1400, height: 700 }, 1.6);
    expect(wide.placements[2]!.role).toBe('spotlight');
    expect(wide.placements.filter((item) => item.role === 'strip').every((item) => item.x > wide.placements[2]!.x)).toBe(true);
    const tall = spotlightRects(4, 0, { width: 600, height: 900 }, 1.6);
    expect(tall.placements.slice(1).every((item) => item.y > tall.placements[0]!.y + tall.placements[0]!.height)).toBe(true);
  });

  it('moves focus to the nearest tile in the arrow direction', () => {
    const rects = gridRects(4, { width: 800, height: 500 }, 1.6);
    expect(neighbour(rects, 0, 'ArrowRight')).toBe(1);
    expect(neighbour(rects, 0, 'ArrowDown')).toBe(2);
    expect(neighbour(rects, 3, 'ArrowUp')).toBe(1);
    expect(neighbour(rects, 0, 'ArrowLeft')).toBe(0);
  });

  it('uses the median aspect for mixed recordings', () => {
    expect(cellAspect([0.5, 1.6, 1.6, 2])).toBe(1.6);
    expect(cellAspect([])).toBe(1.6);
  });
});

const tile = (id: string, colour: number, errors: number[]): TileModel => ({
  id,
  label: id,
  letter: tileLetter(colour),
  colour,
  title: id,
  aspect: 1.6,
  duration: 10_000,
  errors: errors.map((at) => ({ at, label: `error ${at}` })),
});

describe('meeting tiles', () => {
  it('merges markers on the shared timeline, skipping excluded tiles and lead-ins', () => {
    const markers = mergedMarkers(
      [tile('a', 0, [500, 3000]), tile('b', 1, [2000]), tile('c', 2, [100])],
      { a: 1000 },
      9000,
      new Set(['c']),
    );
    expect(markers.map((marker) => [marker.tile, marker.at])).toEqual([
      ['a', 2000],
      ['b', 2000],
    ]);
  });

  it('highlights an error only within its glow window', () => {
    const errors = [{ at: 1000, label: 'x' }];
    expect(errorNow(errors, 900)).toBeUndefined();
    expect(errorNow(errors, 1200)?.label).toBe('x');
    expect(errorNow(errors, 4000)).toBeUndefined();
  });

  it('counts down to a start', () => {
    expect(startsIn(-1180)).toBe('Starts in 1.2s');
    expect(startsIn(-12_300)).toBe('Starts in 13s');
    expect(tileLetter(27)).toBe('AB');
  });
});

describe('meeting URL', () => {
  it('round-trips ids, pin, offsets and visibility as plain text', () => {
    const search = parseMeetingSearch({
      ids: 'a-1,b-2,c-3,a-1,BAD!',
      pin: 'b-2',
      align: 'a-1:1200,b-2:-500,x:',
      hide: 'c-3',
      mute: 'a-1',
      t: '12.5s',
    });
    expect(search).toEqual({
      ids: ['a-1', 'b-2', 'c-3'],
      pin: 'b-2',
      align: { 'a-1': 1200, 'b-2': -500 },
      hide: ['c-3'],
      mute: ['a-1'],
      t: 12.5,
    });
    expect(meetingQuery(search)).toBe('?ids=a-1,b-2,c-3&pin=b-2&align=a-1:1200,b-2:-500&hide=c-3&mute=a-1&t=12.5');
  });

  it('opens older before/after links as the first two tiles', () => {
    expect(parseMeetingSearch({ before: 'x', after: 'y' })).toEqual({ ids: ['x', 'y'] });
    expect(parseMeetingSearch({ suite: 's', before: 'x', after: 'y' })).toEqual({ suite: 's' });
    expect(parseMeetingSearch({ ids: 'a,b,c', before: 'x', after: 'y' })).toEqual({ ids: ['a', 'b', 'c'] });
  });
});
