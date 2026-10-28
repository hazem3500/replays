import { describe, expect, it } from 'vitest';

import { CURSOR_MOTION_STYLES, type CursorMotionStyle } from '../src/shared/cursor.ts';
import { buildCursorTrack, cursorInput, cursorPose, planMove, sampleTrajectory } from '../src/client/cursor-motion.ts';

const pose = () => ({ visible: false, x: 0, y: 0, heading: 0, scale: 1, opacity: 1 });
const FROM = { x: 100, y: 400 };
const TO = { x: 700, y: 400 };

/** Every sampled hotspot of a move, in order. */
function trace(style: CursorMotionStyle, to = TO) {
  const traj = planMove(FROM, to, { style });
  const points = [];
  for (let ms = 0; ms <= traj.durationMs; ms += 2) points.push(sampleTrajectory(traj, ms, pose()));
  return { traj, points };
}

const overshoot = (style: CursorMotionStyle) => Math.max(...trace(style).points.map((p) => p.x)) - TO.x;
/** Largest upward bend, as a fraction of the move's length. */
const bend = (style: CursorMotionStyle, to = TO) => Math.max(...trace(style, to).points.map((p) => FROM.y - p.y)) / (to.x - FROM.x);

describe('cursor motion styles', () => {
  it('start and land exactly on the recorded points in every style', () => {
    const ends = CURSOR_MOTION_STYLES.map((style) => {
      const traj = planMove(FROM, TO, { style });
      const start = sampleTrajectory(traj, 0, pose());
      const end = sampleTrajectory(traj, traj.durationMs, pose());
      return { style, start: [start.x, start.y], end: [end.x, end.y], arrives: traj.arrivalMs <= traj.durationMs };
    });
    expect(ends).toEqual(CURSOR_MOTION_STYLES.map((style) => ({ style, start: [FROM.x, FROM.y], end: [TO.x, TO.y], arrives: true })));
  });

  it('plan a different path for each style', () => {
    const midpoints = CURSOR_MOTION_STYLES.map((style) => {
      const { traj } = trace(style);
      const mid = sampleTrajectory(traj, traj.arrivalMs / 2, pose());
      return `${mid.x.toFixed(1)},${mid.y.toFixed(1)}`;
    });
    expect(new Set(midpoints).size).toBe(CURSOR_MOTION_STYLES.length);
  });

  it('settles with a wobble past the target in spring settle and classic, but not comet swoop', () => {
    expect(overshoot('spring_settle')).toBeGreaterThan(1);
    expect(overshoot('classic')).toBeGreaterThan(1);
    expect(overshoot('comet_swoop')).toBeLessThanOrEqual(1e-6);
  });

  it('sweeps comet swoop wider than the signature arc', () => {
    expect(bend('comet_swoop')).toBeGreaterThan(bend('signature_arc') * 1.2);
  });

  it('pulls magnetic onto the target faster than it approached', () => {
    const { points } = trace('magnetic');
    const speedNear = (remaining: number) => {
      const index = points.findIndex((p) => TO.x - p.x <= remaining);
      const [a, b] = points.slice(index, index + 2);
      return a && b ? b.x - a.x : 0;
    };
    expect(speedNear(12)).toBeGreaterThan(speedNear(120));
  });

  it('swoops adaptive only on long moves, the same way every time', () => {
    const far = { x: FROM.x + 1200, y: FROM.y };
    expect(bend('adaptive', far)).toBeGreaterThan(bend('adaptive') * 4);
    expect(trace('adaptive', far).points).toEqual(trace('adaptive', far).points);
  });

  it('keeps the recorded arrival times when a replay uses a saved style', () => {
    const events = [
      { type: 4, timestamp: 0, data: { width: 1200, height: 800 } },
      { type: 3, timestamp: 100, data: { source: 1, positions: [{ x: 100, y: 400, timeOffset: 0 }] } },
      { type: 3, timestamp: 2000, data: { source: 2, type: 2, x: 700, y: 400 } },
    ];
    const landed = CURSOR_MOTION_STYLES.map((motion) => {
      const at = cursorPose(buildCursorTrack(cursorInput(events), { settings: { motion } }), 2000);
      return [motion, Math.hypot(at.x - 700, at.y - 400) <= 1];
    });
    expect(landed).toEqual(CURSOR_MOTION_STYLES.map((motion) => [motion, true]));
  });
});
