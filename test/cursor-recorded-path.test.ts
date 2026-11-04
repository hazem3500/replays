import { describe, expect, it } from 'vitest';

import {
  buildCursorTrack,
  CLICK_FX_MS,
  cursorInput,
  cursorPose,
  IDLE_FADE_OUT_MS,
  IDLE_MS,
  type CursorInput,
  type CursorPoint,
  type CursorTrack,
} from '../src/client/cursor-motion.ts';
import { CURSOR_MOTION_STYLES, type CursorMotionStyle } from '../src/shared/cursor.ts';
import type { ReplaySource } from '../src/shared/replay.ts';

/** A hand-drawn sweep sampled every 50 ms, bending twice and speeding up and slowing down. */
const SWEEP: CursorPoint[] = [
  { t: 1000, x: 100, y: 100 },
  { t: 1050, x: 130, y: 140 },
  { t: 1100, x: 210, y: 150 },
  { t: 1150, x: 380, y: 250 },
  { t: 1200, x: 520, y: 240 },
  { t: 1250, x: 560, y: 330 },
  { t: 1300, x: 585, y: 345 },
];
/** A second sweep after a long still, so the first one rests for 3.7 s. */
const SECOND: CursorPoint[] = [
  { t: 5000, x: 600, y: 360 },
  { t: 5050, x: 640, y: 420 },
  { t: 5100, x: 700, y: 470 },
];
const HUMAN: CursorInput = { points: [...SWEEP, ...SECOND], presses: [1300] };

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from `p` to the segment `a`..`b`. */
function toSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const u = length === 0 ? 0 : Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0), 1);
  return distance(p, { x: a.x + dx * u, y: a.y + dy * u });
}

const toPolyline = (p: { x: number; y: number }, line: readonly CursorPoint[]) =>
  Math.min(...line.slice(1).map((b, i) => toSegment(p, line[i] ?? b, b)));

/** The most the cursor strays from the straight line over a move, in px. */
function bow(track: CursorTrack, from: CursorPoint, to: CursorPoint) {
  let widest = 0;
  for (let t = from.t; t <= to.t; t += 10) widest = Math.max(widest, toSegment(cursorPose(track, t), from, to));
  return widest;
}

function poseIn(input: CursorInput, source: ReplaySource, motion: CursorMotionStyle, t: number) {
  return cursorPose(buildCursorTrack(input, { source, settings: { motion } }), t);
}

/** The recorded position at `t`: a straight line between the two samples around it. */
function recordedAt(line: readonly CursorPoint[], t: number) {
  const index = line.findIndex((p) => p.t >= t);
  const after = line[index];
  const before = line[index - 1];
  if (!after || !before) throw new Error(`${t} ms is outside the recorded sweep`);
  const f = (t - before.t) / (after.t - before.t);
  return { x: before.x + (after.x - before.x) * f, y: before.y + (after.y - before.y) * f };
}

describe('a human recording', () => {
  const track = buildCursorTrack(HUMAN, { source: 'human' });

  it('rides the recorded polyline through a sweep, within a pixel', () => {
    for (let t = 1000; t <= 1300; t += 7) {
      const at = cursorPose(track, t);
      expect(toPolyline(at, SWEEP), `at ${t} ms the cursor was at (${at.x.toFixed(1)}, ${at.y.toFixed(1)})`).toBeLessThan(1);
    }
  });

  it('is where the pointer was at every moment, interpolating by the samples timestamps', () => {
    for (let t = 1001; t < 1300; t += 11) {
      const at = cursorPose(track, t);
      expect(distance(at, recordedAt(SWEEP, t)), `at ${t} ms`).toBeLessThan(1);
    }
  });

  it('is exactly on every recorded sample at its timestamp', () => {
    for (const sample of [...SWEEP, ...SECOND].filter((p) => p.t > 1000)) {
      expect(distance(cursorPose(track, sample.t), sample), `at ${sample.t} ms`).toBeLessThan(1e-6);
    }
  });

  it('keeps the arrow upright and unscaled while it moves', () => {
    const at = cursorPose(track, 1120);
    expect(at.heading).toBeCloseTo(Math.PI / 4);
    expect(at.scale).toBe(1);
    expect(at.opacity).toBe(1);
  });

  it('holds still through a long rest, then follows the line into the next sample', () => {
    for (const t of [1400, 3000, 4800]) expect(distance(cursorPose(track, t), SWEEP[6] as CursorPoint), `at ${t} ms`).toBeLessThan(1e-6);
    const arriving = cursorPose(track, 4975);
    expect(toSegment(arriving, SWEEP[6] as CursorPoint, SECOND[0] as CursorPoint)).toBeLessThan(1);
    expect(distance(arriving, SWEEP[6] as CursorPoint)).toBeGreaterThan(1);
  });

  it('gives the same pose playing forward as seeking straight there', () => {
    const times = Array.from({ length: 60 }, (_, i) => 900 + i * 90);
    const forward = times.map((t) => ({ ...cursorPose(track, t) }));
    const seeking = times.toReversed().map((t) => ({ ...cursorPose(buildCursorTrack(HUMAN, { source: 'human' }), t) }));
    expect(seeking.toReversed()).toEqual(forward);
  });

  it('keeps the click squish at the press and the idle fade through the rest', () => {
    const pressed = cursorPose(track, 1300 + 60);
    expect(pressed.scale).toBeLessThan(1);
    expect(pressed.press).toBe(60);
    expect(cursorPose(track, 1300 + CLICK_FX_MS + 200).press).toBe(-1);
    expect(cursorPose(track, 1300 + CLICK_FX_MS + 200).opacity).toBe(1);
    expect(cursorPose(track, 1300 + CLICK_FX_MS + IDLE_MS + IDLE_FADE_OUT_MS + 100).opacity).toBe(0);
    expect(cursorPose(track, 4960).opacity).toBe(1);
  });

  it('ignores the motion style, which only shapes an arc it no longer draws', () => {
    const base = poseIn(HUMAN, 'human', 'signature_arc', 1170);
    for (const motion of CURSOR_MOTION_STYLES) expect(poseIn(HUMAN, 'human', motion, 1170), `${motion}`).toEqual(base);
  });

  it('keeps the theme settings that are not the path', () => {
    const settings = { appearance: 'ring', clickEffect: 'ripple', size: 1.5, clickFeedback: true } as const;
    const themed = buildCursorTrack(HUMAN, { source: 'human', settings });
    expect(cursorPose(themed, 1300 + 60).press).toBe(60);
    expect(cursorPose(themed, 1170)).toEqual(cursorPose(track, 1170));
  });

  it('stays inside the recorded viewport', () => {
    const edge = buildCursorTrack(
      {
        points: [
          { t: 0, x: 500, y: 500 },
          { t: 50, x: 2000, y: -80 },
        ],
        presses: [],
        viewport: { width: 1280, height: 800 },
      },
      { source: 'human' },
    );
    const at = cursorPose(edge, 50);
    expect([at.x, at.y]).toEqual([1279, 0]);
  });

  it('keeps a sweep that starts near the top left corner, as the person made it', () => {
    const corner = buildCursorTrack(
      {
        points: [
          { t: 0, x: 10, y: 10 },
          { t: 50, x: 200, y: 10 },
          { t: 100, x: 400, y: 10 },
        ],
        presses: [],
      },
      { source: 'human' },
    );
    expect(cursorPose(corner, 0).x).toBe(10);
    expect(cursorPose(corner, 25).x).toBeCloseTo(105);
  });
});

