/* why: a suite's sheets leave one stack for separate tiles. Moving and growing together, they would cover each other
 * for nearly the whole flight; keeping their stacked size until they have spread out (and taking it early on the way
 * back) lets each one reach its own rectangle without crossing a neighbour.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One picture's rectangle where its flight starts and where it lands. */
export interface Flight {
  from: Box;
  to: Box;
}

const STEPS = 60;
const LAGS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

/**
 * How far a picture's size has got when its position is at `progress`: held at the stacked size until `lag` on the way
 * out, reached by `1 - lag` on the way back.
 */
export function sizeProgress(progress: number, lag: number, returning: boolean) {
  return returning ? Math.min(1, progress / (1 - lag)) : Math.max(0, (progress - lag) / (1 - lag));
}

function boxAt({ from, to }: Flight, progress: number, lag: number, returning: boolean): Box {
  const size = sizeProgress(progress, lag, returning);
  return {
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
    width: lerp(from.width, to.width, size),
    height: lerp(from.height, to.height, size),
  };
}

const overlap = (a: Box, b: Box) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;

function crossing(flights: readonly Flight[], progress: number, lag: number, returning: boolean) {
  const boxes = flights.map((flight) => boxAt(flight, progress, lag, returning));
  return boxes.some((box, index) => boxes.slice(index + 1).some((other) => overlap(box, other)));
}

/** The share of the flight, measured from its stacked end, until the last moment two pictures cover each other. */
export function stackedShare(flights: readonly Flight[], lag: number, returning: boolean) {
  let last = -1;
  for (let step = 0; step <= STEPS; step++) {
    const fromStack = step / STEPS;
    if (crossing(flights, returning ? 1 - fromStack : fromStack, lag, returning)) last = step;
  }
  return (last + 1) / (STEPS + 1);
}

/** The size lag that lets the pictures stop covering each other soonest; none for a single picture. */
export function fanLag(flights: readonly Flight[], returning: boolean) {
  if (flights.length < 2) return 0;
  let best = { lag: 0, share: stackedShare(flights, 0, returning) };
  for (const lag of LAGS) {
    const share = stackedShare(flights, lag, returning);
    if (share < best.share - 0.01) best = { lag, share };
  }
  return best.lag;
}
