import { describe, expect, it } from 'vitest';

import { capturedRecord, resolveCapture } from './capture-options.ts';
import type { RecorderCapture } from './types.ts';

const record = (capture: RecorderCapture) => capturedRecord(resolveCapture({ capture }), false, false);

describe('meta.captured.diagnostics', () => {
  it('is written when Performance is turned on, with Debugging as chosen', () => {
    expect(record({ performance: true }).diagnostics).toEqual({ performance: true, debugging: false, chosen: true });
    expect(record({ performance: true, debugging: true }).diagnostics).toEqual({ performance: true, debugging: true, chosen: true });
  });

  it('is left out when Performance is off', () => {
    expect(record({}).diagnostics).toBeUndefined();
    expect(record({ debugging: true }).diagnostics).toBeUndefined();
  });
});
