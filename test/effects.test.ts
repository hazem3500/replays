import { describe, expect, it } from 'vitest';

import {
  blurRect,
  blursAt,
  clicksOf,
  editCaptionAt,
  effectsKey,
  playbackEffects,
  proposeStepCaptions,
  proposeZoomRegions,
  ZOOM_IN_MS,
  zoomAt,
  zoomTransform,
} from '../src/shared/effects.ts';
import {
  applyEdits,
  assertReplayEdits,
  editsVersion,
  editTimeline,
  isEmptyEdits,
  normalizeEdits,
  type ReplayEdits,
} from '../src/shared/edits.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { addEffect, effectList, moveEffect, removeEffect, updateEffect } from '../src/client/editor/state.ts';

const edits = (patch: Partial<ReplayEdits> = {}): ReplayEdits => ({ version: 1, cuts: [], ...patch });
const viewport = { width: 1000, height: 500 };

/** rrweb events: a meta event, two clicks, and an end at 10 s. */
function events() {
  return [
    { type: 4, timestamp: 1000, data: { width: 1000, height: 500 } },
    { type: 3, timestamp: 3000, data: { source: 2, type: 2, x: 100, y: 50 } },
    { type: 3, timestamp: 4000, data: { source: 2, type: 2, x: 900, y: 450 } },
    { type: 3, timestamp: 11_000, data: { source: 1, positions: [] } },
  ];
}

function bundle(): ReplayBundle {
  return {
    meta: { id: 'fx', title: 'Effects', duration: 10_000, viewport, eventCount: 4 },
    events: events(),
    steps: [
      { at: 0, kind: 'open', label: 'Open' },
      { at: 2000, kind: 'click', label: 'Click A' },
      { at: 3000, kind: 'click', label: 'Click B' },
    ],
    console: [],
    network: [],
  } as unknown as ReplayBundle;
}

describe('effect lists in the edit schema', () => {
  it('accepts zooms, speed-ups, blur boxes and captions inside the replay', () => {
    const list = edits({
      zooms: [{ id: 'zoom-1', from: 1000, to: 3000, scale: 1.8 }],
      speeds: [{ id: 'speed-1', from: 4000, to: 6000, rate: 4 }],
      blurs: [{ id: 'blur-1', from: 0, to: 2000, x: 0.1, y: 0.1, width: 0.5, height: 0.2 }],
      captions: [{ id: 'caption-1', from: 0, to: 1500, text: 'Hello' }],
    });
    expect(() => assertReplayEdits(list, 10_000)).not.toThrow();
    expect(isEmptyEdits(list)).toBe(false);
    expect(isEmptyEdits(edits({ blurs: [] }))).toBe(true);
  });

  it('names what it rejects', () => {
    expect(() => assertReplayEdits(edits({ zooms: [{ id: 'z', from: 0, to: 1000, scale: 9 }] }))).toThrow('edits.zooms[0].scale');
    expect(() => assertReplayEdits(edits({ speeds: [{ id: 's', from: 0, to: 1000, rate: 17 }] }))).toThrow('edits.speeds[0].rate');
    expect(() => assertReplayEdits(edits({ speeds: [{ id: 's', from: 0, to: 1000, rate: 0.5 }] }))).toThrow('edits.speeds[0].rate');
    expect(() => assertReplayEdits(edits({ speeds: [{ id: 's', from: 0, to: 1000, rate: '2' as unknown as number }] }))).toThrow('edits.speeds[0].rate');
    for (const rate of [1, 2.5, 3.75, 6.5, 11, 16])
      expect(() => assertReplayEdits(edits({ speeds: [{ id: 's', from: 0, to: 1000, rate }] }))).not.toThrow();
    expect(() =>
      assertReplayEdits(
        edits({
          speeds: [
            { id: 'a', from: 0, to: 2000, rate: 2 },
            { id: 'b', from: 1000, to: 3000, rate: 4 },
          ],
        }),
      ),
    ).toThrow('must not overlap');
    expect(() => assertReplayEdits(edits({ blurs: [{ id: 'b', from: 0, to: 1000, x: 0.8, y: 0, width: 0.5, height: 0.2 }] }))).toThrow(
      'inside the frame',
    );
    expect(() => assertReplayEdits(edits({ captions: [{ id: 'c', from: 0, to: 1000, text: ' ' }] }))).toThrow('edits.captions[0].text');
    expect(() =>
      assertReplayEdits(edits({ blurs: [{ id: 'b', from: 0, to: 20_000, x: 0, y: 0, width: 0.5, height: 0.2 }] }), 10_000),
    ).toThrow('after the end');
  });

  it('saves a redaction style, keeps a plain blur as before and refuses unknown styles', () => {
    const blur = { id: 'b', from: 0, to: 1000, x: 0.1, y: 0.1, width: 0.3, height: 0.2 };
    expect(normalizeEdits(edits({ blurs: [{ ...blur, style: 'redact' }] })).blurs?.[0]?.style).toBe('redact');
    expect(normalizeEdits(edits({ blurs: [{ ...blur, style: 'blur' }] })).blurs?.[0]).not.toHaveProperty('style');
    expect(editsVersion(edits({ blurs: [{ ...blur, style: 'blur' }] }))).toBe(editsVersion(edits({ blurs: [blur] })));
    expect(() => assertReplayEdits(edits({ blurs: [{ ...blur, style: 'pixelate' as 'blur' }] }))).toThrow('edits.blurs[0].style');
  });

  it('versions effects with the rest, so a changed blur never reuses a cached video', () => {
    const blur = { id: 'blur-1', from: 0, to: 2000, x: 0.1, y: 0.1, width: 0.5, height: 0.2 };
    const base = editsVersion(edits({ blurs: [blur] }));
    expect(base).not.toBe('');
    expect(editsVersion(edits({ blurs: [{ ...blur, x: 0.2 }] }))).not.toBe(base);
    expect(editsVersion(edits({ blurs: [blur], captions: [] }))).toBe(base);
    // Normalized: whole ms, fractions to 4 places, empty lists dropped.
    expect(normalizeEdits(edits({ blurs: [{ ...blur, from: 0.4, x: 0.123456 }], zooms: [] }))).toEqual({
      version: 1,
      cuts: [],
      blurs: [{ ...blur, from: 0, x: 0.1235 }],
    });
  });
});

