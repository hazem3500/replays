import { describe, expect, it } from 'vitest';

import { CURSOR_MOTION_STYLES } from '../src/shared/cursor.ts';
import { buildCursorTrack, cursorInput, cursorPose, planMove, REST_HEADING, sampleTrajectory } from '../src/client/cursor-motion.ts';

const pose = () => ({ visible: false, x: 0, y: 0, heading: 0, scale: 1, opacity: 1 });
const FROM = { x: 100, y: 400 };
const TO = { x: 700, y: 400 };

/** Every sampled hotspot of a rightward move, in order. */
function trace(style: (typeof CURSOR_MOTION_STYLES)[number], from = FROM, to = TO) {
  const traj = planMove(from, to, REST_HEADING, false, style);
  const points = [];
  for (let ms = 0; ms <= traj.durationMs; ms += 2) points.push(sampleTrajectory(traj, ms, pose()));
  return { traj, points };
}

describe('cursor motion styles', () => {
  it('start and land exactly on the recorded points in every style', () => {
    for (const style of CURSOR_MOTION_STYLES) {
      const traj = planMove(FROM, TO, REST_HEADING, false, style);
      const start = sampleTrajectory(traj, 0, pose());
      const end = sampleTrajectory(traj, traj.durationMs, pose());
      expect([start.x, start.y], style).toEqual([FROM.x, FROM.y]);
      expect([end.x, end.y], style).toEqual([TO.x, TO.y]);
      expect(traj.arrivalMs, style).toBeLessThanOrEqual(traj.durationMs);
    }
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
    const overshoot = (style: (typeof CURSOR_MOTION_STYLES)[number]) => Math.max(...trace(style).points.map((p) => p.x)) - TO.x;
    expect(overshoot('spring_settle')).toBeGreaterThan(1);
    expect(overshoot('classic')).toBeGreaterThan(1);
    expect(overshoot('comet_swoop')).toBeLessThanOrEqual(1e-6);
  });

  it('sweeps comet swoop wider than the signature arc', () => {
    const bend = (style: (typeof CURSOR_MOTION_STYLES)[number]) => Math.max(...trace(style).points.map((p) => TO.y - p.y));
    expect(bend('comet_swoop')).toBeGreaterThan(bend('signature_arc') * 1.2);
  });

  it('pulls magnetic onto the target faster than it approached', () => {
    const { points } = trace('magnetic');
    const speedNear = (remaining: number) => {
      const index = points.findIndex((p) => TO.x - p.x <= remaining);
      return points[index + 1]!.x - points[index]!.x;
    };
    expect(speedNear(12)).toBeGreaterThan(speedNear(120));
  });

  it('swoops adaptive only on long moves, the same way every time', () => {
    const bend = (to: { x: number; y: number }) => {
      const { points } = trace('adaptive', FROM, to);
      return Math.max(...points.map((p) => FROM.y - p.y)) / (to.x - FROM.x);
    };
    const far = { x: FROM.x + 1200, y: FROM.y };
    expect(bend(far)).toBeGreaterThan(bend(TO) * 4);
    expect(trace('adaptive', FROM, far).points).toEqual(trace('adaptive', FROM, far).points);
  });

  it('keeps the recorded arrival times when a replay uses a saved style', () => {
    const events = [
      { type: 4, timestamp: 0, data: { width: 1200, height: 800 } },
      { type: 3, timestamp: 100, data: { source: 1, positions: [{ x: 100, y: 400, timeOffset: 0 }] } },
      { type: 3, timestamp: 2000, data: { source: 2, type: 2, x: 700, y: 400 } },
    ];
    for (const motion of CURSOR_MOTION_STYLES) {
      const track = buildCursorTrack(cursorInput(events), { settings: { motion } });
      const landed = cursorPose(track, 2000);
      expect(Math.hypot(landed.x - 700, landed.y - 400), motion).toBeLessThanOrEqual(1);
    }
  });
});
