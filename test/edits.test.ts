import { describe, expect, it } from 'vitest';

import {
  applyEdits,
  assertReplayEdits,
  EDIT_END_TAG,
  editsVersion,
  editSteps,
  editTimeline,
  isEmptyEdits,
  normalizeEdits,
  proposeWaitCuts,
  type ReplayEdits,
  sameEdits,
} from '../src/shared/edits.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { assertReplayBundle } from '../src/shared/replay.ts';

const edits = (patch: Partial<ReplayEdits> = {}): ReplayEdits => ({ version: 1, cuts: [], ...patch });

describe('edit list schema', () => {
  it('accepts trims and cuts inside the replay', () => {
    expect(() =>
      assertReplayEdits(edits({ trim: { start: 100, end: 900 }, cuts: [{ id: 'c1', from: 200, to: 400 }] }), 1000),
    ).not.toThrow();
    expect(() => assertReplayEdits(edits(), 1000)).not.toThrow();
  });

  it('names the field it rejects', () => {
    expect(() => assertReplayEdits({ version: 2, cuts: [] })).toThrow('edits.version must be 1');
    expect(() => assertReplayEdits({ version: 1 })).toThrow('edits.cuts');
    expect(() => assertReplayEdits({ ...edits(), extra: true })).toThrow('edits.extra is not a supported field');
    expect(() => assertReplayEdits(edits({ trim: { start: 500, end: 450 } }))).toThrow('edits.trim must keep');
    expect(() => assertReplayEdits(edits({ cuts: [{ id: 'Bad Id', from: 0, to: 500 }] }))).toThrow('edits.cuts[0].id');
    expect(() =>
      assertReplayEdits(
        edits({
          cuts: [
            { id: 'a', from: 0, to: 500 },
            { id: 'a', from: 600, to: 900 },
          ],
        }),
      ),
    ).toThrow('edits.cuts[1].id is used twice');
    expect(() => assertReplayEdits(edits({ cuts: [{ id: 'a', from: 0, to: 50 }] }))).toThrow('at least 100 ms');
    expect(() => assertReplayEdits(edits({ cuts: [{ id: 'a', from: Number.NaN, to: 500 }] }))).toThrow('edits.cuts[0].from');
    expect(() => assertReplayEdits(edits({ cuts: [{ id: 'a', from: 0, to: 500, label: 'x'.repeat(121) }] }))).toThrow('label');
    expect(() => assertReplayEdits(edits({ cursor: { motionStyle: 'wobbly' as never } }))).toThrow('edits.cursor.motionStyle must be one of');
    expect(() => assertReplayEdits(edits({ cursor: { motionStyle: 'comet_swoop' } }))).not.toThrow();
    expect(() => assertReplayEdits(edits({ highlights: [{ id: 'p', kind: 'point', at: 10, extra: true }] as never }))).toThrow(
      'not a supported field',
    );
    expect(() =>
      assertReplayEdits(
        edits({
          highlights: [
            { id: 'p', kind: 'point', at: 10 },
            { id: 'p', kind: 'point', at: 20 },
          ],
        }),
      ),
    ).toThrow('id is used twice');
    expect(() => assertReplayEdits(edits({ highlights: [{ id: 'p', kind: 'point', at: 1001 }] }), 1000)).toThrow('after the end');
    expect(() => assertReplayEdits(edits({ highlights: [{ id: 'h', kind: 'period', from: 0, to: 99 }] }))).toThrow('at least 100 ms');
    expect(() => assertReplayEdits(edits({ highlights: [{ id: 'h', kind: 'period', from: 0, to: 100, label: 'x'.repeat(121) }] }))).toThrow(
      'label',
    );
  });

  it('checks times against the replay, and that something remains', () => {
    expect(() => assertReplayEdits(edits({ trim: { start: 0, end: 1200 } }), 1000)).toThrow('after the end of the replay');
    expect(() => assertReplayEdits(edits({ trim: { start: 100, end: 600 }, cuts: [{ id: 'all', from: 50, to: 700 }] }), 1000)).toThrow(
      'remove the whole replay',
    );
  });

  it('normalizes, compares and versions by content only', () => {
    const a = edits({
      cuts: [
        { id: 'b', from: 600.4, to: 800 },
        { id: 'a', from: 100, to: 300 },
      ],
    });
    const b = { ...edits({ cuts: a.cuts.toReversed() }), revision: 4, updatedBy: 'x@example.com' } as ReplayEdits;
    expect(normalizeEdits(a).cuts.map((cut) => cut.id)).toEqual(['a', 'b']);
    expect(normalizeEdits(a).cuts[1]!.from).toBe(600);
    expect(sameEdits(a, b)).toBe(true);
    expect(editsVersion(a)).toBe(editsVersion(b));
    expect(editsVersion(a)).toMatch(/^[a-z0-9]{1,16}$/);
    expect(editsVersion(edits({ cuts: [{ id: 'a', from: 100, to: 301 }] }))).not.toBe(editsVersion(a));
    expect(editsVersion(edits())).toBe('');
    expect(isEmptyEdits(edits())).toBe(true);
    expect(isEmptyEdits(a)).toBe(false);
    const marked = edits({ highlights: [{ id: 'p', kind: 'point', at: 250.4, label: '  Start  ' }] });
    expect(normalizeEdits(marked).highlights).toEqual([{ id: 'p', kind: 'point', at: 250, label: 'Start' }]);
    expect(isEmptyEdits(marked)).toBe(false);
    expect(editsVersion(marked)).not.toBe(editsVersion(edits()));
  });
});