describe('speed-ups on the edit timeline', () => {
  it('plays a range n× faster, both ways, and cuts win over speed-ups', () => {
    const timeline = editTimeline(edits({ speeds: [{ id: 's', from: 2000, to: 6000, rate: 4 }] }), 10_000);
    expect(timeline.duration).toBe(7000);
    expect(timeline.toEdited(2000)).toBe(2000);
    expect(timeline.toEdited(4000)).toBe(2500);
    expect(timeline.toEdited(8000)).toBe(5000);
    expect(timeline.toOriginal(2500)).toBe(4000);
    const cut = editTimeline(
      edits({ cuts: [{ id: 'c', from: 3000, to: 5000 }], speeds: [{ id: 's', from: 2000, to: 6000, rate: 2 }] }),
      10_000,
    );
    // 2000–3000 and 5000–6000 at 2× (1 s), the cut gone, the rest at 1× (6 s).
    expect(cut.duration).toBe(7000);
  });

  it('moves events onto the sped-up timeline', () => {
    const edited = applyEdits(bundle(), edits({ speeds: [{ id: 's', from: 0, to: 4000, rate: 2 }] }));
    expect(edited.bundle.meta.duration).toBe(8000);
    expect(edited.bundle.events.map((event) => event.timestamp - 1000)).toEqual([0, 1000, 1500, 8000]);
  });
});

