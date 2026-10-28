import { describe, expect, it } from 'vitest';

import {
  buildCursorTrack,
  CLICK_FX_MS,
  cursorInput,
  cursorPose,
  cursorTargets,
  IDLE_FADE_IN_MS,
  IDLE_FADE_OUT_MS,
  IDLE_MS,
  onPage,
  planMove,
  REST_HEADING,
  sampleTrajectory,
  squish,
} from '../src/client/cursor-motion.ts';
import { moveDurationMs } from '../src/client/cursor-styles.ts';

/** Mouse events from the suite-run-timer sample (timestamps relative to the first event), up to 6.1 s. */
const SUITE_RUN_TIMER = [
  { timestamp: 0, type: 4, data: {} },
  { timestamp: 11, type: 2, data: {} },
  { timestamp: 3718, type: 3, data: { source: 1, positions: [{ x: 9, y: -1, id: 13, timeOffset: 0 }] } },
  {
    timestamp: 4219,
    type: 3,
    data: {
      source: 1,
      positions: [
        { x: 26, y: 9, id: 13, timeOffset: -450 },
        { x: 49, y: 26, id: 14, timeOffset: -400 },
        { x: 88, y: 60, id: 12, timeOffset: -334 },
        { x: 121, y: 91, id: 12, timeOffset: -284 },
        { x: 156, y: 126, id: 12, timeOffset: -234 },
        { x: 192, y: 164, id: 12, timeOffset: -184 },
        { x: 228, y: 203, id: 12, timeOffset: -134 },
        { x: 262, y: 242, id: 12, timeOffset: -83 },
        { x: 304, y: 292, id: 12, timeOffset: -17 },
      ],
    },
  },
  { timestamp: 4468, type: 3, data: { source: 2, type: 1, id: 39, x: 375.9921875, y: 408.6875 } },
  { timestamp: 4469, type: 3, data: { source: 2, type: 0, id: 39, x: 375.9921875, y: 408.6875 } },
  { timestamp: 4469, type: 3, data: { source: 2, type: 2, id: 39, x: 375, y: 408, pointerType: 0 } },
  // Full snapshot: the page navigates; the cursor must not reset.
  { timestamp: 4502, type: 2, data: {} },
  { timestamp: 5434, type: 3, data: { source: 1, positions: [{ x: 376, y: 410, id: 23, timeOffset: 0 }] } },
  { timestamp: 5552, type: 3, data: { source: 2, type: 1, id: 40, x: 371.1875, y: 440.6875 } },
  { timestamp: 5553, type: 3, data: { source: 2, type: 0, id: 40, x: 371.1875, y: 440.6875 } },
  { timestamp: 5553, type: 3, data: { source: 2, type: 2, id: 40, x: 371, y: 440, pointerType: 0 } },
  {
    timestamp: 5935,
    type: 3,
    data: {
      source: 1,
      positions: [
        { x: 375, y: 428, id: 40, timeOffset: -450 },
        { x: 371, y: 440, id: 40, timeOffset: -384 },
      ],
    },
  },
];

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const pose = () => ({ visible: false, x: 0, y: 0, heading: 0, scale: 1, opacity: 1 });