describe('editTimeline', () => {
  it('is the identity without edits', () => {
    const timeline = editTimeline(undefined, 1000);
    expect(timeline.duration).toBe(1000);
    expect(timeline.toEdited(420)).toBe(420);
    expect(timeline.toOriginal(420)).toBe(420);
    expect(timeline.isRemoved(999)).toBe(false);
  });

  it('maps original to edited time through trims and cuts, both ways', () => {
    // Keep 1000–9000, minus 3000–5000: 6 s remain.
    const timeline = editTimeline(edits({ trim: { start: 1000, end: 9000 }, cuts: [{ id: 'c', from: 3000, to: 5000 }] }), 10_000);
    expect(timeline.duration).toBe(6000);
    expect(timeline.removed).toEqual([
      { from: 0, to: 1000 },
      { from: 3000, to: 5000 },
      { from: 9000, to: 10_000 },
    ]);
    expect(timeline.toEdited(0)).toBe(0);
    expect(timeline.toEdited(1000)).toBe(0);
    expect(timeline.toEdited(2500)).toBe(1500);
    // Everything inside the cut lands on the cut point.
    expect(timeline.toEdited(3000)).toBe(2000);
    expect(timeline.toEdited(4200)).toBe(2000);
    expect(timeline.toEdited(5000)).toBe(2000);
    expect(timeline.toEdited(6000)).toBe(3000);
    expect(timeline.toEdited(9500)).toBe(6000);
    // The cut point resumes after the cut.
    expect(timeline.toOriginal(0)).toBe(1000);
    expect(timeline.toOriginal(1999)).toBe(2999);
    expect(timeline.toOriginal(2000)).toBe(5000);
    expect(timeline.toOriginal(6000)).toBe(9000);
    expect(timeline.isRemoved(500)).toBe(true);
    expect(timeline.isRemoved(1000)).toBe(false);
    expect(timeline.isRemoved(3500)).toBe(true);
    expect(timeline.isRemoved(5000)).toBe(false);
    expect(timeline.isRemoved(9000)).toBe(true);
    for (const at of [1000, 1800, 2999, 5000, 7777, 8999]) expect(timeline.toOriginal(timeline.toEdited(at))).toBeCloseTo(at, 6);
  });

  it('merges overlapping cuts', () => {
    const timeline = editTimeline(
      edits({
        cuts: [
          { id: 'a', from: 100, to: 400 },
          { id: 'b', from: 300, to: 600 },
          { id: 'c', from: 600, to: 700 },
        ],
      }),
      1000,
    );
    expect(timeline.removed).toEqual([{ from: 100, to: 700 }]);
    expect(timeline.duration).toBe(400);
  });
});

describe('highlight export boundary', () => {
  it('keeps navigation annotations out of the playback effects bundle used by video rendering', () => {
    const source = bundle();
    const applied = applyEdits(source, edits({ highlights: [{ id: 'mark', kind: 'point', at: 500, label: 'Only in the viewer' }] }));
    expect(applied.bundle).toBe(source);
    expect(applied.effects).toEqual({ zooms: [], blurs: [], captions: [] });
  });
});

