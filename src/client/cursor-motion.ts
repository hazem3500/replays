import type { CursorMotionStyle, ReplayCursorSettings } from '../shared/cursor.ts';
import type { ReplaySource } from '../shared/replay.ts';
import { followsRecordedPath, recordedSegments } from './cursor-recorded-path.ts';
import { DT_MS, minJerk, sampleTimed, type Pt, type Raw } from './cursor-path.ts';
import { planStyle } from './cursor-styles.ts';

/**
 * Replay cursor motion: a pure function from playhead time to cursor pose.
 *
 * The motion model is ported from Cua Cursor Motion (`@trycua/cursor-motion`,
 * the library behind Cua Driver's agent cursor), with its six built-in styles:
 * https://github.com/trycua/cua/tree/main/libs/typescript/cursor-motion
 * (src/path.ts, ease.ts, spec.ts, style.ts, plan.ts, dubins.ts, effects.ts, render.ts at f982ea0).
 *
 *   MIT License. Copyright (c) 2025 Cua AI, Inc.
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions: The above copyright
 *   notice and this permission notice shall be included in all copies or
 *   substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
 *   WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
 *
 * What is ported: every style's hotspot path and timing (`cursor-styles.ts`:
 * the Cua cubic-bezier arcs and bows bent to the natural side, speed curves
 * applied by arc length, follow-through, spring wobble, magnetic pull, the
 * `classic` Dubins glide, Fitts duration), the tangent heading (the tip leads,
 * smoothed), the click squish, and the reduced-motion glide. What is not: the
 * glow, trail, magnet and click ripple effects (the viewer wants none), the
 * idle float and the canvas player. Replays never know the target rect, so
 * Fitts uses Cua's default 24 pt target.
 *
 * Replay-specific: the recorded mouse stream is reduced to targets (rests,
 * clicks, and waypoints in long continuous runs), and each move is scheduled so
 * the tip arrives when the recording arrived. Everything is planned once per
 * bundle; `cursorPose(track, t)` only looks things up, so seeking is exact.
 *
 * A person's recording is not planned that way: the cursor rides the recorded
 * path itself, straight between consecutive positions on their timestamps, with
 * no arc, easing or motion style (`cursor-recorded-path.ts`). Only agent
 * recordings, whose pointer jumps, get the styled glide above.
 */

// ---------- Cua Cursor Motion (ported) ----------

/** The arrow's rest heading: pointing up and to the left. */
export const REST_HEADING = Math.PI / 4;
const TIP_ANGLE = -0.75 * Math.PI;
const ARRIVAL_TOLERANCE_PT = 1;
const REDUCED_MOTION_MS = 120;

/** Click squish: press for 90 ms, spring back within 220 ms. 12% of the size at most. */
export const CLICK_FX_MS = 550;
const SQUISH = 0.12;

/**
 * The Cua Driver cursor body (`cursor-overlay/assets/build_default_theme.py`
 * `CURSOR_PATH`) on its 128-unit canvas, hotspot at (55, 30), shown at 42 pt.
 */
export const CURSOR_PATH =
  'M55 30 C48 28 42 33 43 41 C43 41 64 98 64 98 C67 106 73 106 77 99 C77 99 86 79 86 79 C88 75 91 72 95 70 C95 70 108 63 108 63 C115 59 114 53 107 50 C107 50 55 30 55 30 Z';
export const CURSOR_CANVAS = 128;
export const CURSOR_HOTSPOT = { x: 55, y: 30 } as const;
export const CURSOR_DISPLAY_SIZE = 42;

const wrapAngle = (a: number) => {
  const tau = 2 * Math.PI;
  let r = a % tau;
  if (r > Math.PI) r -= tau;
  if (r < -Math.PI) r += tau;
  return r;
};

/**
 * A planned move: `[t, x, y, heading]` samples (t in ms from the move's start)
 * and the time the tip first reaches the target.
 */
export interface Trajectory {
  samples: Float64Array;
  arrivalMs: number;
  durationMs: number;
}

