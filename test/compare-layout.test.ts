import { describe, expect, it } from 'vitest';

import { bestGrid, gridRects, placementsFor, spotlightRects } from '../src/client/compare/layout.ts';

describe('compare layout', () => {
  it('picks the grid that gives each tile the most area', () => {
    expect(bestGrid(2, { width: 1200, height: 600 }, 16 / 10)).toMatchObject({ columns: 2, rows: 1 });
    expect(bestGrid(4, { width: 1200, height: 750 }, 16 / 10)).toMatchObject({ columns: 2, rows: 2 });
    expect(bestGrid(9, { width: 1200, height: 750 }, 16 / 10)).toMatchObject({ columns: 3, rows: 3 });
    expect(bestGrid(3, { width: 400, height: 900 }, 16 / 10)).toMatchObject({ columns: 1, rows: 3 });
  });

  it('keeps every grid tile at the cell aspect and centres a short last row', () => {
    const rects = gridRects(5, { width: 1200, height: 700 }, 1.6);
    for (const rect of rects) expect(rect.width / rect.height).toBeCloseTo(1.6);
    const [, , , fourth, last] = rects;
    const lastRowWidth = (last?.x ?? 0) + (last?.width ?? 0) - (fourth?.x ?? 0);
    expect(fourth?.x).toBeCloseTo((1200 - lastRowWidth) / 2);
  });

  it('puts the spotlight strip beside a wide stage and under a tall one', () => {
    const [a, b, hero, c] = spotlightRects(4, 2, { width: 1400, height: 700 }, 1.6);
    expect(hero?.role).toBe('spotlight');
    for (const strip of [a, b, c]) expect(strip?.x).toBeGreaterThan(hero?.x ?? Infinity);
    const [top, ...rest] = spotlightRects(4, 0, { width: 600, height: 900 }, 1.6);
    for (const strip of rest) expect(strip.y).toBeGreaterThan((top?.y ?? 0) + (top?.height ?? Infinity));
  });

  it('gives the focused tile the whole stage in single and hides the others where the grid has them', () => {
    const box = { width: 1000, height: 600 };
    const single = placementsFor({ layout: 'single', count: 3, focus: 1, box, aspect: 1.6 });
    const grid = placementsFor({ layout: 'grid', count: 3, focus: 1, box, aspect: 1.6 });
    expect(single[1]).toEqual({ x: 0, y: 0, width: 1000, height: 600, role: 'single' });
    expect(single[0]).toEqual({ ...grid[0], role: 'hidden' });
    expect(single[2]?.role).toBe('hidden');
  });

  it('spotlights the focused tile', () => {
    const placements = placementsFor({ layout: 'spotlight', count: 3, focus: 2, box: { width: 1400, height: 700 }, aspect: 1.6 });
    expect(placements.map((item) => item.role)).toEqual(['strip', 'strip', 'spotlight']);
  });

  it('places nothing before the stage is measured', () => {
    expect(placementsFor({ layout: 'grid', count: 2, focus: 0, box: { width: 0, height: 0 }, aspect: 1.6 })).toEqual([]);
  });
});