function bundle(): ReplayBundle {
  const start = 1_000_000;
  return {
    meta: {
      id: 'edit-me',
      title: 'Edit me',
      url: 'https://example.com/',
      capturedAt: '2026-10-06T00:00:00.000Z',
      duration: 10_000,
      viewport: { width: 1280, height: 800 },
      eventCount: 6,
      version: 1,
    },
    events: [
      { type: 4, timestamp: start, data: {} },
      { type: 2, timestamp: start + 10, data: {} },
      { type: 3, timestamp: start + 2000, data: { source: 1, positions: [{ x: 1, y: 1, id: 1, timeOffset: -500 }] } },
      { type: 3, timestamp: start + 4000, data: { source: 0 } },
      { type: 3, timestamp: start + 6000, data: { source: 2, type: 2, x: 10, y: 20 } },
      { type: 3, timestamp: start + 9500, data: { source: 0 } },
      { type: 3, timestamp: start + 10_000, data: { source: 0 } },
    ],
    steps: [
      { at: 0, kind: 'open', label: 'Open' },
      { at: 2600, kind: 'wait', label: 'Wait for the list' },
      { at: 3600, kind: 'click', label: 'Inside the cut, followed by another' },
      { at: 4500, kind: 'type', label: 'Starts in the cut, runs past it' },
      { at: 6000, kind: 'click', label: 'Click' },
      { at: 9500, kind: 'wait', label: 'After the end' },
    ],
    console: [
      { at: 500, level: 'log', message: 'trimmed off' },
      { at: 3500, level: 'error', message: 'cut' },
      { at: 6000, level: 'warn', message: 'kept' },
    ],
    network: [
      {
        id: 'r1',
        at: 2500,
        duration: 3000,
        method: 'GET',
        url: 'https://example.com/a',
        status: 200,
        statusText: 'OK',
        requestHeaders: [],
        responseHeaders: [],
      },
      {
        id: 'r2',
        at: 4000,
        duration: 100,
        method: 'GET',
        url: 'https://example.com/b',
        status: 500,
        statusText: 'x',
        requestHeaders: [],
        responseHeaders: [],
      },
    ],
    performance: {
      supported: ['longtask'],
      entries: [
        { at: 3100, kind: 'long-task', value: 80 },
        { at: 7000, kind: 'long-task', value: 60 },
      ],
    },
  };
}

describe('applyEdits', () => {
  const list = edits({ trim: { start: 1000, end: 9000 }, cuts: [{ id: 'c', from: 3000, to: 5000 }] });

  it('returns the bundle untouched without edits', () => {
    const original = bundle();
    expect(applyEdits(original, edits()).bundle).toBe(original);
  });

  it('moves every track onto the edited timeline and drops what was removed', () => {
    const original = bundle();
    const snapshot = JSON.stringify(original);
    const { bundle: edited, timeline, stepIndices } = applyEdits(original, list);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(() => assertReplayBundle(edited)).not.toThrow();
    expect(edited.meta.duration).toBe(6000);
    const first = edited.events[0]!.timestamp;
    const times = edited.events.map((event) => event.timestamp - first);
    // Trimmed-off start collapses to 0, the cut collapses to 2000; nothing after the end; an end marker at 6000.
    expect(times).toEqual([0, 0, 1000, 2000, 3000, 6000]);
    expect(edited.events.at(-1)).toMatchObject({ type: 5, data: { tag: EDIT_END_TAG } });
    // The mouse move's trail is remapped too.
    expect((edited.events[2]!.data as { positions: Array<{ timeOffset: number }> }).positions[0]!.timeOffset).toBe(-500);
    expect(timeline.duration).toBe(6000);
    // Steps: "Open" carries on at 0; the wait before the cut stays; the one wholly inside the cut goes; the one
    // that starts inside but runs past it moves to the cut point; the step after the end goes.
    expect(edited.steps.map((step) => [step.label, step.at])).toEqual([
      ['Open', 0],
      ['Wait for the list', 1600],
      ['Starts in the cut, runs past it', 2000],
      ['Click', 3000],
    ]);
    expect(stepIndices).toEqual([0, 1, 3, 4]);
    expect(edited.console.map((entry) => [entry.message, entry.at])).toEqual([['kept', 3000]]);
    // A request spanning the cut keeps its start and loses the cut time; one inside the cut is gone.
    expect(edited.network.map((entry) => [entry.id, entry.at, entry.duration])).toEqual([['r1', 1500, 1000]]);
    expect(edited.performance!.entries.map((entry) => entry.at)).toEqual([4000]);
  });

  it('keeps the step order stable for steps logged at the same moment', () => {
    const timeline = editTimeline(edits(), 1000);
    const steps = [
      { at: 100, kind: 'click', label: 'a' },
      { at: 100, kind: 'click', label: 'b' },
    ];
    expect(editSteps(steps, timeline).steps.map((step) => step.label)).toEqual(['a', 'b']);
  });
});

describe('proposeWaitCuts', () => {
  it('cuts each wait between pads, skipping short ones and covered ones', () => {
    const steps = [
      { at: 0, kind: 'open', label: 'Open' },
      { at: 1000, kind: 'wait', label: 'Wait for the list' },
      { at: 4000, kind: 'click', label: 'Click' },
      { at: 5000, kind: 'wait', label: 'Short wait' },
      { at: 6000, kind: 'click', label: 'Click again' },
      { at: 7000, kind: 'wait', label: 'Trailing wait' },
    ];
    expect(proposeWaitCuts(steps, 10_000)).toEqual([
      { id: 'wait-1', from: 1400, to: 3600, label: 'Wait for the list' },
      { id: 'wait-5', from: 7400, to: 9600, label: 'Trailing wait' },
    ]);
    expect(proposeWaitCuts(steps, 10_000, [{ from: 1000, to: 4000 }]).map((cut) => cut.id)).toEqual(['wait-5']);
  });
});
