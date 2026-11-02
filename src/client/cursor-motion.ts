import { DEFAULT_CURSOR_MOTION_STYLE, type CursorMotionStyle, type ReplayCursorSettings } from '../shared/cursor.ts';

/**
 * Replay cursor motion: a pure function from playhead time to cursor pose.
 *
 * The motion model is ported from Cua Cursor Motion (`@trycua/cursor-motion`,
 * the library behind Cua Driver's agent cursor), all six built-in styles:
 * https://github.com/trycua/cua/tree/4b84caa4053bd86be7746c5527cee3d1626612ed/libs/typescript/cursor-motion
 * (src/plan.ts, spec.ts, params.ts, style.ts, path.ts, ease.ts, geom.ts,
 * dubins.ts, rng.ts at 4b84caa; the click squish and arrow are from the
 * earlier f982ea0 port of effects.ts / render.ts and are unchanged).
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
 * What is ported: each style's path (the Cua cubic-bezier arc, the bow, the
 * Dubins glide), its speed curve applied by arc length, its settle
 * (follow-through, spring wobble, arrival spring), its duration, the seeded
 * random draw of `adaptive`, the click squish, and the reduced-motion glide.
 * Every style plays with its `native` timing (Cua's own per-style durations;
 * upstream's `steady` floor would retime the default arc). What is not: the
 * glow, trail, magnet and ripple effects, the idle float and the canvas
 * player. The arrow stays upright (Cua's tangent heading reads oddly as a mouse
 * arrow in a debugging tool); only the hotspot follows the style. Replays never
 * know the target rect, so every move uses Cua's default 24 pt target, and
 * `adaptive`'s `precise_click` branch (targets under 16 pt) never applies.
 *
 * Replay-specific: the recorded mouse stream is reduced to targets (rests,
 * clicks, and waypoints in long continuous runs), and each move is scheduled so
 * the tip arrives when the recording arrived. Everything is planned once per
 * bundle; `cursorPose(track, t)` only looks things up, so seeking is exact.
 */

// ---------- Cua Cursor Motion (ported) ----------

/** Sample period of every planned move, ms (120 Hz). */
const DT_MS = 1000 / 120;
/** Target box assumed when a move has no element rect, pt. */
export const DEFAULT_TARGET_PT = 24;
/** The arrow's rest heading: pointing up and to the left. */
export const REST_HEADING = Math.PI / 4;
const TIP_ANGLE = -0.75 * Math.PI;
const ARRIVAL_TOLERANCE_PT = 1;
const REDUCED_MOTION_MS = 120;

/** Cua's Fitts model: `(a + b log2(D / W + 1))` ms clamped to `minMs..maxMs`, times `scale`. */
interface Fitts {
  a: number;
  b: number;
  minMs: number;
  maxMs: number;
  scale: number;
}
/** spec.ts `fittsDuration`: the model the arc styles share. */
const fitts = (scale: number): Fitts => ({ a: 150, b: 120, minMs: 300, maxMs: 1000, scale });

type Settle =
  | { type: 'none' }
  /** Push `amount` of the distance (at most `maxPt`) past the target, peaking at `at`, and return. */
  | { type: 'follow_through'; amount: number; maxPt: number; at: number }
  /** Reach the target by `glideEnd`, then a damped wobble from `start` on. */
  | { type: 'spring'; amount: number; maxPt: number; cycles: number; decay: number; start: number; glideEnd: number };

/** A Cua bezier style (spec.ts `specForStyle`, params.ts defaults: handles 0.3 / 0.3, arc scale 1). */
interface ArcStyle {
  arcSize: number;
  arcFlow: number;
  ease: (t: number) => number;
  settle: Settle;
  duration: Fitts;
}

/** Minimum-jerk: the profile of a relaxed human reach. */
export const minJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);
const smootherstep = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const HANDLE = 0.3;
const ARC_STYLES: Partial<Record<CursorMotionStyle, ArcStyle>> = {
  signature_arc: {
    arcSize: 0.16,
    arcFlow: 0.15,
    ease: minJerk,
    settle: { type: 'follow_through', amount: 0.018, maxPt: 8, at: 0.82 },
    duration: fitts(1.1),
  },
  spring_settle: {
    arcSize: 0.12,
    arcFlow: 0,
    ease: minJerk,
    settle: { type: 'spring', amount: 0.05, maxPt: 6, cycles: 1.3, decay: 2.6, start: 0.55, glideEnd: 0.68 },
    duration: fitts(1.35),
  },
  comet_swoop: { arcSize: 0.24, arcFlow: 0.2, ease: inOutCubic, settle: { type: 'none' }, duration: fitts(1.15) },
};

