import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual';
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** One virtual item: its stable key, a size guess until it is measured, and whether it always stays rendered. */
export interface VirtualRowSpec {
  key: string;
  estimate: number;
  pinned: boolean;
}

/** A group list's own spacing: the gap after each row and the padding after its last one. */
export interface ListSpacing {
  gap: number;
  padEnd: number;
}

const NO_SPACING: ListSpacing = { gap: 0, padEnd: 0 };
/** The window before it is measured: tall enough for a desktop's first screen of rows. */
const FIRST_SCREEN = { width: 1280, height: 1000 };
const px = (value: string) => Number.parseFloat(value) || 0;

/**
 * A rendered item's size as the page spends it, so the items' sizes add up to the document's real layout: a day
 * heading counts its list's top padding; a row counts the gap after it, or its list's end padding when it is the
 * group's last (`data-last`).
 */
function measureRow(element: HTMLElement) {
  if (element.dataset.measure === 'head') {
    const list = element.nextElementSibling;
    return element.offsetHeight + (list ? px(getComputedStyle(list).paddingTop) : 0);
  }
  // why: a grid suite's box reaches up into the gap above it by a negative top margin (feed.css --peek).
  const height = element.offsetHeight + px(getComputedStyle(element).marginTop);
  const list = element.closest('ul');
  if (!list) return height;
  const style = getComputedStyle(list);
  return height + px(element.dataset.last === undefined ? style.rowGap : style.paddingBottom);
}

function sameSpacing(a: ReadonlyMap<string, ListSpacing>, b: ReadonlyMap<string, ListSpacing>) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || other.gap !== value.gap || other.padEnd !== value.padEnd) return false;
  }
  return true;
}

/**
 * The feed's window virtualization (TanStack Virtual, which stays inside this hook; callers get plain values):
 * which items to render, every item's size (measured, or its estimate), the ref that measures a rendered item
 * (`data-index`, plus `data-measure="head"` or `data-last`), and each group list's spacing (`ul[data-group]`).
 * Pinned items and the row holding keyboard focus (`[data-row]`) always stay rendered, so recycling never drops
 * focus. When `enabled` is false every item renders.
 */
export function useFeedVirtualizer(
  root: RefObject<HTMLElement | null>,
  rows: readonly VirtualRowSpec[],
  options: { enabled: boolean; overscan: number },
) {
  // why: the virtualizer's outputs change while the instance stays the same object; memoising on it would freeze them.
  'use no memo';
  const [margin, setMargin] = useState(0);
  const [spacing, setSpacing] = useState<ReadonlyMap<string, ListSpacing>>(() => new Map());
  const focused = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const read = () => {
      const top = Math.round(node.getBoundingClientRect().top + window.scrollY);
      setMargin((current) => (current === top ? current : top));
      const next = new Map<string, ListSpacing>();
      for (const list of node.querySelectorAll<HTMLElement>('ul[data-group]')) {
        const style = getComputedStyle(list);
        next.set(list.dataset.group ?? '', { gap: px(style.rowGap), padEnd: px(style.paddingBottom) });
      }
      setSpacing((current) => (sameSpacing(current, next) ? current : next));
    };
    read();
    // why: the feed's own size changes with its view, breakpoint and groups; the page's with the header above it.
    const observer = new ResizeObserver(read);
    observer.observe(node);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const enter = (event: FocusEvent) => {
      const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-row]') : null;
      focused.current = row ? Number(row.dataset.row) : undefined;
    };
    const leave = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && node.contains(event.relatedTarget))) focused.current = undefined;
    };
    node.addEventListener('focusin', enter);
    node.addEventListener('focusout', leave);
    return () => {
      node.removeEventListener('focusin', enter);
      node.removeEventListener('focusout', leave);
    };
  }, [root]);

  const pinned = rows.flatMap((row, index) => (row.pinned ? [index] : []));
  // oxlint-disable-next-line react/incompatible-library -- why: the virtualizer is a mutable instance the compiler can't memoise; only its plain outputs leave this hook.
  const virtualizer = useWindowVirtualizer<HTMLElement>({
    count: rows.length,
    estimateSize: (index) => rows[index]?.estimate ?? 0,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: options.overscan,
    // why: a server render (and the hydration that follows it) has no window to measure: it lays out the first screen.
    initialRect: FIRST_SCREEN,
    scrollMargin: margin,
    measureElement: measureRow,
    rangeExtractor: (range) => {
      if (!options.enabled) return rows.map((_, index) => index);
      const extra = focused.current === undefined ? pinned : [...pinned, focused.current];
      return [...new Set([...defaultRangeExtractor(range), ...extra])].sort((a, b) => a - b);
    },
  });
  const items = virtualizer.getVirtualItems();
  // why: before the virtualizer has measured the window its range is empty; a short feed must never wait for that.
  const rendered = new Set(options.enabled ? items.map((item) => item.index) : rows.map((_, index) => index));
  return {
    rendered,
    sizes: rows.map((row, index) => virtualizer.measurementsCache[index]?.size ?? row.estimate),
    measure: virtualizer.measureElement,
    spacing: (group: string) => spacing.get(group) ?? NO_SPACING,
  };
}
