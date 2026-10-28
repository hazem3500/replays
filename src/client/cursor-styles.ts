/**
 * Cua Cursor Motion's six built-in styles (`@trycua/cursor-motion` src/spec.ts
 * and plan.ts at f982ea0, MIT License, Copyright (c) 2025 Cua AI, Inc.; see
 * `cursor-motion.ts`). Each plans the hotspot only: Replays keeps the arrow
 * upright and draws none of Cua's glow, trail, ripple or magnet effects.
 * Replays never knows the target rect, so every move aims at Cua's default
 * 24 pt target; `adaptive` therefore never picks its small-target generator.
 */

import type { CursorMotionStyle } from '../shared/cursor.ts';
import { planDubins } from './cursor-dubins.ts';
import {
  bowPath,
  bumpProfile,
  cuaPath,
  DT_MS,
  inOutCubic,
  minJerk,
  naturalSide,
  pin,
  sampleTimed,
  wobbleProfile,
  type ArcShape,
  type Path,
  type Pt,
  type Raw,
} from './cursor-path.ts';

/** Target box assumed when a move has no element rect, pt. */
const DEFAULT_TARGET_PT = 24;

interface Fitts {
  a: number;
  b: number;
  minMs: number;
  maxMs: number;
  scale: number;
}

const fitts = (scale: number): Fitts => ({ a: 150, b: 120, minMs: 300, maxMs: 1000, scale });
const fittsMs = (f: Fitts, distance: number, width = DEFAULT_TARGET_PT) =>
  Math.min(Math.max(f.a + f.b * Math.log2(distance / Math.max(width, 4) + 1), f.minMs), f.maxMs) * f.scale;

const SIGNATURE_FITTS = fitts(1.1);
/** `adaptive`'s own Fitts model for short and medium moves. */
const ADAPTIVE_FITTS: Fitts = { a: 50, b: 150, minMs: 180, maxMs: 1400, scale: 1 };

/** `signature_arc` duration for a move of `distance` pt onto a `width` pt target. */
export const moveDurationMs = (distance: number, width = DEFAULT_TARGET_PT) => fittsMs(SIGNATURE_FITTS, distance, width);

/** Style arcs at Cua's default handles (0.3 / 0.3); the knob scaling is 1 at Cua Driver's defaults. */
const arc = (arcSize: number, arcFlow: number): ArcShape => ({ startHandle: 0.3, endHandle: 0.3, arcSize, arcFlow });

const distanceOf = (from: Pt, to: Pt) => Math.hypot(to.x - from.x, to.y - from.y);

function glide({ from, to }: { from: Pt; to: Pt }, path: Path, profile: (t: number) => number, ms: number) {
  return sampleTimed((tau) => path.atFraction(profile(tau)), ms, from, to);
}

function signatureArc(from: Pt, to: Pt) {
  const distance = distanceOf(from, to);
  const shape = arc(0.16, 0.15);
  const path = cuaPath(from, to, { ...shape, arcSize: shape.arcSize * naturalSide(from, to) });
  const over = Math.min(0.018, 8 / Math.max(distance, 1));
  return glide({ from, to }, path, bumpProfile(minJerk, over, 0.82), moveDurationMs(distance));
}

function springSettle(from: Pt, to: Pt) {
  const distance = distanceOf(from, to);
  const path = cuaPath(from, to, arc(0.12 * naturalSide(from, to), 0));
  const amp = Math.min(0.05, 6 / Math.max(distance, 1));
  const profile = wobbleProfile((t) => minJerk(Math.min(t / 0.68, 1)), { amp, cycles: 1.3, decay: 2.6, start: 0.55 });
  return glide({ from, to }, path, profile, fittsMs(fitts(1.35), distance));
}

function cometSwoop(from: Pt, to: Pt) {
  const path = cuaPath(from, to, arc(0.24 * naturalSide(from, to), 0.2));
  return glide({ from, to }, path, inOutCubic, fittsMs(fitts(1.15), distanceOf(from, to)));
}

/** Accelerates along a slight bow, then is pulled onto the target once within 40 pt. */
function magnetic(from: Pt, to: Pt) {
  const path = bowPath(from, to, 0.04 * naturalSide(from, to));
  const len = path.length;
  const radius = Math.min(40, len * 0.5);
  const dt = DT_MS / 1000;
  const out: Raw[] = [{ t: 0, x: from.x, y: from.y }];
  let s = 0;
  let v = 0;
  let t = 0;
  while (s < len && t < 4) {
    const remaining = len - s;
    if (remaining > radius) v = Math.min(1500, v + 7000 * dt, 300 + 5.5 * (remaining - radius));
    else v += 26000 * 0.45 * (radius / Math.max(remaining, 6)) * dt;
    s = Math.min(len, s + v * dt);
    t += dt;
    const q = path.atFraction(s / len);
    out.push({ t: t * 1000, x: q.x, y: q.y });
  }
  return pin(out, from, to);
}