/** plan.ts `magnetic`: a slight bow, accelerating to a cruise, then pulled in hard inside the snap radius. */
const MAGNETIC = { bow: 0.04, radiusPt: 40, pull: 0.45, enterSpeed: 300, maxSpeed: 1500, accel: 7000, approach: 5.5, snap: 26000 };
/** plan.ts `adaptive`: `fitts_minjerk` up to 900 pt, `keynote_swoop` beyond. */
const ADAPTIVE = {
  swoopFromPt: 900,
  bow: 0.02,
  duration: { a: 50, b: 150, minMs: 180, maxMs: 1400, scale: 1 } satisfies Fitts,
  /** Arc drawn from the move's seed, flow 0.2, in-out cubic, `350 + 0.35 D` ms clamped 450..1100. */
  swoop: { arcMin: 0.25, arcMax: 0.35, arcFlow: 0.2, baseMs: 350, msPerPt: 0.35, minMs: 450, maxMs: 1100 },
};
/** plan.ts `planClassic` with params.ts defaults: a Dubins glide of the arrow's body, then an arrival spring. */
const CLASSIC = {
  turnRadius: 80,
  peakSpeed: 900,
  minStartSpeed: 300,
  minEndSpeed: 200,
  /** `17 * spring / 0.72` with the default spring 0.72. */
  damping: 17,
  stiffness: 400,
  overshoot: 0.8,
  /** geom.ts `POINTER_ANCHOR_OFFSET`: the body point trails the tip by this much along the heading. */
  anchorPt: 16,
};

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

interface Pt {
  x: number;
  y: number;
}

const TAU = 2 * Math.PI;

const wrapAngle = (a: number) => {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r < -Math.PI) r += TAU;
  return r;
};

/** Base plus a smooth bump that pushes `over` past the end, peaking at `overAt`. */
function bumpProfile(base: (t: number) => number, over: number, overAt: number) {
  const a = Math.max(overAt * 10, 1.5);
  const b = Math.max((1 - overAt) * 10, 1.5);
  const peak = (a / (a + b)) ** a * (b / (a + b)) ** b;
  return (tau: number) => base(tau) + over * ((tau ** a * (1 - tau) ** b) / peak);
}

/** Damped wobble around the end from `start` on. */
function wobbleProfile(base: (t: number) => number, amp: number, cycles: number, decay: number, start: number) {
  return (tau: number) => {
    if (tau <= start) return base(tau);
    const u = (tau - start) / (1 - start);
    const ramp = smootherstep(Math.min(u / 0.18, 1));
    return (
      base(tau) +
      (amp * ramp * Math.exp(-decay * u) * Math.sin(TAU * cycles * u) * (1 - u) ** 2) / Math.max(Math.exp(-decay * 0.12) * 0.77, 1e-6)
    );
  };
}

const fittsMs = (d: Fitts, distance: number, width = DEFAULT_TARGET_PT) =>
  Math.min(Math.max(d.a + d.b * Math.log2(distance / Math.max(width, 4) + 1), d.minMs), d.maxMs) * d.scale;

/** `signature_arc` duration for a move of `distance` pt onto a `width` pt target. */
export function moveDurationMs(distance: number, width = DEFAULT_TARGET_PT) {
  return fittsMs((ARC_STYLES.signature_arc as ArcStyle).duration, distance, width);
}

/** A parametric path with an arc-length table, so speed curves act on distance. */
class Path {
  readonly length: number;
  private readonly us: Float64Array;
  private readonly ss: Float64Array;
  private readonly p0: Pt;
  private readonly p1: Pt;
  private readonly t0: Pt;
  private readonly t1: Pt;
  private readonly f: (u: number) => Pt;

