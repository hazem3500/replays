/**
 * Path geometry and speed curves shared by the cursor motion styles. Ported
 * from Cua Cursor Motion (`@trycua/cursor-motion` src/path.ts, ease.ts and
 * geom.ts at f982ea0, MIT License, Copyright (c) 2025 Cua AI, Inc.); see
 * `cursor-motion.ts` for the full notice.
 */

export interface Pt {
  x: number;
  y: number;
}

/** One planned sample: ms from the move's start and the hotspot. */
export interface Raw {
  t: number;
  x: number;
  y: number;
}

/** Sample period of every planned move, ms (120 Hz). */
export const DT_MS = 1000 / 120;

/** Minimum-jerk: the profile of a relaxed human reach. */
export const minJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);
const smootherstep = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
export const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Base plus a smooth bump that pushes `over` past the end, peaking at `overAt`. */
export function bumpProfile(base: (t: number) => number, over: number, overAt: number) {
  const a = Math.max(overAt * 10, 1.5);
  const b = Math.max((1 - overAt) * 10, 1.5);
  const peak = (a / (a + b)) ** a * (b / (a + b)) ** b;
  return (tau: number) => base(tau) + over * ((tau ** a * (1 - tau) ** b) / peak);
}

/** Damped wobble of `amp` around the end, from `start` on. */
export function wobbleProfile(
  base: (t: number) => number,
  { amp, cycles, decay, start }: { amp: number; cycles: number; decay: number; start: number },
) {
  const norm = Math.max(Math.exp(-decay * 0.12) * 0.77, 1e-6);
  return (tau: number) => {
    if (tau <= start) return base(tau);
    const u = (tau - start) / (1 - start);
    const ramp = smootherstep(Math.min(u / 0.18, 1));
    return base(tau) + (amp * ramp * Math.exp(-decay * u) * Math.sin(2 * Math.PI * cycles * u) * (1 - u) ** 2) / norm;
  };
}

function unit(a: Pt, b: Pt): Pt {
  let d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d === 0) d = 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** A parametric path with an arc-length table, so speed curves act on distance. */
export class Path {
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

/** Arc knobs of the Cua bezier, as fractions of the chord. */
export interface ArcShape {
  startHandle: number;
  endHandle: number;
  /** Sideways bend; the sign picks the side. */
  arcSize: number;
  /** Where the bend peaks: -1 near the start, +1 near the end. */
  arcFlow: number;
}

/** The Cua bezier: control points along the chord, pushed sideways by `arcSize` of its length. */
export function cuaPath(a: Pt, b: Pt, shape: ArcShape) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.max(Math.hypot(dx, dy), 1);
  const px = -dy / len;
  const py = dx / len;
  const deflection = len * shape.arcSize;
  const flow = (shape.arcFlow + 1) / 2;
  const c1d = deflection * (1 - 0.5 * flow);
  const c2d = deflection * (1 - 0.5 * (1 - flow));
  const c1 = { x: a.x + dx * shape.startHandle + px * c1d, y: a.y + dy * shape.startHandle + py * c1d };
  const c2 = { x: b.x - dx * shape.endHandle + px * c2d, y: b.y - dy * shape.endHandle + py * c2d };
  return new Path((u) => {
    const v = 1 - u;
    const k0 = v * v * v;
    const k1 = 3 * v * v * u;
    const k2 = 3 * v * u * u;
    const k3 = u * u * u;
    return { x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x, y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y };
  }, 256);
}

/** A gentle single-sided quadratic curve bent by `amount` of the chord. */
export function bowPath(a: Pt, b: Pt, amount: number) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const u = unit(a, b);
  const c = { x: (a.x + b.x) / 2 - u.y * amount * d, y: (a.y + b.y) / 2 + u.x * amount * d };
  return new Path((s) => {
    const v = 1 - s;
    return { x: v * v * a.x + 2 * v * s * c.x + s * s * b.x, y: v * v * a.y + 2 * v * s * c.y + s * s * b.y };
  }, 256);
}

/** Chord side that bends paths upward for horizontal moves. */
export const naturalSide = (a: Pt, b: Pt) => (unit(a, b).x >= 0 ? -1 : 1);

/** Samples `pos` every DT_MS over `ms`, pinned so the move starts and lands exactly on `from` and `to`. */
export function sampleTimed(pos: (tau: number) => Pt, ms: number, from: Pt, to: Pt): Raw[] {
  const c = Math.ceil(ms / DT_MS);
  const n = Math.max(Number.isFinite(c) && c > 0 ? c : 0, 2);
  const out: Raw[] = [];
  for (let i = 0; i <= n; i++) {
    const tau = i / n;
    const p = pos(tau);
    out.push({ t: tau * ms, x: p.x, y: p.y });
  }
  return pin(out, from, to);
}

export function pin(samples: Raw[], from: Pt, to: Pt) {
  const first = samples[0];
  const last = samples.at(-1);
  if (first && last) {
    first.x = from.x;
    first.y = from.y;
    last.x = to.x;
    last.y = to.y;
  }
  return samples;
}
