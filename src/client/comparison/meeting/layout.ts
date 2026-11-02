export interface Size {
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Placement = Rect & { role: 'grid' | 'spotlight' | 'strip' };

export const GAP = 8;
const STRIP_SHARE = 0.2;
const STRIP_MIN = 132;
const STRIP_MAX = 220;

/** The aspect most tiles share (median width/height), so one cell shape fits the grid. */
export function cellAspect(aspects: readonly number[]) {
  const valid = aspects.filter((value) => Number.isFinite(value) && value > 0).toSorted((a, b) => a - b);
  return valid.length ? valid[Math.floor(valid.length / 2)]! : 16 / 10;
}

/** Columns that give each of `count` equal cells of `aspect` the largest area inside `box`. */
export function bestGrid(count: number, box: Size, aspect: number, gap = GAP) {
  let best = { columns: 1, rows: 1, width: 0, height: 0 };
  for (let columns = 1; columns <= Math.max(1, count); columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = (box.width - gap * (columns - 1)) / columns;
    const cellHeight = (box.height - gap * (rows - 1)) / rows;
    if (cellWidth <= 0 || cellHeight <= 0) continue;
    const width = Math.min(cellWidth, cellHeight * aspect);
    if (width > best.width) best = { columns, rows, width, height: width / aspect };
  }
  return best;
}

/** The grid: equal cells, the block centred, a short last row centred under the others. */
export function gridRects(count: number, box: Size, aspect: number, gap = GAP): Rect[] {
  if (count === 0) return [];
  const grid = bestGrid(count, box, aspect, gap);
  const blockHeight = grid.rows * grid.height + (grid.rows - 1) * gap;
  const top = Math.max(0, (box.height - blockHeight) / 2);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / grid.columns);
    const inRow = row === grid.rows - 1 ? count - row * grid.columns : grid.columns;
    const rowWidth = inRow * grid.width + (inRow - 1) * gap;
    const left = (box.width - rowWidth) / 2;
    return {
      x: left + (index % grid.columns) * (grid.width + gap),
      y: top + row * (grid.height + gap),
      width: grid.width,
      height: grid.height,
    };
  });
}

/**
 * Spotlight: one large tile and a filmstrip of the rest, beside it on wide stages and under it on tall ones.
 * Filmstrip tiles keep the grid aspect and shrink until they all fit along its edge.
 */
export function spotlightRects(count: number, spotlight: number, box: Size, aspect: number, gap = GAP) {
  const others = count - 1;
  const placements: Placement[] = [];
  if (count === 0) return { placements, strip: undefined as Rect | undefined, extent: 0 };
  if (others === 0) {
    const [rect] = gridRects(1, box, aspect, gap);
    return { placements: [{ ...rect!, role: 'spotlight' as const }], strip: undefined, extent: 0 };
  }
  const beside = box.width / box.height > aspect * 1.15;
  const stripDepth = Math.round(Math.min(STRIP_MAX, Math.max(STRIP_MIN, (beside ? box.width : box.height) * STRIP_SHARE)));
  const main: Size = beside
    ? { width: box.width - stripDepth - gap, height: box.height }
    : { width: box.width, height: box.height - stripDepth - gap };
  const [hero] = gridRects(1, main, aspect, gap);
  const strip: Rect = beside
    ? { x: main.width + gap, y: 0, width: stripDepth, height: box.height }
    : { x: 0, y: main.height + gap, width: box.width, height: stripDepth };
  const room = beside ? strip.height : strip.width;
  const natural = beside ? stripDepth / aspect : stripDepth * aspect;
  const step = Math.min(natural, (room - gap * (others - 1)) / others);
  const thumb = beside ? { width: step * aspect, height: step } : { width: step, height: step / aspect };
  const extent = others * step + (others - 1) * gap;
  const lead = Math.max(0, (room - extent) / 2);
  const crossLead = beside ? (stripDepth - thumb.width) / 2 : (stripDepth - thumb.height) / 2;
  let slot = 0;
  for (let index = 0; index < count; index++) {
    if (index === spotlight) {
      placements.push({ ...hero!, role: 'spotlight' });
      continue;
    }
    const along = lead + slot++ * (step + gap);
    placements.push({
      x: beside ? strip.x + crossLead : strip.x + along,
      y: beside ? strip.y + along : strip.y + crossLead,
      width: thumb.width,
      height: thumb.height,
      role: 'strip',
    });
  }
  return { placements, strip, extent };
}

/** The tile an arrow key moves focus to: the nearest one whose centre lies in that direction. */
export function neighbour(rects: readonly Rect[], from: number, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') {
  const origin = rects[from];
  if (!origin) return from;
  const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  const start = centre(origin);
  let best = from;
  let bestScore = Infinity;
  rects.forEach((rect, index) => {
    if (index === from) return;
    const point = centre(rect);
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const along = key === 'ArrowLeft' ? -dx : key === 'ArrowRight' ? dx : key === 'ArrowUp' ? -dy : dy;
    const across = key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) return;
    const score = along + across * 2;
    if (score >= bestScore) return;
    bestScore = score;
    best = index;
  });
  return best;
}
