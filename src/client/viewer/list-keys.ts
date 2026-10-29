/** How a key moves the focus through a list of rows: one step, or to either end. */
export type StepMove = 1 | -1 | 'first' | 'last';

export const KEY_MOVES: Readonly<Partial<Record<string, StepMove>>> = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' };

/** The row index a move lands on, clamped to the list. */
export function moveIndex(move: StepMove, index: number, count: number) {
  if (move === 'first') return 0;
  if (move === 'last') return count - 1;
  return Math.min(count - 1, Math.max(0, index + move));
}

/** The row a pointer or focus event landed in, from its `data-row-id`. */
export function rowIdOf(target: EventTarget) {
  const row = target instanceof Element ? target.closest<HTMLElement>('[data-row-id]') : null;
  return row?.dataset.rowId;
}