  constructor(f: (u: number) => Pt, n: number) {
    this.f = f;
    this.us = new Float64Array(n + 1);
    this.ss = new Float64Array(n + 1);
    let prev = f(0);
    let total = 0;
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const p = f(u);
      total += Math.hypot(p.x - prev.x, p.y - prev.y);
      this.us[i] = u;
      this.ss[i] = total;
      prev = p;
    }
    this.length = total;
    this.p0 = f(0);
    this.p1 = f(1);
    this.t0 = unit(f(1e-3), this.p0);
    this.t1 = unit(f(1 - 1e-3), this.p1);
  }

  /** The point `frac` of the way along by distance; extrapolates past the ends. */
  atFraction(frac: number): Pt {
    const len = this.length;
    if (len < 1e-9) return this.f(Math.min(Math.max(frac, 0), 1));
    if (frac > 1) return { x: this.p1.x + this.t1.x * (frac - 1) * len, y: this.p1.y + this.t1.y * (frac - 1) * len };
    if (frac < 0) return { x: this.p0.x + this.t0.x * -frac * len, y: this.p0.y + this.t0.y * -frac * len };
    const target = frac * len;
    let lo = 0;
    let hi = this.ss.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.ss[mid] as number) < target) lo = mid;
      else hi = mid;
    }
    const slo = this.ss[lo] as number;
    let span = (this.ss[hi] as number) - slo;
    if (span === 0) span = 1;
    const ulo = this.us[lo] as number;
    return this.f(ulo + ((this.us[hi] as number) - ulo) * ((target - slo) / span));
  }
}

function unit(a: Pt, b: Pt): Pt {
  let d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d === 0) d = 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** The Cua bezier: control points along the chord, pushed sideways by `arcSize` of its length, peaking by `arcFlow`. */
function cuaPath(a: Pt, b: Pt, arcSize: number, arcFlow: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.max(Math.hypot(dx, dy), 1);
  const px = -dy / len;
  const py = dx / len;
  const deflection = len * arcSize;
  const flow = (arcFlow + 1) / 2;
  const c1d = deflection * (1 - 0.5 * flow);
  const c2d = deflection * (1 - 0.5 * (1 - flow));
  const c1 = { x: a.x + dx * HANDLE + px * c1d, y: a.y + dy * HANDLE + py * c1d };
  const c2 = { x: b.x - dx * HANDLE + px * c2d, y: b.y - dy * HANDLE + py * c2d };
  return new Path((u) => {
    const v = 1 - u;
    const k0 = v * v * v;
    const k1 = 3 * v * v * u;
    const k2 = 3 * v * u * u;
    const k3 = u * u * u;
    return { x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x, y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y };
  }, 256);
}

/** Gentle single-sided quadratic curve, bent `amount` of the chord at its middle. */
function bowPath(a: Pt, b: Pt, amount: number) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const u = unit(a, b);
  const c = { x: (a.x + b.x) / 2 - u.y * amount * d, y: (a.y + b.y) / 2 + u.x * amount * d };
  return new Path((s) => {
    const v = 1 - s;
    return { x: v * v * a.x + 2 * v * s * c.x + s * s * b.x, y: v * v * a.y + 2 * v * s * c.y + s * s * b.y };
  }, 256);
}

/** Chord side that bends paths upward for horizontal moves. */
const naturalSide = (a: Pt, b: Pt) => (unit(a, b).x >= 0 ? -1 : 1);

