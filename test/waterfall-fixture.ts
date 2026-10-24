import type { ReplayEdits } from '../src/shared/edits.ts';
import type { ReplayNetworkEntry } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

export const request = (overrides: Partial<ReplayNetworkEntry> = {}): ReplayNetworkEntry => ({
  id: 'req',
  at: 1000,
  duration: 2000,
  method: 'GET',
  url: 'https://example.com/api/projects',
  status: 200,
  statusText: 'OK',
  requestHeaders: [],
  responseHeaders: [],
  ...overrides,
});

export function waterfallFixture() {
  const bundle = replay();
  bundle.meta.duration = 10000;
  bundle.events = [
    { type: 4, timestamp: 1000 },
    { type: 2, timestamp: 11000 },
  ];
  bundle.steps = [{ at: 1500, kind: 'click', label: 'Open projects', selector: '#projects' }];
  return bundle;
}

export const waterfallEdits: ReplayEdits = {
  version: 1,
  trim: { start: 1000, end: 9000 },
  cuts: [{ id: 'wait', from: 3000, to: 4000 }],
  speeds: [{ id: 'fast', from: 4000, to: 8000, rate: 2 }],
};