/** Plans one move in `style`. `reducedMotion` is Cua's short straight glide without rotation or effects. */
export function planMove(
  from: Pt,
  to: Pt,
  {
    fromHeading = REST_HEADING,
    reducedMotion = false,
    style = 'signature_arc',
  }: { fromHeading?: number; reducedMotion?: boolean; style?: CursorMotionStyle | undefined } = {},
): Trajectory {
  const raw = reducedMotion
    ? sampleTimed(
        (tau) => ({ x: from.x + (to.x - from.x) * minJerk(tau), y: from.y + (to.y - from.y) * minJerk(tau) }),
        REDUCED_MOTION_MS,
        from,
        to,
      )
    : planStyle(style, from, to, REST_HEADING);
  // why: an upright pointer; CUA's tangent heading reads oddly as a mouse arrow in a debugging tool.
  return finish(raw, to, fromHeading, 'fixed');
}

/** Heading: the tip turns toward the direction of travel once it is moving, smoothed, then settles to rest. */
function finish(raw: Raw[], to: Pt, fromHeading: number, mode: 'tangent' | 'fixed'): Trajectory {
  const n = raw.length;
  const endHeading = REST_HEADING;
  let rot = wrapAngle(fromHeading - endHeading);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = raw[Math.max(i - 2, 0)] as Raw;
    const b = raw[Math.min(i + 2, n - 1)] as Raw;
    const cur = raw[i] as Raw;
    const dt = Math.max((b.t - a.t) / 1000, 1e-3);
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    const speed = Math.hypot(vx, vy);
    let want = 0;
    if (mode === 'tangent') {
      const w = Math.min(Math.max((speed - 40) / 260, 0), 1);
      want = wrapAngle(Math.atan2(vy, vx) - TIP_ANGLE) * w;
    }
    const step = i > 0 ? (cur.t - (raw[i - 1] as Raw).t) / 1000 : 0;
    rot += wrapAngle(want - rot) * (1 - Math.exp(-step * 22));
    out.push(cur.t, cur.x, cur.y, endHeading + rot);
  }
  const end = raw[n - 1] as Raw;
  let t = end.t;
  for (let i = 0; i < 36; i++) {
    if (Math.abs(rot) < 0.002) break;
    t += DT_MS;
    rot -= rot * (1 - Math.exp(-(DT_MS / 1000) * 22));
    out.push(t, end.x, end.y, endHeading + rot);
  }
  out[out.length - 1] = endHeading;
  let arrivalMs = t;
  for (let i = 0; i < out.length; i += 4) {
    if (Math.hypot((out[i + 1] as number) - to.x, (out[i + 2] as number) - to.y) <= ARRIVAL_TOLERANCE_PT) {
      arrivalMs = out[i] as number;
      break;
    }
  }
  return { samples: Float64Array.from(out), arrivalMs, durationMs: t };
}

/** Interpolated `[x, y, heading]` at `ms` into the move, clamped to the ends; written into `into`. */
export function sampleTrajectory(traj: Trajectory, ms: number, into: Pose) {
  const s = traj.samples;
  const count = s.length / 4;
  let i: number;
  if (ms <= (s[0] as number)) i = 0;
  else if (ms >= (s[(count - 1) * 4] as number)) i = count - 1;
  else {
    let lo = 0;
    let hi = count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((s[mid * 4] as number) <= ms) lo = mid;
      else hi = mid;
    }
    const a = lo * 4;
    const b = hi * 4;
    const f = (ms - (s[a] as number)) / ((s[b] as number) - (s[a] as number));
    into.x = (s[a + 1] as number) + ((s[b + 1] as number) - (s[a + 1] as number)) * f;
    into.y = (s[a + 2] as number) + ((s[b + 2] as number) - (s[a + 2] as number)) * f;
    into.heading = (s[a + 3] as number) + wrapAngle((s[b + 3] as number) - (s[a + 3] as number)) * f;
    return into;
  }
  into.x = s[i * 4 + 1] as number;
  into.y = s[i * 4 + 2] as number;
  into.heading = s[i * 4 + 3] as number;
  return into;
}

