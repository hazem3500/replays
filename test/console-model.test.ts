import { describe, expect, it } from 'vitest';

import {
  filterRows,
  frameFile,
  groupRepeats,
  headline,
  levelCounts,
  messageParts,
  stackFrames,
} from '../src/client/viewer/console/model.ts';
import type { ReplayConsoleEntry } from '../src/shared/replay.ts';

const entry = (at: number, level: ReplayConsoleEntry['level'], message: string): ReplayConsoleEntry => ({
  at,
  level,
  message,
  url: 'https://shop.test/checkout',
});

const THROWN = [
  "TypeError: Cannot read properties of undefined (reading 'total')",
  '    at renderSummary (https://shop.test/assets/app.js:212:31)',
  '    at https://shop.test/vendor/store.js:44:7',
  '    at Array.forEach (<anonymous>)',
].join('\n');

describe('console rows', () => {
  it('folds identical consecutive messages into one row with a count and every time', () => {
    const rows = groupRepeats([entry(1, 'log', 'poll'), entry(2, 'log', 'poll'), entry(3, 'warn', 'poll'), entry(4, 'log', 'poll')]);
    expect(rows.map((row) => [row.entry.level, row.count, row.ats])).toEqual([
      ['log', 2, [1, 2]],
      ['warn', 1, [3]],
      ['log', 1, [4]],
    ]);
  });

  it('counts every logged time per level, with log under info', () => {
    const rows = groupRepeats([entry(1, 'error', 'a'), entry(2, 'error', 'a'), entry(3, 'log', 'b'), entry(4, 'info', 'c')]);
    expect(levelCounts(rows)).toEqual({ all: 4, error: 2, warn: 0, info: 2, debug: 0, focus: 0 });
  });

  it('filters by level and by every word of the text', () => {
    const rows = groupRepeats([entry(1, 'error', 'Coupon service answered 404'), entry(2, 'log', 'coupon applied')]);
    expect(filterRows(rows, 'error', '').map((row) => row.entry.message)).toEqual(['Coupon service answered 404']);
    expect(filterRows(rows, 'all', 'coupon 404').map((row) => row.entry.message)).toEqual(['Coupon service answered 404']);
  });
});

describe('console messages', () => {
  it('indents JSON objects found among the logged arguments and keeps the rest as captured', () => {
    expect(messageParts('cart updated {"items":[1,2]} total 38')).toEqual([
      { kind: 'text', text: 'cart updated ' },
      { kind: 'json', text: '{\n  "items": [\n    1,\n    2\n  ]\n}' },
      { kind: 'text', text: ' total 38' },
    ]);
  });

  it('leaves brackets in prose alone', () => {
    expect(messageParts('[1/3] retrying {soon}')).toEqual([{ kind: 'text', text: '[1/3] retrying {soon}' }]);
  });

  it('reads stack frames from a thrown error captured in the message, with or without a location', () => {
    expect(stackFrames(THROWN)).toEqual([
      { fn: 'renderSummary', file: 'https://shop.test/assets/app.js', line: 212, column: 31 },
      { file: 'https://shop.test/vendor/store.js', line: 44, column: 7 },
      { fn: 'Array.forEach', file: '<anonymous>' },
    ]);
    expect(headline(THROWN)).toBe("TypeError: Cannot read properties of undefined (reading 'total')");
  });

  it('reads Firefox frames too', () => {
    expect(stackFrames('oops\nrender@https://shop.test/app.js:3:9')).toEqual([
      { fn: 'render', file: 'https://shop.test/app.js', line: 3, column: 9 },
    ]);
  });

  it('finds no frames in an ordinary message, even one that starts with "at"', () => {
    expect(stackFrames('at least 3 items are needed\nretry later')).toEqual([]);
  });

  it('names a frame by its file path', () => {
    expect(frameFile('https://shop.test/assets/app.js?v=3')).toBe('assets/app.js');
  });
});
