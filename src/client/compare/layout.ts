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
export type Placement = Rect & { role: 'grid' | 'spotlight' | 'strip' | 'single' | 'hidden' };

export const GAP = 8;

/**
 * Phones swipe through full-width tiles under a swatch switcher, the one place to switch recordings there; the
 * headline strip stands down wherever this is true.
 */
export const showsPhoneSwitch = ({ mobile, layout, count }: { mobile: boolean; layout: 'single' | 'grid' | 'spotlight'; count: number }) =>
  mobile && layout !== 'single' && count > 1;
const STRIP_SHARE = 0.2;
const STRIP_MIN = 132;
const STRIP_MAX = 220;

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

/** Where the strip goes: beside the spotlight on wide stages, under it on tall ones. */
function stripFor(box: Size, aspect: number, gap: number) {
  const beside = box.width / box.height > aspect * 1.15;
  const depth = Math.round(Math.min(STRIP_MAX, Math.max(STRIP_MIN, (beside ? box.width : box.height) * STRIP_SHARE)));
  if (beside)
    return {
      main: { width: box.width - depth - gap, height: box.height },
      strip: { x: box.width - depth, y: 0, width: depth, height: box.height },
      beside,
    };
  return {
    main: { width: box.width, height: box.height - depth - gap },
    strip: { x: 0, y: box.height - depth, width: box.width, height: depth },
    beside,
  };
}

/**
 * Spotlight: one large tile and a strip of the rest, beside it on wide stages and under it on tall ones. Strip
 * tiles keep the grid aspect and shrink until they all fit along its edge.
 */
export function spotlightRects(count: number, spotlight: number, box: Size, aspect: number): Placement[] {
  const gap = GAP;
  const [hero] = gridRects(1, count > 1 ? stripFor(box, aspect, gap).main : box, aspect, gap);
  if (!hero) return [];
  if (count === 1) return [{ ...hero, role: 'spotlight' }];
  const { strip, beside } = stripFor(box, aspect, gap);
  const others = count - 1;
  const depth = beside ? strip.width : strip.height;
  const room = beside ? strip.height : strip.width;
  const step = Math.min(beside ? depth / aspect : depth * aspect, (room - gap * (others - 1)) / others);
  const thumb = beside ? { width: step * aspect, height: step } : { width: step, height: step / aspect };
  const lead = Math.max(0, (room - (others * step + (others - 1) * gap)) / 2);
  const cross = (depth - (beside ? thumb.width : thumb.height)) / 2;
  return Array.from({ length: count }, (_, index): Placement => {
    if (index === spotlight) return { ...hero, role: 'spotlight' };
    const along = lead + (index < spotlight ? index : index - 1) * (step + gap);
    const x = beside ? strip.x + cross : strip.x + along;
    const y = beside ? strip.y + along : strip.y + cross;
    return { x, y, ...thumb, role: 'strip' };
  });
}

/**
 * Every tile's place for a layout, in tile order. Single gives the focused tile the whole stage and leaves the
 * others where the grid would put them, hidden, so they glide back in from there.
 */
export function placementsFor({
  layout,
  count,
  focus,
  box,
  aspect,
}: {
  layout: 'single' | 'grid' | 'spotlight';
  count: number;
  /** The focused tile's index. */
  focus: number;
  box: Size;
  aspect: number;
}): Placement[] {
  if (!(box.width > 0 && box.height > 0) || count === 0) return [];
  if (layout === 'spotlight' && count > 1) return spotlightRects(count, Math.max(0, focus), box, aspect);
  const grid = gridRects(count, box, aspect).map((rect) => ({ ...rect, role: 'grid' as const }));
  if (layout !== 'single') return grid;
  return grid.map((rect, index) =>
    index === focus ? { x: 0, y: 0, width: box.width, height: box.height, role: 'single' as const } : { ...rect, role: 'hidden' as const },
  );
}