/** Click squish `ageMs` after a press, as a fraction of the size. */
export function squish(ageMs: number) {
  const age = ageMs / 1000;
  if (age < 0) return 0;
  const PRESS = 0.09;
  if (age < PRESS) return SQUISH * Math.min(age / 0.05, 1);
  const after = age - PRESS;
  return SQUISH * Math.max(Math.cos(Math.min(after / 0.22, 1) * Math.PI * 1.5), 0) * Math.max(1 - after / 0.22, 0);
}

// ---------- Replay track ----------

/** A recorded pointer position on the replay clock (ms, same clock as event timestamps). */
export interface CursorPoint {
  t: number;
  x: number;
  y: number;
}

export interface CursorInput {
  points: CursorPoint[];
  /** Press times (mouse down / touch start), ascending. */
  presses: number[];
  /** Last recorded viewport (Meta event), used to keep the cursor on the page. */
  viewport?: { width: number; height: number };
}

/** A still between moves this long marks a target (the recording samples motion every ~50 ms). */
const REST_MS = 150;
/** Continuous motion longer than this is broken into waypoints so the path keeps its shape. */
const WAYPOINT_MS = 600;
/** A move this long between leaving a rest and arriving was recorded as a sweep (the stream samples every ~50 ms). */
const SWEEP_MIN_MS = 100;
/** A Click with no MouseDown this close before it is a press of its own. */
const CLICK_PAIR_MS = 500;

const META = 4;
const INCREMENTAL = 3;
const MOUSE_MOVE = 1;
const TOUCH_MOVE = 6;
const DRAG = 12;
const MOUSE_INTERACTION = 2;
const MOUSE_DOWN = 1;
const CLICK = 2;
const TOUCH_START = 7;
const MOUSE_UP = 0;
/** Interactions whose position is a pointer position: down, context menu, double click, touch start/move/end. */
const POSITIONED = new Set([1, 3, 4, 7, 8, 9]);

/**
 * Pulls pointer positions and presses out of an rrweb event list. Move
 * positions are stamped `event.timestamp + timeOffset` (rrweb batches them and
 * the offsets are negative). Mouse up and click repeat the mouse down's spot
 * (rounded), so their positions only count when there was no mouse down.
 */
export function cursorInput(events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>): CursorInput {
  const points: CursorPoint[] = [];
  const downs: number[] = [];
  const clicks: number[] = [];
  const releases: CursorPoint[] = [];
  let viewport: CursorInput['viewport'];
  for (const event of events) {
    if (event.type === META && event.data && typeof event.data === 'object') {
      const { width, height } = event.data as { width?: unknown; height?: unknown };
      if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) viewport ??= { width, height };
      continue;
    }
    if (event.type !== INCREMENTAL || !event.data || typeof event.data !== 'object') continue;
    const data = event.data as { source?: unknown; positions?: unknown; type?: unknown; x?: unknown; y?: unknown };
    if (data.source === MOUSE_MOVE || data.source === TOUCH_MOVE || data.source === DRAG) {
      if (!Array.isArray(data.positions)) continue;
      for (const position of data.positions as Array<{ x?: unknown; y?: unknown; timeOffset?: unknown }>) {
        if (typeof position.x !== 'number' || typeof position.y !== 'number') continue;
        // A leading move to exactly (0, 0) is a placeholder (synthetic recorders, a pointer not yet over the page),
        // not a real position: the cursor would sit in the top-left corner until the first real move.
        if (points.length === 0 && position.x === 0 && position.y === 0) continue;
        const offset = typeof position.timeOffset === 'number' ? position.timeOffset : 0;
        points.push({ t: event.timestamp + offset, x: position.x, y: position.y });
      }
    } else if (data.source === MOUSE_INTERACTION && typeof data.type === 'number') {
      const positioned = typeof data.x === 'number' && typeof data.y === 'number';
      if (positioned && POSITIONED.has(data.type)) points.push({ t: event.timestamp, x: data.x as number, y: data.y as number });
      else if (positioned && (data.type === MOUSE_UP || data.type === CLICK)) {
        releases.push({ t: event.timestamp, x: data.x as number, y: data.y as number });
      }
      if (data.type === MOUSE_DOWN || data.type === TOUCH_START) downs.push(event.timestamp);
      else if (data.type === CLICK) clicks.push(event.timestamp);
    }
  }
  downs.sort((a, b) => a - b);
  const paired = (t: number) => downs.some((down) => down <= t && t - down <= CLICK_PAIR_MS);
  for (const release of releases) if (!paired(release.t)) points.push(release);
  points.sort((a, b) => a.t - b.t);
  const presses = [...downs, ...clicks.filter((click) => !paired(click))];
  presses.sort((a, b) => a - b);
  return viewport ? { points, presses, viewport } : { points, presses };
}

