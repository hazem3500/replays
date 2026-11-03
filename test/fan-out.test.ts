import { describe, expect, it } from 'vitest';

import { fanLag, type Flight, stackedShare } from '../src/client/transitions/fan-out.ts';

/** A library suite card's four stacked sheets, flying to a two by two comparison grid (measured at 1280 by 800). */
const STACK_TO_GRID: Flight[] = [
  { from: { x: 32, y: 132, width: 96, height: 60 }, to: { x: 340, y: 60, width: 274, height: 172 } },
  { from: { x: 34, y: 128, width: 93, height: 60 }, to: { x: 622, y: 60, width: 274, height: 172 } },
  { from: { x: 35, y: 124, width: 89, height: 60 }, to: { x: 340, y: 240, width: 274, height: 172 } },
  { from: { x: 37, y: 120, width: 86, height: 60 }, to: { x: 622, y: 240, width: 274, height: 172 } },
];
const GRID_TO_STACK = STACK_TO_GRID.map(({ from, to }) => ({ from: to, to: from }));

describe('suite sheet fan-out', () => {
  it('lets sheets spreading from a stack stop covering each other before the middle of their flight', () => {
    expect(stackedShare(STACK_TO_GRID, fanLag(STACK_TO_GRID, false), false)).toBeLessThan(0.45);
  });

  it('keeps sheets that grow while they move covering each other for most of the flight', () => {
    expect(stackedShare(STACK_TO_GRID, 0, false)).toBeGreaterThan(0.85);
  });

  it('lets sheets gathering back into a stack meet only in the last part of their flight', () => {
    expect(stackedShare(GRID_TO_STACK, fanLag(GRID_TO_STACK, true), true)).toBeLessThan(0.45);
  });

  it('never holds back a single picture', () => {
    expect(fanLag(STACK_TO_GRID.slice(0, 1), false)).toBe(0);
  });
});
