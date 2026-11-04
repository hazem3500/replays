import { describe, expect, it } from 'vitest';

import { compareTiles } from '../src/client/compare/tiles.ts';
import { recordedRuns } from '../src/client/suite/runs.ts';

const runs = [
  { sequence: 3, label: 'Firefox', replayId: 'firefox' },
  { sequence: 1, label: 'Chrome', replayId: 'chrome' },
  { sequence: 2, label: 'Safari' },
];

describe('suite run colours', () => {
  it('numbers colours over the recorded runs in sequence, skipping runs without a recording', () => {
    expect(recordedRuns(runs, false).map(({ replayId, colour }) => [replayId, colour])).toEqual([
      ['chrome', 1],
      ['firefox', 2],
    ]);
  });

  it('gives each Compare tile the colour its sidebar row shows, whatever order the stage receives them in', () => {
    const recorded = recordedRuns(runs, false).toReversed();
    const tiles = compareTiles(recorded.map((run) => ({ id: run.replayId, label: run.label, colour: run.colour, bundle: undefined })));
    expect(tiles.map((tile) => tile.colour)).toEqual(recorded.map((run) => run.colour));
  });
});