/** agent-browser's virtual mouse starts at the page origin. */
const ORIGIN_PT = 40;
/** Samples closer than this belong to one continuous sweep. */
const SWEEP_GAP_MS = 2 * REST_MS;

/**
 * agent-browser's mouse starts at 0,0 and sweeps to its first destination. When the
 * recording opens at the origin, that whole opening sweep is dropped and the cursor
 * starts where it ends, so it never glides in from the corner. The rest is clamped
 * to the recorded viewport so the cursor never leaves the page. A person's pointer can
 * start in the corner for real, so `keepOpening` keeps that sweep and only clamps.
 */
export function onPage(
  points: readonly CursorPoint[],
  viewport?: { width: number; height: number },
  { keepOpening = false }: { keepOpening?: boolean } = {},
): CursorPoint[] {
  let start = 0;
  const opening = points[0];
  if (!keepOpening && opening && opening.x <= ORIGIN_PT && opening.y <= ORIGIN_PT) {
    while (start < points.length - 1 && (points[start + 1] as CursorPoint).t - (points[start] as CursorPoint).t < SWEEP_GAP_MS) start++;
  }
  const kept = points.slice(start);
  if (!viewport) return kept.map((p) => ({ t: p.t, x: Math.max(0, p.x), y: Math.max(0, p.y) }));
  const maxX = viewport.width - 1;
  const maxY = viewport.height - 1;
  return kept.map((p) => ({ t: p.t, x: Math.min(Math.max(0, p.x), maxX), y: Math.min(Math.max(0, p.y), maxY) }));
}

/** A place the cursor comes to rest, and when the recorded pointer set off from it again. */
export interface CursorTarget extends CursorPoint {
  leftAt: number;
}

/** Where the cursor comes to rest: rests, the ends, and waypoints inside long continuous runs. */
export function cursorTargets(points: readonly CursorPoint[]): CursorTarget[] {
  const targets: CursorTarget[] = [];
  let runStart: number | undefined;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as CursorPoint;
    const next = points[i + 1];
    const last = targets.at(-1);
    const leftAt = next?.t ?? p.t;
    if (!last) {
      targets.push({ ...p, leftAt });
      continue;
    }
    runStart ??= p.t;
    const rest = !next || next.t - p.t >= REST_MS;
    if (!rest && p.t - runStart < WAYPOINT_MS) continue;
    runStart = undefined;
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.5) {
      last.leftAt = leftAt;
      continue;
    }
    targets.push({ ...p, leftAt });
  }
  return targets;
}

interface Move {
  start: number;
  /** Where this move hands over to the next one (or where its own settle ends). */
  end: number;
  /** Time scale: replay ms per trajectory ms (< 1 when the recording allows less time). */
  scale: number;
  traj: Trajectory;
}

export interface CursorTrack {
  /** First real position; the cursor rests here from the start of the replay. */
  appearsAt: number;
  first: CursorPoint | undefined;
  moves: Move[];
  starts: Float64Array;
  presses: number[];
  /** When the cursor is in use (a move with its settle, a click squish): merged, ascending, disjoint. */
  activeStarts: Float64Array;
  activeEnds: Float64Array;
  reducedMotion: boolean;
  settings?: ReplayCursorSettings | undefined;
}

export interface Pose {
  visible: boolean;
  x: number;
  y: number;
  heading: number;
  /** 1 at rest, down to 0.88 at the bottom of a click squish, and to 0.9 while faded out when idle. */
  scale: number;
  /** 1 while in use; 0 while idle (before the first move, and IDLE_MS after the last move or click). */
  opacity: number;
  /** Ms since the click being shown, for a theme's click effect; -1 outside one, with click feedback off or under reduced motion. */
  press?: number;
}