/** FNV-1a over UTF-16 code units, then mulberry32 (rng.ts): the same seed always draws the same numbers. */
function seededRandom(seed: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let state = h >>> 0 || 1;
  return () => {
    let t = (state = (state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Raw {
  t: number;
  x: number;
  y: number;
}

/** Pin the ends: the move starts and lands exactly on the requested points. */
function pinEnds(raw: Raw[], from: Pt, to: Pt) {
  const first = raw[0] as Raw;
  const last = raw[raw.length - 1] as Raw;
  first.x = from.x;
  first.y = from.y;
  last.x = to.x;
  last.y = to.y;
  return raw;
}

function sampleTimed(pos: (tau: number) => Pt, ms: number, from: Pt, to: Pt): Raw[] {
  const c = Math.ceil(ms / DT_MS);
  const n = Math.max(Number.isFinite(c) && c > 0 ? c : 0, 2);
  const out: Raw[] = [];
  for (let i = 0; i <= n; i++) {
    const tau = i / n;
    const p = pos(tau);
    out.push({ t: tau * ms, x: p.x, y: p.y });
  }
  return pinEnds(out, from, to);
}

/** plan.ts `generateSpec` for an arc style. */
function arcMove(from: Pt, to: Pt, style: ArcStyle): Raw[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const path = cuaPath(from, to, style.arcSize * naturalSide(from, to), style.arcFlow);
  const ms = fittsMs(style.duration, distance);
  const st = style.settle;
  let profile = style.ease;
  if (st.type === 'follow_through') {
    profile = bumpProfile(style.ease, Math.min(st.amount, st.maxPt / Math.max(distance, 1)), st.at);
  } else if (st.type === 'spring') {
    const ease = style.ease;
    const amp = Math.min(st.amount, st.maxPt / Math.max(distance, 1));
    profile = wobbleProfile((t) => ease(Math.min(t / st.glideEnd, 1)), amp, st.cycles, st.decay, st.start);
  }
  return sampleTimed((tau) => path.atFraction(profile(tau)), ms, from, to);
}

/** plan.ts `magnetic`: simulated at 120 Hz along a slight bow; at most 4 s. */
function magneticMove(from: Pt, to: Pt): Raw[] {
  const m = MAGNETIC;
  const path = bowPath(from, to, m.bow * naturalSide(from, to));
  const len = path.length;
  const radius = Math.min(m.radiusPt, len * 0.5);
  const out: Raw[] = [{ t: 0, x: from.x, y: from.y }];
  const dt = DT_MS / 1000;
  let s = 0;
  let v = 0;
  let t = 0;
  while (s < len && t < 4) {
    const rem = len - s;
    if (rem > radius) v = Math.min(m.maxSpeed, v + m.accel * dt, m.enterSpeed + m.approach * (rem - radius));
    else v += m.snap * m.pull * (radius / Math.max(rem, 6)) * dt;
    s = Math.min(len, s + v * dt);
    t += dt;
    const q = path.atFraction(s / len);
    out.push({ t: t * 1000, x: q.x, y: q.y });
  }
  return pinEnds(out, from, to);
}

/** plan.ts `adaptive` with the default target: `fitts_minjerk`, or `keynote_swoop` for long moves. */
function adaptiveMove(from: Pt, to: Pt, seed: string): Raw[] {
  const a = ADAPTIVE;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const side = naturalSide(from, to);
  if (distance <= a.swoopFromPt) {
    const path = bowPath(from, to, a.bow * side);
    return sampleTimed((tau) => path.atFraction(minJerk(tau)), fittsMs(a.duration, distance), from, to);
  }
  const w = a.swoop;
  const arc = w.arcMin + (w.arcMax - w.arcMin) * seededRandom(seed)();
  const path = cuaPath(from, to, arc * side, w.arcFlow);
  const ms = Math.min(Math.max(w.baseMs + w.msPerPt * distance, w.minMs), w.maxMs);
  return sampleTimed((tau) => path.atFraction(inOutCubic(tau)), ms, from, to);
}

const mod2pi = (x: number) => {
  const m = x - TAU * Math.floor(x / TAU);
  return m < 0 ? m + TAU : m;
};

/** dubins.ts: the shortest left/right/straight path between two headed points, `r` the turning radius. */
function dubinsPath(x0: number, y0: number, th0: number, x1: number, y1: number, th1: number, r: number) {
  type Seg = 'L' | 'R' | 'S';
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dd = Math.hypot(dx, dy);
  let best: { t: number; p: number; q: number; types: [Seg, Seg, Seg] } | undefined;
  if (dd >= 0.5) {
    const d = dd / r;
    const theta = mod2pi(Math.atan2(dy, dx));
    const a = mod2pi(th0 - theta);
    const b = mod2pi(th1 - theta);
    const sa = Math.sin(a);
    const sb = Math.sin(b);
    const ca = Math.cos(a);
    const cb = Math.cos(b);
    const cab = Math.cos(a - b);
    const candidates: Array<{ t: number; p: number; q: number; types: [Seg, Seg, Seg] } | undefined> = [];
    let p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
    if (p2 >= 0) {
      const k = Math.atan2(cb - ca, d + sa - sb);
      candidates.push({ t: mod2pi(-a + k), p: Math.sqrt(p2), q: mod2pi(b - k), types: ['L', 'S', 'L'] });
    }
    p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
    if (p2 >= 0) {
      const k = Math.atan2(ca - cb, d - sa + sb);
      candidates.push({ t: mod2pi(a - k), p: Math.sqrt(p2), q: mod2pi(-b + k), types: ['R', 'S', 'R'] });
    }
    p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
    if (p2 >= 0) {
      const p = Math.sqrt(p2);
      const k = Math.atan2(-(ca + cb), d + sa + sb) - Math.atan2(-2, p);
      candidates.push({ t: mod2pi(-a + k), p, q: mod2pi(-mod2pi(b) + k), types: ['L', 'S', 'R'] });
    }
    p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
    if (p2 >= 0) {
      const p = Math.sqrt(p2);
      const k = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
      candidates.push({ t: mod2pi(a - k), p, q: mod2pi(b - k), types: ['R', 'S', 'L'] });
    }
    let tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
    if (Math.abs(tmp) <= 1) {
      const p = mod2pi(TAU - Math.acos(tmp));
      const t = mod2pi(a - Math.atan2(ca - cb, d - sa + sb) + p / 2);
      candidates.push({ t, p, q: mod2pi(a - b - t + p), types: ['R', 'L', 'R'] });
    }
    tmp = (6 - d * d + 2 * cab + 2 * d * (sb - sa)) / 8;
    if (Math.abs(tmp) <= 1) {
      const p = mod2pi(TAU - Math.acos(tmp));
      const t = mod2pi(-a + Math.atan2(-ca + cb, d + sa - sb) + p / 2);
      candidates.push({ t, p, q: mod2pi(mod2pi(b) - a - t + p), types: ['L', 'R', 'L'] });
    }
    let bestLen = Number.POSITIVE_INFINITY;
    for (const sol of candidates) {
      const len = sol ? sol.t + sol.p + sol.q : Number.NaN;
      if (sol && Number.isFinite(len) && len >= 0 && len < bestLen) {
        bestLen = len;
        best = sol;
      }
    }
  }
  if (!best) {
    const length = Math.max(dd, 1);
    const diff = wrapAngle(th1 - th0);
    return {
      length,
      sample(s: number) {
        const u = Math.min(Math.max(s / length, 0), 1);
        return { x: x0 + dx * u, y: y0 + dy * u, heading: th0 + diff * u };
      },
    };
  }
  const sol = best;
  const lengths = [sol.t * r, sol.p * r, sol.q * r] as const;
  return {
    length: lengths[0] + lengths[1] + lengths[2],
    sample(sIn: number) {
      if (sIn <= 0) return { x: x0, y: y0, heading: th0 };
      let s = Math.min(sIn, lengths[0] + lengths[1] + lengths[2]);
      let x = x0;
      let y = y0;
      let th = th0;
      for (let i = 0; i < 3 && s > 0; i++) {
        const len = Math.min(s, lengths[i] as number);
        const seg = sol.types[i] as Seg;
        if (seg === 'S') {
          x += Math.cos(th) * len;
          y += Math.sin(th) * len;
        } else {
          const dth = (len / r) * (seg === 'L' ? 1 : -1);
          const side = seg === 'L' ? Math.PI / 2 : -Math.PI / 2;
          const cx = x + Math.cos(th + side) * r;
          const cy = y + Math.sin(th + side) * r;
          const ang = Math.atan2(y - cy, x - cx);
          x = cx + Math.cos(ang + dth) * r;
          y = cy + Math.sin(ang + dth) * r;
          th += dth;
        }
        s -= len;
      }
      return { x, y, heading: th };
    },
  };
}

/**
 * plan.ts `planClassic` with `native` timing: the arrow's body glides a Dubins path at a
 * smooth speed profile, the tip lands, then an arrival spring rings out. Returns the samples
 * and when the glide reached the target.
 */
function classicMove(from: Pt, to: Pt, fromHeading: number): [Raw[], number] {
  const c = CLASSIC;
  const dt = DT_MS / 1000;
  const ax = from.x + Math.cos(fromHeading) * c.anchorPt;
  const ay = from.y + Math.sin(fromHeading) * c.anchorPt;
  const tx = to.x + Math.cos(REST_HEADING) * c.anchorPt;
  const ty = to.y + Math.sin(REST_HEADING) * c.anchorPt;
  const path = dubinsPath(ax, ay, fromHeading + Math.PI, tx, ty, REST_HEADING + Math.PI, c.turnRadius);
  const pathLen = Math.max(path.length, 1);
  const out: Raw[] = [];
  const push = (t: number, x: number, y: number, heading: number) =>
    out.push({ t: t * 1000, x: x - Math.cos(heading) * c.anchorPt, y: y - Math.sin(heading) * c.anchorPt });
  push(0, ax, ay, fromHeading);
  let d = 0;
  let t = 0;
  let speed = 0;
  for (let guard = 0; d < pathLen && guard < 20000; guard++) {
    const u = Math.min(d / pathLen, 1);
    const profile = (30 * u * u * (1 - u) * (1 - u)) / 1.875;
    const floor = u < 0.5 ? c.minStartSpeed : c.minEndSpeed;
    speed = floor + (c.peakSpeed - floor) * profile;
    d += speed * dt;
    t += dt;
    if (d >= pathLen) break;
    const s = path.sample(d);
    push(t, s.x, s.y, s.heading + Math.PI);
  }
  const end = path.sample(pathLen);
  push(t, tx, ty, REST_HEADING);
  const arrival = t * 1000;
  let ox = 0;
  let oy = 0;
  let vx = speed * c.overshoot * Math.cos(end.heading);
  let vy = speed * c.overshoot * Math.sin(end.heading);
  for (let i = 0; i < 600; i++) {
    const sdt = dt / 4;
    for (let j = 0; j < 4; j++) {
      vx += (-c.stiffness * ox - c.damping * vx) * sdt;
      vy += (-c.stiffness * oy - c.damping * vy) * sdt;
      ox += vx * sdt;
      oy += vy * sdt;
    }
    t += dt;
    if (Math.hypot(ox, oy) < 0.3 && Math.hypot(vx, vy) < 2) break;
    push(t, tx + ox, ty + oy, REST_HEADING);
  }
  push(t + dt, tx, ty, REST_HEADING);
  return [pinEnds(out, from, to), arrival];
}

/**
 * A planned move: `[t, x, y, heading]` samples (t in ms from the move's start)
 * and the time the tip first reaches the target.
 */
export interface Trajectory {
  samples: Float64Array;
  arrivalMs: number;
  durationMs: number;
}

export interface PlanOptions {
  /** Heading the move starts from (a handed-off move); the rest heading by default. */
  fromHeading?: number;
  /** Cua's short straight glide without rotation or effects, whatever the style. */
  reducedMotion?: boolean;
  style?: CursorMotionStyle;
  /** Same seed, same motion. Only `adaptive`'s long swoop draws from it. */
  seed?: string;
}

/** Plans one move in a Cua style. */
export function planMove(from: Pt, to: Pt, options: PlanOptions = {}): Trajectory {
  const fromHeading = options.fromHeading ?? REST_HEADING;
  const style = options.style ?? DEFAULT_CURSOR_MOTION_STYLE;
  let raw: Raw[];
  let arrivalMs: number | undefined;
  if (options.reducedMotion) {
    raw = sampleTimed(
      (tau) => ({ x: from.x + (to.x - from.x) * minJerk(tau), y: from.y + (to.y - from.y) * minJerk(tau) }),
      REDUCED_MOTION_MS,
      from,
      to,
    );
  } else if (style === 'magnetic') raw = magneticMove(from, to);
  else if (style === 'adaptive') raw = adaptiveMove(from, to, options.seed ?? '');
  // The arrow stays upright, so the Dubins glide starts from the rest pose like Cua's own moves do.
  else if (style === 'classic') [raw, arrivalMs] = classicMove(from, to, REST_HEADING);
  else raw = arcMove(from, to, ARC_STYLES[style] ?? (ARC_STYLES.signature_arc as ArcStyle));
  // Upright pointer: CUA's tangent heading reads oddly as a mouse arrow in a debugging tool.
  return finish(raw, to, fromHeading, 'fixed', arrivalMs);
}

/** Heading: the tip turns toward the direction of travel once it is moving, smoothed, then settles to rest. */
function finish(raw: Raw[], to: Pt, fromHeading: number, mode: 'tangent' | 'fixed', arrival?: number): Trajectory {
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
  let arrivalMs = arrival ?? t;
  if (arrival === undefined) {
    for (let i = 0; i < out.length; i += 4) {
      if (Math.hypot((out[i + 1] as number) - to.x, (out[i + 2] as number) - to.y) <= ARRIVAL_TOLERANCE_PT) {
        arrivalMs = out[i] as number;
        break;
      }
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
 * to the recorded viewport so the cursor never leaves the page.
 */
export function onPage(points: readonly CursorPoint[], viewport?: { width: number; height: number }): CursorPoint[] {
  let start = 0;
  const opening = points[0];
  if (opening && opening.x <= ORIGIN_PT && opening.y <= ORIGIN_PT) {
    while (start < points.length - 1 && (points[start + 1] as CursorPoint).t - (points[start] as CursorPoint).t < SWEEP_GAP_MS) start++;
  }
  const kept = points.slice(start);
  if (!viewport) return kept.map((p) => ({ t: p.t, x: Math.max(0, p.x), y: Math.max(0, p.y) }));
  const maxX = viewport.width - 1;
  const maxY = viewport.height - 1;
  return kept.map((p) => ({ t: p.t, x: Math.min(Math.max(0, p.x), maxX), y: Math.min(Math.max(0, p.y), maxY) }));
}

/** Where the cursor comes to rest: rests, the ends, and waypoints inside long continuous runs. */
export function cursorTargets(points: readonly CursorPoint[]): CursorPoint[] {
  const targets: CursorPoint[] = [];
  let runStart: number | undefined;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as CursorPoint;
    const next = points[i + 1];
    const last = targets.at(-1);
    if (!last) {
      targets.push(p);
      continue;
    }
    runStart ??= p.t;
    const rest = !next || next.t - p.t >= REST_MS;
    if (!rest && p.t - runStart < WAYPOINT_MS) continue;
    runStart = undefined;
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.5) continue;
    targets.push(p);
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
  style: CursorMotionStyle;
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
  /**
   * Ms since the latest press while its click feedback plays (under CLICK_FX_MS), else -1. Themes draw their
   * ripple, pulse or press from it; -1 whenever feedback is off or under reduced motion.
   */
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
  options: { reducedMotion?: boolean; settings?: ReplayCursorSettings | undefined } = {},
): CursorTrack {
  const reducedMotion = options.reducedMotion ?? false;
  const style = options.settings?.motionStyle ?? DEFAULT_CURSOR_MOTION_STYLE;
  const targets = cursorTargets(onPage(input.points, input.viewport));
  const moves: Move[] = [];
  const pose: Pose = { visible: true, x: 0, y: 0, heading: REST_HEADING, scale: 1, opacity: 1 };
  for (let i = 1; i < targets.length; i++) {
    const from = targets[i - 1] as CursorPoint;
    const to = targets[i] as CursorPoint;
    // Seeded by the move's identity, never the clock, so viewer and export draw the same path.
    const seed = `${i}:${to.x},${to.y}`;
    let traj = planMove(from, to, { reducedMotion, style, seed });
    const start = Math.max(from.t, to.t - traj.arrivalMs);
    const previous = moves.at(-1);
    if (previous && start < previous.end) {
      sampleTrajectory(previous.traj, (start - previous.start) / previous.scale, pose);
      previous.end = start;
      traj = planMove({ x: pose.x, y: pose.y }, to, { fromHeading: pose.heading, reducedMotion, style, seed });
    }
    const available = to.t - start;
    const scale = available >= 1 ? Math.min(1, available / Math.max(traj.arrivalMs, 1)) : 0;
    moves.push({ start, end: scale > 0 ? start + traj.durationMs * scale : start, scale, traj });
  }
  const first = targets[0];
  const spans: Array<[number, number]> = moves.map((move) => [move.start, move.start + move.traj.durationMs * move.scale]);
  for (const press of input.presses) spans.push([press, press + CLICK_FX_MS]);
  return {
    // Shown from the start of the replay, resting where it first lands; never hidden, never sliding in from a corner.
    appearsAt: first ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    first,
    moves,
    starts: Float64Array.from(moves, (move) => move.start),
    presses: input.presses,
    ...mergeSpans(spans),
    reducedMotion,
    style,
    settings: options.settings,
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
