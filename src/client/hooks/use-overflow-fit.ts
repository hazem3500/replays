import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * Which items of a row do not fit, pure: all fit, or keep a leading run that fits beside `reserve` (the "More"
 * control) plus `pinned` wherever it is, and hide the rest. Widths include each item's leading margin.
 */
function fitItems(ids: readonly string[], widths: readonly number[], gap: number, available: number, reserve: number, pinned?: string) {
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available + 0.5) return [];
  const pinnedIndex = pinned === undefined ? -1 : ids.indexOf(pinned);
  let used = pinnedIndex >= 0 ? widths[pinnedIndex]! : 0;
  const budget = available - reserve;
  const hidden: string[] = [];
  let full = false;
  ids.forEach((id, index) => {
    if (index === pinnedIndex) return;
    const next = used + gap + widths[index]!;
    if (!full && next <= budget + 0.5) used = next;
    else {
      // invariant: once one item spills, every later one does too, so the visible tabs keep their order.
      full = true;
      hidden.push(id);
    }
  });
  return hidden;
}

const NONE: readonly string[] = [];

function same(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Measures a row's items (matched by `selector`, identified by `attribute`) against the row's width and returns the
 * ids that must go behind `more`. Hidden items stay in the DOM out of flow (CSS), so they remain measurable; `more`
 * is measurable while empty for the same reason. Items added or removed later are picked up as they mount.
 */
export function useOverflowFit(
  row: RefObject<HTMLElement | null>,
  more: RefObject<HTMLElement | null>,
  { selector, attribute, pinned, enabled = true }: { selector: string; attribute: string; pinned?: string; enabled?: boolean },
) {
  const [hidden, setHidden] = useState<readonly string[]>([]);
  useLayoutEffect(() => {
    const root = row.current;
    if (!root || !enabled) return;
    const measure = () => {
      const items = Array.from(root.querySelectorAll<HTMLElement>(selector));
      const widths = items.map((item) => item.offsetWidth + (Number.parseFloat(getComputedStyle(item).marginInlineStart) || 0));
      const ids = items.map((item) => item.getAttribute(attribute) ?? '');
      const control = more.current;
      const reserve = control?.offsetWidth ?? 0;
      // why: while "More" shows it takes room from the row; adding it back keeps the answer from flip-flopping.
      const available = root.clientWidth + (control && !control.hasAttribute('data-empty') ? reserve : 0);
      const gap = Number.parseFloat(getComputedStyle(root).columnGap) || 0;
      const next = fitItems(ids, widths, gap, available, reserve, pinned);
      setHidden((current) => (same(current, next) ? current : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    const observe = () => {
      observer.observe(root);
      for (const item of root.querySelectorAll(selector)) observer.observe(item);
    };
    observe();
    // why: a tab mounting or leaving (a plugin loading) changes the row without resizing anything yet.
    const mutations = new MutationObserver(() => {
      observe();
      measure();
    });
    mutations.observe(root, { childList: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [row, more, selector, attribute, pinned, enabled]);
  return enabled ? hidden : NONE;
}