describe('an agent recording', () => {
  /** The agent's pointer jumps: one landing sample per move, seconds apart. */
  const JUMPS: CursorInput = {
    points: [
      { t: 0, x: 100, y: 100 },
      { t: 2000, x: 700, y: 400 },
      { t: 4000, x: 200, y: 600 },
    ],
    presses: [],
  };

  it('keeps gliding on its own arc between jumps', () => {
    const track = buildCursorTrack(JUMPS, { source: 'agent' });
    expect(bow(track, { t: 0, x: 100, y: 100 }, { t: 2000, x: 700, y: 400 })).toBeGreaterThan(10);
    expect(cursorPose(track, 1000)).toMatchObject({ x: 100, y: 100 });
    expect(distance(cursorPose(track, 2000), { x: 700, y: 400 })).toBeLessThan(1);
  });

  it('keeps the arc for a dense sweep too, because the source says agent', () => {
    const track = buildCursorTrack(HUMAN, { source: 'agent' });
    let widest = 0;
    for (let t = 1000; t <= 1300; t += 5) widest = Math.max(widest, toPolyline(cursorPose(track, t), SWEEP));
    expect(widest).toBeGreaterThan(1);
  });

  it('still lets the motion style shape its path', () => {
    expect(distance(poseIn(JUMPS, 'agent', 'signature_arc', 1700), poseIn(JUMPS, 'agent', 'classic', 1700))).toBeGreaterThan(1);
  });
});

describe('a recording that does not say who made it', () => {
  /** A person's pointer: a sample every 50 ms for several seconds, drifting along a curve. */
  const dense = Array.from({ length: 120 }, (_, i) => ({ t: i * 50, x: 100 + i * 8, y: 300 + Math.sin(i / 6) * 90 }));

  it('follows the exact path when the pointer is sampled densely, like a hand', () => {
    const track = buildCursorTrack({ points: dense, presses: [] });
    for (let t = 25; t < 5900; t += 37) {
      expect(toPolyline(cursorPose(track, t), dense), `at ${t} ms`).toBeLessThan(1);
    }
  });

  it('glides when there are only sparse jumps, like an agent', () => {
    const sparse = dense.filter((_, i) => i % 40 === 0);
    const track = buildCursorTrack({ points: sparse, presses: [] });
    let widest = 0;
    for (let t = 0; t < 5900; t += 10) widest = Math.max(widest, toPolyline(cursorPose(track, t), sparse));
    expect(widest).toBeGreaterThan(5);
  });

  it('glides when a handful of dense samples is all there is, like one agent sweep', () => {
    const track = buildCursorTrack({ points: dense.slice(0, 12), presses: [] });
    let widest = 0;
    for (let t = 0; t < 600; t += 5) widest = Math.max(widest, toPolyline(cursorPose(track, t), dense.slice(0, 12)));
    expect(widest).toBeGreaterThan(1);
  });

  it('reads the recorder source from the bundle events the same way', () => {
    const events = [
      { timestamp: 0, type: 4, data: { width: 1280, height: 800 } },
      ...SWEEP.slice(1).map((p) => ({
        timestamp: p.t,
        type: 3,
        data: { source: 1, positions: [{ x: p.x, y: p.y, id: 1, timeOffset: 0 }] },
      })),
    ];
    const track = buildCursorTrack(cursorInput(events), { source: 'human' });
    expect(toPolyline(cursorPose(track, 1125), SWEEP.slice(1))).toBeLessThan(1);
  });
});