/** A cursor still this long since its last move or click fades out: it is not pointing at anything. */
export const IDLE_MS = 1500;
/** Fade-out after the idle time, ms. */
export const IDLE_FADE_OUT_MS = 300;
/** Fade-in lead: the cursor is fully back this long before the next move or press starts, so it is seen arriving. */
export const IDLE_FADE_IN_MS = 250;
/** Faded-out size, as a fraction of the cursor. */
const IDLE_SCALE = 0.9;
/**
 * Under reduced motion the cursor still leaves and returns (a cursor parked over the page is the
 * problem being solved), but as a quick opacity cross-fade of the reduced-motion glide's length
 * and without the scale: no movement, and no hard pop either.
 */
const REDUCED_FADE_MS = REDUCED_MOTION_MS;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Merges `[start, end]` spans into ascending disjoint ones. */
function mergeSpans(spans: Array<[number, number]>) {
  spans.sort((a, b) => a[0] - b[0]);
  const starts: number[] = [];
  const ends: number[] = [];
  for (const [start, end] of spans) {
    const last = ends.length - 1;
    if (last >= 0 && start <= (ends[last] as number)) ends[last] = Math.max(ends[last] as number, end);
    else {
      starts.push(start);
      ends.push(end);
    }
  }
  return { activeStarts: Float64Array.from(starts), activeEnds: Float64Array.from(ends) };
}

/**
 * Plans every move once. Each move lands on its target when the recording did;
 * it starts early enough for its Cua duration but never before the previous
 * target was reached. If it must start while the previous move is still
 * settling, it starts from that move's pose and the earlier one is cut there.
 */
export function buildCursorTrack(
  input: CursorInput,
  options: { reducedMotion?: boolean; settings?: ReplayCursorSettings | undefined; source?: ReplaySource | undefined } = {},
): CursorTrack {
  const reducedMotion = options.reducedMotion ?? false;
  const motion = options.settings?.motion;
  if (!reducedMotion && followsRecordedPath(options.source, input.points)) return recordedTrack(input, options.settings);
  const targets = cursorTargets(onPage(input.points, input.viewport));
  const moves: Move[] = [];
  const pose: Pose = { visible: true, x: 0, y: 0, heading: REST_HEADING, scale: 1, opacity: 1 };
  for (let i = 1; i < targets.length; i++) {
    const from = targets[i - 1] as CursorTarget;
    const to = targets[i] as CursorTarget;
    let traj = planMove(from, to, { reducedMotion, style: motion });
    /* why: a sweep the recording saw (several samples) runs on the pointer's own clock, setting off when the pointer did and
       landing when it did. A lone jump has no sweep to follow, so it glides in ahead of its landing. */
    const followed = to.t - from.leftAt >= SWEEP_MIN_MS;
    const start = followed ? from.leftAt : Math.max(from.t, to.t - traj.arrivalMs);
    const previous = moves.at(-1);
    if (previous && start < previous.end) {
      sampleTrajectory(previous.traj, (start - previous.start) / previous.scale, pose);
      previous.end = start;
      traj = planMove({ x: pose.x, y: pose.y }, to, { fromHeading: pose.heading, reducedMotion, style: motion });
    }
    const available = to.t - start;
    const fit = available / Math.max(traj.arrivalMs, 1);
    const scale = available >= 1 ? (followed ? fit : Math.min(1, fit)) : 0;
    moves.push({ start, end: scale > 0 ? start + traj.durationMs * scale : start, scale, traj });
  }
  return assemble({ first: targets[0], moves, presses: input.presses, reducedMotion, settings: options.settings });
}

/** A person's recording: the cursor follows the recorded path itself, whatever motion style is saved. */
function recordedTrack(input: CursorInput, settings: ReplayCursorSettings | undefined) {
  const points = onPage(input.points, input.viewport, { keepOpening: true });
  const moves: Move[] = recordedSegments(points, REST_HEADING, REST_MS).map((segment) => ({
    start: segment.start,
    end: segment.start + segment.durationMs,
    scale: 1,
    traj: { samples: segment.samples, arrivalMs: segment.durationMs, durationMs: segment.durationMs },
  }));
  return assemble({ first: points[0], moves, presses: input.presses, reducedMotion: false, settings });
}