describe('Cua motion model', () => {
  it('starts and lands exactly on the endpoints', () => {
    for (const reduced of [false, true]) {
      const traj = planMove({ x: 10, y: 20 }, { x: 610, y: 320 }, { reducedMotion: reduced });
      const start = sampleTrajectory(traj, 0, pose());
      const end = sampleTrajectory(traj, traj.durationMs, pose());
      expect([start.x, start.y]).toEqual([10, 20]);
      expect([end.x, end.y]).toEqual([610, 320]);
      expect(end.heading).toBe(REST_HEADING);
    }
  });

  it('progresses monotonically toward the target until the follow-through', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 800, y: 0 };
    const traj = planMove(from, to);
    let previous = 0;
    for (let ms = 0; ms <= traj.arrivalMs; ms += 4) {
      const p = sampleTrajectory(traj, ms, pose());
      expect(p.x).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = p.x;
    }
    // The follow-through passes the target by at most 8 pt, then returns.
    let furthest = 0;
    for (let ms = traj.arrivalMs; ms <= traj.durationMs; ms += 4) furthest = Math.max(furthest, sampleTrajectory(traj, ms, pose()).x);
    expect(furthest - to.x).toBeGreaterThan(0);
    expect(furthest - to.x).toBeLessThanOrEqual(8 + 1e-6);
  });

  it('arcs to the natural side (upward for a rightward move)', () => {
    const traj = planMove({ x: 0, y: 300 }, { x: 600, y: 300 });
    const mid = sampleTrajectory(traj, traj.arrivalMs / 2, pose());
    expect(mid.y).toBeLessThan(300);
  });

  it('takes Fitts time: longer for longer moves, clamped 330..1100 ms', () => {
    expect(moveDurationMs(0)).toBeCloseTo(330);
    expect(moveDurationMs(10_000)).toBeCloseTo(1100);
    expect(moveDurationMs(100)).toBeCloseTo((150 + 120 * Math.log2(100 / 24 + 1)) * 1.1);
    expect(moveDurationMs(400)).toBeGreaterThan(moveDurationMs(100));
    const short = planMove({ x: 0, y: 0 }, { x: 60, y: 0 });
    const long = planMove({ x: 0, y: 0 }, { x: 900, y: 0 });
    expect(long.arrivalMs).toBeGreaterThan(short.arrivalMs);
  });

  it('reduced motion is a short straight glide without rotation', () => {
    const traj = planMove({ x: 0, y: 0 }, { x: 600, y: 0 }, { reducedMotion: true });
    expect(traj.durationMs).toBeLessThanOrEqual(130);
    for (let ms = 0; ms <= traj.durationMs; ms += 5) {
      const p = sampleTrajectory(traj, ms, pose());
      expect(p.y).toBeCloseTo(0);
      expect(p.heading).toBe(REST_HEADING);
    }
  });

  it('squishes on press and springs back', () => {
    expect(squish(0)).toBe(0);
    expect(squish(60)).toBeCloseTo(0.12);
    expect(squish(400)).toBe(0);
    expect(squish(CLICK_FX_MS)).toBe(0);
  });
});

describe('replay cursor track', () => {
  const input = cursorInput(SUITE_RUN_TIMER);
  const track = buildCursorTrack(input);

  it('stamps batched move positions with timestamp + timeOffset', () => {
    const at = (t: number) => input.points.find((p) => p.t === t);
    expect(at(3769)).toMatchObject({ x: 26, y: 9 });
    expect(at(4202)).toMatchObject({ x: 304, y: 292 });
    expect(at(5485)).toMatchObject({ x: 375, y: 428 });
    expect(at(5551)).toMatchObject({ x: 371, y: 440 });
    expect(input.points.map((p) => p.t)).toEqual(input.points.map((p) => p.t).toSorted((a, b) => a - b));
    // One press per click: mouse down, not the paired up/click.
    expect(input.presses).toEqual([4468, 5552]);
  });

  it('reduces the stream to rests and clicks', () => {
    expect(cursorTargets(input.points).map((p) => [p.t, p.x, p.y])).toEqual([
      [3718, 9, -1],
      [4202, 304, 292],
      [4468, 375.9921875, 408.6875],
      [5552, 371.1875, 440.6875],
    ]);
  });

  it('rests at its first real destination from the start, skipping the origin drift', () => {
    // agent-browser's mouse starts at 0,0 and drifts to (9,-1) and (26,9) before the first click at (375.99, 408.69).
    for (const t of [0, 3718, 4219]) {
      const p = cursorPose(track, t);
      expect(p.visible).toBe(true);
      expect(p.x).toBeCloseTo(375.9921875, 6);
      expect(p.y).toBeCloseTo(408.6875, 6);
    }
  });

  it('keeps every point on the recorded page', () => {
    const kept = onPage(
      [
        { t: 0, x: 3, y: 2 },
        { t: 10, x: 500, y: -4 },
        { t: 20, x: 2000, y: 950 },
      ],
      { width: 1440, height: 900 },
    );
    // The opening sweep from the origin collapses onto where it ends; the rest is clamped.
    expect(kept).toEqual([{ t: 20, x: 1439, y: 899 }]);
    expect(
      onPage(
        [
          { t: 0, x: 500, y: -4 },
          { t: 900, x: 2000, y: 950 },
        ],
        { width: 1440, height: 900 },
      ),
    ).toEqual([
      { t: 0, x: 500, y: 0 },
      { t: 900, x: 1439, y: 899 },
    ]);
    expect(onPage([{ t: 0, x: 5, y: 5 }])).toEqual([{ t: 0, x: 5, y: 5 }]);
  });

  it('seeks to 6 s onto the latest pointer position (the second click)', () => {
    const p = cursorPose(track, 6000);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(371.1875, 6);
    expect(p.y).toBeCloseTo(440.6875, 6);
    expect(p.scale).toBe(1);
  });

  it('lands each click on its point at the recorded time and keeps it through the navigation', () => {
    const click = cursorPose(track, 4468);
    expect(distance(click, { x: 375.9921875, y: 408.6875 })).toBeLessThanOrEqual(1);
    // Still finishing the follow-through as the new document loads, then at rest on the click point.
    expect(distance(cursorPose(track, 4502), { x: 375.9921875, y: 408.6875 })).toBeLessThanOrEqual(8);
    for (const t of [4800, 5000, 5250]) expect(distance(cursorPose(track, t), { x: 375.9921875, y: 408.6875 })).toBeLessThan(1e-6);
    expect(distance(cursorPose(track, 5552), { x: 371.1875, y: 440.6875 })).toBeLessThanOrEqual(1);
  });

  it('presses with a scale-down at the click', () => {
    expect(cursorPose(track, 4468 + 60).scale).toBeCloseTo(0.88);
    expect(cursorPose(track, 4468 + 500).scale).toBe(1);
    expect(cursorPose(buildCursorTrack(input, { reducedMotion: true }), 4528).scale).toBe(1);
  });

  it('is a pure function of time: any seek order gives the same pose', () => {
    const times = Array.from({ length: 300 }, (_, i) => 3600 + i * 9.7);
    const forward = times.map((t) => ({ ...cursorPose(track, t) }));
    const fresh = buildCursorTrack(cursorInput(SUITE_RUN_TIMER));
    const shuffled = times
      .toReversed()
      .map((t) => ({ ...cursorPose(fresh, t) }))
      .toReversed();
    expect(shuffled).toEqual(forward);
  });

  it('moves continuously (no teleports) between targets', () => {
    let previous = cursorPose(track, 3718, pose());
    let last = { x: previous.x, y: previous.y };
    for (let t = 3720; t <= 6000; t += 2) {
      const p = cursorPose(track, t);
      // Fastest compressed move here covers ~140 pt in ~180 ms.
      expect(distance(p, last)).toBeLessThan(12);
      last = { x: p.x, y: p.y };
    }
  });
});

