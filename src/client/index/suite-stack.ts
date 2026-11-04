/** The rear sheets a suite stack shows. Past them sits one hidden reserve, so six runs look like four. */
export const SHOWN_SHEETS = 3;

/**
 * How far each rear sheet lifts above the one in front of it, at rest and fanned on hover, in px.
 * invariant: SHOWN_SHEETS lifts stay inside a list row's top padding and a grid suite's `--peek` (feed.css).
 */
export const SHEET_LIFT = { list: { rest: 3, hover: 3.5 }, grid: { rest: 4, hover: 5 } } as const;

/** The depths of a suite's rear sheets, deepest first: up to SHOWN_SHEETS exposed and one buried reserve. */
export function stackLayers(runCount: number): number[] {
  const count = Math.min(SHOWN_SHEETS + 1, Math.max(0, runCount - 1));
  return Array.from({ length: count }, (_, index) => count - index);
}