function assemble({
  first,
  moves,
  presses,
  reducedMotion,
  settings,
}: Pick<CursorTrack, 'first' | 'moves' | 'presses' | 'reducedMotion' | 'settings'>): CursorTrack {
  const spans: Array<[number, number]> = moves.map((move) => [move.start, move.start + move.traj.durationMs * move.scale]);
  for (const press of presses) spans.push([press, press + CLICK_FX_MS]);
  return {
    // Shown from the start of the replay, resting where it first lands; never hidden, never sliding in from a corner.
    appearsAt: first ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    first,
    moves,
    starts: Float64Array.from(moves, (move) => move.start),
    presses,
    ...mergeSpans(spans),
    reducedMotion,
    settings,
  };
}

/** Index of the last entry `<= t` in an ascending list, or -1. */
function lastAtOrBefore(list: ArrayLike<number>, t: number) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as number) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * How present the cursor is at `t`, 0..1. In use (moving, settling, squishing) it is 1. Still for
 * IDLE_MS after its last use it fades out; since the future is known, it fades back in so it is
 * fully there IDLE_FADE_IN_MS before the next use starts. A gap too short for a full fade-out and
 * fade-in never dips (no half-fade flicker). Before the first use it is hidden; after the last it fades.
 */
export function idlePresence(track: CursorTrack, t: number) {
  const i = lastAtOrBefore(track.activeStarts, t);
  const prevEnd = i >= 0 ? (track.activeEnds[i] as number) : Number.NEGATIVE_INFINITY;
  if (t <= prevEnd) return 1;
  const nextStart = i + 1 < track.activeStarts.length ? (track.activeStarts[i + 1] as number) : Number.POSITIVE_INFINITY;
  const fadeOut = track.reducedMotion ? REDUCED_FADE_MS : IDLE_FADE_OUT_MS;
  const fadeIn = track.reducedMotion ? REDUCED_FADE_MS : IDLE_FADE_IN_MS;
  if (nextStart - prevEnd <= IDLE_MS + fadeOut + fadeIn) return 1;
  const leaving = 1 - easeOut(Math.min(Math.max((t - prevEnd - IDLE_MS) / fadeOut, 0), 1));
  const arriving = easeOut(Math.min(Math.max(1 - (nextStart - t) / fadeIn, 0), 1));
  // A missing side (no use before or after) clamps to 0; the guards only catch t = ±Infinity.
  return Math.max(Number.isNaN(leaving) ? 0 : leaving, Number.isNaN(arriving) ? 0 : arriving);
}

/** The cursor at replay time `t` (ms, event clock). Pure: the same `t` always gives the same pose. */
export function cursorPose(
  track: CursorTrack,
  t: number,
  into: Pose = { visible: false, x: 0, y: 0, heading: REST_HEADING, scale: 1, opacity: 1 },
) {
  into.scale = 1;
  into.opacity = 1;
  into.press = -1;
  if (track.settings?.visible === false || !track.first || !(t >= track.appearsAt)) {
    into.visible = false;
    into.opacity = 0;
    return into;
  }
  into.visible = true;
  const index = lastAtOrBefore(track.starts, t);
  const move = track.moves[index];
  if (!move) {
    into.x = track.first.x;
    into.y = track.first.y;
    into.heading = REST_HEADING;
  } else if (move.scale === 0 || t >= move.start + move.traj.durationMs * move.scale) {
    sampleTrajectory(move.traj, move.traj.durationMs, into);
  } else {
    sampleTrajectory(move.traj, (t - move.start) / move.scale, into);
  }
  if (!track.reducedMotion && track.settings?.clickFeedback !== false) {
    const press = track.presses[lastAtOrBefore(track.presses, t)];
    if (press !== undefined && t - press < CLICK_FX_MS) {
      into.scale = 1 - squish(t - press);
      into.press = t - press;
    }
  }
  into.opacity = track.settings?.hideWhenIdle === false ? 1 : idlePresence(track, t);
  if (!track.reducedMotion && into.opacity < 1) into.scale *= IDLE_SCALE + (1 - IDLE_SCALE) * into.opacity;
  return into;
}