describe('cursorInput placeholder positions', () => {
  it('ignores a leading move to (0, 0), so the cursor does not wait in the top-left corner', () => {
    const events = [
      { type: 3, timestamp: 10, data: { source: 1, positions: [{ x: 0, y: 0, id: 1, timeOffset: 0 }] } },
      { type: 3, timestamp: 600, data: { source: 1, positions: [{ x: 25, y: 16, id: 1, timeOffset: 0 }] } },
      { type: 3, timestamp: 900, data: { source: 1, positions: [{ x: 0, y: 0, id: 1, timeOffset: 0 }] } },
    ];
    const input = cursorInput(events);
    expect(input.points.map((point) => [point.t, point.x, point.y])).toEqual([
      [600, 25, 16],
      // Later moves to the corner are real.
      [900, 0, 0],
    ]);
  });
});

const move = (t: number, x: number, y: number) => ({
  type: 3,
  timestamp: t,
  data: { source: 1, positions: [{ x, y, id: 1, timeOffset: 0 }] },
});
const down = (t: number, x: number, y: number) => ({ type: 3, timestamp: t, data: { source: 2, type: 1, id: 1, x, y } });

describe('idle fade', () => {
  // Rest at (100, 100), move to (600, 400) by 1000, click at 1000; long idle (typing); move to (200, 300) by 8000;
  // click 8800 (short gap); click 9600 (short gap); then nothing until the end.
  const events = [
    move(0, 100, 100),
    move(1000, 600, 400),
    down(1000, 600, 400),
    move(8000, 200, 300),
    down(8800, 200, 300),
    down(9600, 200, 300),
  ];
  const track = buildCursorTrack(cursorInput(events));
  const firstMove = track.moves[0] as (typeof track.moves)[number];
  const secondMove = track.moves[1] as (typeof track.moves)[number];
  const clickEnd = 1000 + CLICK_FX_MS;

  it('is hidden before the first move and fully there by the time it starts', () => {
    expect(cursorPose(track, firstMove.start - IDLE_FADE_IN_MS - 1).opacity).toBe(0);
    expect(cursorPose(track, firstMove.start - IDLE_FADE_IN_MS / 2).opacity).toBeGreaterThan(0);
    expect(cursorPose(track, firstMove.start).opacity).toBe(1);
  });

  it('is fully opaque while moving and through a click squish', () => {
    for (let t = firstMove.start; t <= clickEnd; t += 5) expect(cursorPose(track, t).opacity).toBe(1);
    for (let t = secondMove.start; t <= 9600 + CLICK_FX_MS; t += 5) expect(cursorPose(track, t).opacity).toBe(1);
    expect(cursorPose(track, 1000 + 60).scale).toBeCloseTo(0.88);
  });

  it('fades out and shrinks after IDLE_MS still, and is gone during a long gap', () => {
    const idleFrom = Math.max(clickEnd, firstMove.start + firstMove.traj.durationMs * firstMove.scale);
    expect(cursorPose(track, idleFrom + IDLE_MS).opacity).toBe(1);
    const mid = cursorPose(track, idleFrom + IDLE_MS + IDLE_FADE_OUT_MS / 2);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.scale).toBeLessThan(1);
    const gone = cursorPose(track, idleFrom + IDLE_MS + IDLE_FADE_OUT_MS);
    expect(gone.opacity).toBe(0);
    expect(gone.scale).toBeCloseTo(0.9);
    expect(gone.visible).toBe(true);
    // It still sits where it stopped, so the fade-in happens in place.
    expect(distance(gone, { x: 600, y: 400 })).toBeLessThan(1e-6);
    // Decays monotonically.
    let previous = 1;
    for (let t = idleFrom; t <= idleFrom + IDLE_MS + IDLE_FADE_OUT_MS; t += 10) {
      const opacity = cursorPose(track, t).opacity;
      expect(opacity).toBeLessThanOrEqual(previous);
      previous = opacity;
    }
  });

  it('is back to full before the next move starts, at the move start position', () => {
    expect(cursorPose(track, secondMove.start - IDLE_FADE_IN_MS - 1).opacity).toBe(0);
    const arriving = cursorPose(track, secondMove.start - IDLE_FADE_IN_MS / 2);
    expect(arriving.opacity).toBeGreaterThan(0.5);
    expect(distance(arriving, { x: 600, y: 400 })).toBeLessThan(1e-6);
    const ready = cursorPose(track, secondMove.start);
    expect(ready.opacity).toBe(1);
    expect(ready.scale).toBe(1);
  });

  it('never dips in a gap shorter than a full fade-out and fade-in', () => {
    // 8800 -> 9600: 800 ms between clicks, less than IDLE_MS + fades.
    for (let t = 8800; t <= 9600 + CLICK_FX_MS; t += 5) expect(cursorPose(track, t).opacity).toBe(1);
  });

  it('fades out after the last click at the end of the recording', () => {
    const last = 9600 + CLICK_FX_MS;
    expect(cursorPose(track, last + IDLE_MS - 1).opacity).toBe(1);
    expect(cursorPose(track, last + IDLE_MS + IDLE_FADE_OUT_MS).opacity).toBe(0);
    expect(cursorPose(track, last + 60_000).opacity).toBe(0);
  });

  it('a press always shows the cursor, even with no movement around it', () => {
    const lone = buildCursorTrack(cursorInput([move(0, 50, 50), down(20_000, 50, 50)]));
    expect(cursorPose(lone, 10_000).opacity).toBe(0);
    expect(cursorPose(lone, 20_000 - IDLE_FADE_IN_MS).opacity).toBe(0);
    for (let t = 20_000; t < 20_000 + CLICK_FX_MS; t += 5) expect(cursorPose(lone, t).opacity).toBe(1);
  });

  it('under reduced motion fades quickly without scaling', () => {
    const reduced = buildCursorTrack(cursorInput(events), { reducedMotion: true });
    const second = reduced.moves[1] as (typeof reduced.moves)[number];
    expect(cursorPose(reduced, 6000).opacity).toBe(0);
    expect(cursorPose(reduced, 6000).scale).toBe(1);
    expect(cursorPose(reduced, second.start - 130).opacity).toBe(0);
    expect(cursorPose(reduced, second.start - 60).opacity).toBeGreaterThan(0);
    expect(cursorPose(reduced, second.start - 60).scale).toBe(1);
    expect(cursorPose(reduced, second.start).opacity).toBe(1);
  });

  it('is deterministic across seek order', () => {
    const times = Array.from({ length: 500 }, (_, i) => i * 23.3);
    const forward = times.map((t) => ({ ...cursorPose(track, t) }));
    const fresh = buildCursorTrack(cursorInput(events));
    const backward = times
      .toReversed()
      .map((t) => ({ ...cursorPose(fresh, t) }))
      .toReversed();
    expect(backward).toEqual(forward);
  });
});