describe('zoom', () => {
  const zoom = {
    from: 1000,
    to: 5000,
    scale: 2,
    x: 0.5,
    y: 0.5,
    clicks: [
      { at: 2000, x: 100, y: 50 },
      { at: 3000, x: 900, y: 450 },
    ],
  };

  it('eases in at the start of a region, follows its clicks, and is 1× outside', () => {
    expect(zoomAt([zoom], 500, viewport).scale).toBe(1);
    expect(zoomAt([zoom], 1000 + ZOOM_IN_MS / 2, viewport).scale).toBeCloseTo(1.5);
    expect(zoomAt([zoom], 2000, viewport)).toEqual({ scale: 2, x: 100, y: 50 });
    // Panning to the next click just before it lands.
    const panning = zoomAt([zoom], 2800, viewport);
    expect(panning.x).toBeGreaterThan(100);
    expect(panning.x).toBeLessThan(900);
    expect(zoomAt([zoom], 3500, viewport)).toEqual({ scale: 2, x: 900, y: 450 });
    expect(zoomAt([zoom], 5000, viewport).scale).toBe(1);
  });

  it('holds on its point without clicks, and never shows an empty edge', () => {
    expect(zoomAt([{ ...zoom, clicks: [], x: 0.25, y: 0.5 }], 3000, viewport)).toEqual({ scale: 2, x: 250, y: 250 });
    expect(zoomTransform({ scale: 2, x: 500, y: 250 }, viewport)).toEqual({ scale: 2, x: -500, y: -250 });
    // A corner anchor is clamped so the frame stays filled.
    expect(zoomTransform({ scale: 2, x: 0, y: 0 }, viewport)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(zoomTransform({ scale: 2, x: 1000, y: 500 }, viewport)).toEqual({ scale: 2, x: -1000, y: -500 });
    expect(zoomTransform({ scale: 1, x: 400, y: 100 }, viewport)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('proposes one region per run of clicks', () => {
    const clicks = clicksOf(events());
    expect(clicks).toEqual([
      { at: 2000, x: 100, y: 50 },
      { at: 3000, x: 900, y: 450 },
    ]);
    expect(proposeZoomRegions(clicks, 10_000)).toEqual([{ id: 'zoom-1', from: 1300, to: 4500, scale: 1.8 }]);
    expect(proposeZoomRegions(clicks, 10_000, [{ from: 0, to: 2500 }])).toEqual([]);
  });
});

describe('blur boxes and captions', () => {
  it('places a blur box through the zoom and clips it to the frame', () => {
    const blur = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    expect(blurRect(blur, { scale: 1, x: 0, y: 0 }, viewport)).toEqual({ left: 100, top: 50, width: 200, height: 100 });
    expect(blurRect(blur, { scale: 2, x: -300, y: -50 }, viewport)).toEqual({ left: 0, top: 50, width: 300, height: 200 });
    expect(blurRect(blur, { scale: 2, x: -1000, y: 0 }, viewport)).toBeUndefined();
  });

  it('maps blurs and captions to the edited timeline, and keys the frames that change', () => {
    const list = edits({
      cuts: [{ id: 'c', from: 0, to: 1000 }],
      blurs: [{ id: 'b', from: 2000, to: 4000, x: 0, y: 0, width: 0.5, height: 0.5 }],
      captions: [{ id: 'k', from: 1500, to: 3000, text: 'Look here' }],
      zooms: [{ id: 'z', from: 1500, to: 5000, scale: 2 }],
    });
    const { effects } = applyEdits(bundle(), list);
    expect(effects.blurs).toEqual([{ from: 1000, to: 3000, x: 0, y: 0, width: 0.5, height: 0.5 }]);
    expect(effects.captions).toEqual([{ from: 500, to: 2000, text: 'Look here' }]);
    expect(effects.zooms[0]!.clicks.map((click) => click.at)).toEqual([1000, 2000]);
    expect(blursAt(effects.blurs, 1500)).toEqual([0]);
    expect(editCaptionAt(effects.captions, 600)).toMatchObject({ label: 'Look here', enteredMs: 100 });
    expect(editCaptionAt(effects.captions, 2500)).toBeUndefined();
    expect(effectsKey(effects, viewport, 200)).not.toBe(effectsKey(effects, viewport, 1500));
    // Effects alone keep the bundle as is (same timeline), effects on it.
    const only = applyEdits(bundle(), edits({ captions: [{ id: 'k', from: 0, to: 1000, text: 'Hi' }] }));
    expect(only.bundle.events).toEqual(bundle().events);
    expect(only.effects.captions).toHaveLength(1);
    expect(playbackEffects(undefined, editTimeline(undefined, 10), [])).toEqual({ zooms: [], blurs: [], captions: [] });
  });

  it('proposes captions from step names', () => {
    expect(proposeStepCaptions(bundle().steps, 10_000)).toEqual([
      { id: 'caption-1', from: 0, to: 2000, text: 'Open' },
      { id: 'caption-2', from: 2000, to: 3000, text: 'Click A' },
      { id: 'caption-3', from: 3000, to: 8000, text: 'Click B' },
    ]);
  });

  it("keeps a step's caption up through a wait named only as a wait, which gets none of its own", () => {
    const steps = [
      { at: 0, kind: 'click', label: 'Add the tea' },
      { at: 400, kind: 'wait', label: 'Wait for the page' },
      { at: 1200, kind: 'wait', label: 'Look at the cart' },
    ];
    expect(proposeStepCaptions(steps, 2000).map(({ from, to, text }) => [text, from, to])).toEqual([
      ['Add the tea', 0, 1200],
      ['Look at the cart', 1200, 2000],
    ]);
  });
});

describe('editor effect operations', () => {
  it('adds, moves, changes and removes regions on a lane', () => {
    const added = addEffect(edits(), 'zoom', 1000, 3000, 10_000)!;
    expect(added.id).toBe('zoom-1');
    expect(effectList(added.edits, 'zoom')).toEqual([{ id: 'zoom-1', from: 1000, to: 3000, scale: 1.8 }]);
    const moved = moveEffect(added.edits, 'zoom', 'zoom-1', 'move', 9000, 10_000);
    expect(effectList(moved, 'zoom')[0]).toMatchObject({ from: 8000, to: 10_000 });
    const scaled = updateEffect(moved, 'zoom', 'zoom-1', { scale: 2.2 });
    expect(effectList(scaled, 'zoom')[0]).toMatchObject({ scale: 2.2 });
    expect(removeEffect(scaled, 'zoom', 'zoom-1')).toEqual(edits());
  });

  it('keeps speed-ups from overlapping', () => {
    const first = addEffect(edits(), 'speed', 2000, 4000, 10_000)!;
    expect(addEffect(first.edits, 'speed', 3000, 5000, 10_000)).toBeUndefined();
    const second = addEffect(first.edits, 'speed', 5000, 1000, 10_000)!;
    // Dragged leftwards over the first: clamped to the free stretch after it.
    expect(effectList(second.edits, 'speed')[1]).toMatchObject({ from: 1000, to: 2000 });
    const blocked = moveEffect(second.edits, 'speed', 'speed-1', 'from', 0, 10_000);
    expect(effectList(blocked, 'speed')[0]).toMatchObject({ from: 2000 });
  });
});
