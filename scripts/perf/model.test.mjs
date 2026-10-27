import assert from 'node:assert/strict';
import { test } from 'node:test';
import { median, summarize, usedBytes, violations } from './model.mjs';

test('medians exclude unavailable metrics without turning them into zero', () => {
  assert.equal(median([100, 400, 200, null]), 200);
  assert.equal(median([10, 20]), 15);
  assert.equal(median([null, undefined, NaN]), null);
  assert.deepEqual(summarize([{ metrics: { cls: null } }, { metrics: { cls: 0.1 } }]), { cls: 0.1 });
});
test('executed coverage subtracts unexecuted nested ranges', () => {
  assert.equal(
    usedBytes([
      {
        ranges: [
          { startOffset: 0, endOffset: 100, count: 1 },
          { startOffset: 20, endOffset: 60, count: 0 },
          { startOffset: 30, endOffset: 40, count: 1 },
        ],
      },
    ]),
    70,
  );
});
test('nested function source is counted once across a script', () => {
  assert.equal(
    usedBytes([{ ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] }, { ranges: [{ startOffset: 20, endOffset: 60, count: 1 }] }]),
    100,
  );
});
test('ratchet identifies only measured upper-bound violations', () => {
  assert.deepEqual(violations({ lcp: 3000, inp: null }, { lcp: 2500, inp: 200 }), [{ key: 'lcp', value: 3000, limit: 2500 }]);
});