/** Seeded from the move itself, so the same replay always plans the same swoop. */
function seededUnit(from: Pt, to: Pt) {
  const text = `${from.x.toFixed(1)},${from.y.toFixed(1)},${to.x.toFixed(1)},${to.y.toFixed(1)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  let r = (h >>> 0) + 0x6d2b79f5;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

/** A near-straight minimum-jerk reach, or a keynote-style swoop for moves over 900 pt. */
function adaptive(from: Pt, to: Pt) {
  const distance = distanceOf(from, to);
  const side = naturalSide(from, to);
  if (distance > 900) {
    const ms = Math.min(Math.max(350 + 0.35 * distance, 450), 1100);
    const path = cuaPath(from, to, arc((0.25 + 0.1 * seededUnit(from, to)) * side, 0.2));
    return glide({ from, to }, path, inOutCubic, ms);
  }
  return glide({ from, to }, bowPath(from, to, 0.02 * side), minJerk, fittsMs(ADAPTIVE_FITTS, distance));
}

/** Distance from the hotspot back to the arrow's body along its heading, pt. */
const POINTER_ANCHOR_OFFSET = 16;
const CLASSIC = {
  turnRadius: 80,
  peakSpeed: 900,
  minStartSpeed: 300,
  minEndSpeed: 200,
  stiffness: 400,
  damping: 17,
  overshoot: 0.8,
};

/** Cua's original glide: the body follows a Dubins path, then springs past the target and settles. */
function classic(from: Pt, to: Pt, heading: number) {
  const dt = DT_MS / 1000;
  const back = { x: Math.cos(heading) * POINTER_ANCHOR_OFFSET, y: Math.sin(heading) * POINTER_ANCHOR_OFFSET };
  const start = { x: from.x + back.x, y: from.y + back.y, heading: heading + Math.PI };
  const path = planDubins(start, { x: to.x + back.x, y: to.y + back.y, heading: heading + Math.PI }, CLASSIC.turnRadius);
  const length = Math.max(path.length, 1);
  const out: Raw[] = [{ t: 0, x: from.x, y: from.y }];
  let d = 0;
  let t = 0;
  let speed = 0;
  for (let guard = 0; d < length && guard < 20000; guard++) {
    const u = Math.min(d / length, 1);
    const floor = u < 0.5 ? CLASSIC.minStartSpeed : CLASSIC.minEndSpeed;
    speed = floor + (CLASSIC.peakSpeed - floor) * ((30 * u * u * (1 - u) * (1 - u)) / 1.875);
    d += speed * dt;
    t += dt;
    if (d >= length) break;
    const s = path.sample(d);
    out.push({ t: t * 1000, x: s.x + Math.cos(s.heading) * POINTER_ANCHOR_OFFSET, y: s.y + Math.sin(s.heading) * POINTER_ANCHOR_OFFSET });
  }
  out.push({ t: t * 1000, x: to.x, y: to.y });
  const end = path.sample(length).heading;
  let ox = 0;
  let oy = 0;
  let vx = speed * CLASSIC.overshoot * Math.cos(end);
  let vy = speed * CLASSIC.overshoot * Math.sin(end);
  for (let i = 0; i < 600; i++) {
    for (let j = 0; j < 4; j++) {
      vx += (-CLASSIC.stiffness * ox - CLASSIC.damping * vx) * (dt / 4);
      vy += (-CLASSIC.stiffness * oy - CLASSIC.damping * vy) * (dt / 4);
      ox += vx * (dt / 4);
      oy += vy * (dt / 4);
    }
    t += dt;
    if (Math.hypot(ox, oy) < 0.3 && Math.hypot(vx, vy) < 2) break;
    out.push({ t: t * 1000, x: to.x + ox, y: to.y + oy });
  }
  out.push({ t: (t + dt) * 1000, x: to.x, y: to.y });
  return out;
}

/** The hotspot's samples for one move in `style`; the first and last land exactly on `from` and `to`. */
export function planStyle(style: CursorMotionStyle, from: Pt, to: Pt, heading: number): Raw[] {
  switch (style) {
    case 'spring_settle':
      return springSettle(from, to);
    case 'magnetic':
      return magnetic(from, to);
    case 'comet_swoop':
      return cometSwoop(from, to);
    case 'adaptive':
      return adaptive(from, to);
    case 'classic':
      return classic(from, to, heading);
    case 'signature_arc':
      return signatureArc(from, to);
  }
}
