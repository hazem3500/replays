/**
 * Dubins arc-straight-arc planner behind the `classic` cursor glide. Ported
 * from Cua Cursor Motion (`@trycua/cursor-motion` src/dubins.ts at f982ea0,
 * MIT License, Copyright (c) 2025 Cua AI, Inc.); see `cursor-motion.ts`.
 */

type Seg = 'L' | 'R' | 'S';

interface PathState {
  x: number;
  y: number;
  heading: number;
}

interface PlannedPath {
  length: number;
  sample(distance: number): PathState;
}

interface Sol {
  t: number;
  p: number;
  q: number;
  types: [Seg, Seg, Seg];
}

const TAU = 2 * Math.PI;

function mod2pi(x: number) {
  const r = x - TAU * Math.floor(x / TAU);
  return r < 0 ? r + TAU : r;
}

function lsl(d: number, a: number, b: number): Sol | null {
  const p2 = 2 + d * d - 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) - Math.sin(b));
  if (p2 < 0) return null;
  const tmp = Math.atan2(Math.cos(b) - Math.cos(a), d + Math.sin(a) - Math.sin(b));
  return { t: mod2pi(-a + tmp), p: Math.sqrt(p2), q: mod2pi(b - tmp), types: ['L', 'S', 'L'] };
}

function rsr(d: number, a: number, b: number): Sol | null {
  const p2 = 2 + d * d - 2 * Math.cos(a - b) + 2 * d * (Math.sin(b) - Math.sin(a));
  if (p2 < 0) return null;
  const tmp = Math.atan2(Math.cos(a) - Math.cos(b), d - Math.sin(a) + Math.sin(b));
  return { t: mod2pi(a - tmp), p: Math.sqrt(p2), q: mod2pi(-b + tmp), types: ['R', 'S', 'R'] };
}

function lsr(d: number, a: number, b: number): Sol | null {
  const p2 = -2 + d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) + Math.sin(b));
  if (p2 < 0) return null;
  const p = Math.sqrt(p2);
  const tmp = Math.atan2(-(Math.cos(a) + Math.cos(b)), d + Math.sin(a) + Math.sin(b)) - Math.atan2(-2, p);
  return { t: mod2pi(-a + tmp), p, q: mod2pi(-mod2pi(b) + tmp), types: ['L', 'S', 'R'] };
}

function rsl(d: number, a: number, b: number): Sol | null {
  const p2 = d * d - 2 + 2 * Math.cos(a - b) - 2 * d * (Math.sin(a) + Math.sin(b));
  if (p2 < 0) return null;
  const p = Math.sqrt(p2);
  const tmp = Math.atan2(Math.cos(a) + Math.cos(b), d - Math.sin(a) - Math.sin(b)) - Math.atan2(2, p);
  return { t: mod2pi(a - tmp), p, q: mod2pi(b - tmp), types: ['R', 'S', 'L'] };
}

function rlr(d: number, a: number, b: number): Sol | null {
  const tmp = (6 - d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) - Math.sin(b))) / 8;
  if (Math.abs(tmp) > 1) return null;
  const p = mod2pi(TAU - Math.acos(tmp));
  const t = mod2pi(a - Math.atan2(Math.cos(a) - Math.cos(b), d - Math.sin(a) + Math.sin(b)) + p / 2);
  return { t, p, q: mod2pi(a - b - t + p), types: ['R', 'L', 'R'] };
}

function lrl(d: number, a: number, b: number): Sol | null {
  const tmp = (6 - d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(b) - Math.sin(a))) / 8;
  if (Math.abs(tmp) > 1) return null;
  const p = mod2pi(TAU - Math.acos(tmp));
  const t = mod2pi(-a + Math.atan2(-Math.cos(a) + Math.cos(b), d + Math.sin(a) - Math.sin(b)) + p / 2);
  return { t, p, q: mod2pi(mod2pi(b) - a - t + p), types: ['L', 'R', 'L'] };
}

/** The shortest path from `(x0, y0)` heading `th0` to `(x1, y1)` heading `th1` that never turns tighter than `turnRadius`. */
export function planDubins(x0: number, y0: number, th0: number, x1: number, y1: number, th1: number, turnRadius: number): PlannedPath {
  const r = Math.max(turnRadius, 1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dd = Math.hypot(dx, dy);
  let best: Sol | null = null;
  if (dd >= 0.5) {
    const d = dd / r;
    const theta = mod2pi(Math.atan2(dy, dx));
    const a = mod2pi(th0 - theta);
    const b = mod2pi(th1 - theta);
    let bestLen = Number.POSITIVE_INFINITY;
    for (const solver of [lsl, rsr, lsr, rsl, rlr, lrl]) {
      const sol = solver(d, a, b);
      if (!sol) continue;
      const len = sol.t + sol.p + sol.q;
      if (Number.isFinite(len) && len >= 0 && len < bestLen) {
        bestLen = len;
        best = sol;
      }
    }
  }
  if (!best) {
    const length = Math.max(dd, 1);
    let diff = (th1 - th0) % TAU;
    if (diff > Math.PI) diff -= TAU;
    if (diff < -Math.PI) diff += TAU;
    return {
      length,
      sample(s) {
        const u = Math.min(Math.max(s / length, 0), 1);
        return { x: x0 + dx * u, y: y0 + dy * u, heading: th0 + diff * u };
      },
    };
  }
  const sol = best;
  const l1 = sol.t * r;
  const l2 = sol.p * r;
  const l3 = sol.q * r;
  return {
    length: l1 + l2 + l3,
    sample(distance) {
      if (distance <= 0) return { x: x0, y: y0, heading: th0 };
      const s = Math.min(distance, l1 + l2 + l3);
      const state = { x: x0, y: y0, heading: th0 };
      const advance = (len: number, seg: Seg) => {
        if (seg === 'S') {
          state.x += Math.cos(state.heading) * len;
          state.y += Math.sin(state.heading) * len;
          return;
        }
        const turn = (len / r) * (seg === 'L' ? 1 : -1);
        const side = seg === 'L' ? Math.PI / 2 : -Math.PI / 2;
        const cx = state.x + Math.cos(state.heading + side) * r;
        const cy = state.y + Math.sin(state.heading + side) * r;
        const angle = Math.atan2(state.y - cy, state.x - cx);
        state.x = cx + Math.cos(angle + turn) * r;
        state.y = cy + Math.sin(angle + turn) * r;
        state.heading += turn;
      };
      advance(Math.min(s, l1), sol.types[0]);
      if (s > l1) advance(Math.min(s - l1, l2), sol.types[1]);
      if (s > l1 + l2) advance(s - l1 - l2, sol.types[2]);
      return state;
    },
  };
}
