import { type RefObject, useLayoutEffect, useRef } from 'react';

/** Selections closer together than this (a held arrow key) move the indicator without gliding. */
const RAPID_MS = 250;
/** The indicator's layout width; its rendered width is a scaleX of it, so a glide never relayouts. */
export const INDICATOR_BASE = 100;

interface Placement {
  at: number;
  placed: boolean;
  target: string;
}

function place(element: HTMLElement | null, last: { current: Placement }, cell: HTMLElement, animate: boolean) {
  if (!element) return;
  const target = `${cell.offsetLeft}:${cell.offsetWidth}`;
  if (target === last.current.target && last.current.placed) return;
  element.style.transition = animate ? '' : 'none';
  element.style.opacity = '1';
  element.style.transform = `translateX(${cell.offsetLeft}px) scaleX(${cell.offsetWidth / INDICATOR_BASE})`;
  if (!animate) {
    void element.offsetWidth;
    element.style.transition = '';
  }
  last.current = { at: performance.now(), placed: true, target };
}

const glides = (last: Placement) => last.placed && performance.now() - last.at > RAPID_MS;

/** A scrolling row (phones) marks which edges hide tabs, so CSS can fade them. */
export function markScrollEdges(row: HTMLElement) {
  const scrollable = row.scrollWidth > row.clientWidth + 1;
  row.toggleAttribute('data-fade-start', scrollable && row.scrollLeft > 1);
  row.toggleAttribute('data-fade-end', scrollable && row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
}

/** Brings the tab fully into a scrolling row's view (no-op when the row does not scroll). */
function reveal(row: HTMLElement, cell: HTMLElement, smooth: boolean) {
  if (row.scrollWidth <= row.clientWidth + 1) return;
  const pad = 24;
  const left = cell.offsetLeft - pad;
  const right = cell.offsetLeft + cell.offsetWidth + pad - row.clientWidth;
  const target = left < row.scrollLeft ? left : right > row.scrollLeft ? right : row.scrollLeft;
  if (target !== row.scrollLeft) row.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'instant' });
}

/**
 * A tab row's underline: one element that glides to the selected tab with transform only (translateX + scaleX), so
 * the compositor keeps it moving even while the newly selected panel renders. `moveTo` starts the glide from the
 * click itself (and marks the tab `data-pending` until the selection commits); the layout effect keeps it on the
 * selected tab across renders and resizes. Jumps on first placement, resizes and rapid changes; CSS turns the
 * transition off under reduced motion.
 */
export function useTabIndicator(row: RefObject<HTMLElement | null>, { selector, value }: { selector: string; value: string }) {
  const indicator = useRef<HTMLSpanElement>(null);
  const last = useRef<Placement>({ at: 0, placed: false, target: '' });

  const moveTo = (cell: HTMLElement) => {
    for (const pending of row.current?.querySelectorAll('[data-pending]') ?? []) pending.removeAttribute('data-pending');
    cell.setAttribute('data-pending', '');
    const animate = glides(last.current);
    place(indicator.current, last, cell, animate);
    if (row.current) reveal(row.current, cell, animate && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  useLayoutEffect(() => {
    const host = row.current;
    const element = indicator.current;
    if (!host || !element) return;
    element.dataset.selected = value;
    for (const pending of host.querySelectorAll('[data-pending]')) pending.removeAttribute('data-pending');
    const sync = (animate: boolean) => {
      const cell = host.querySelector<HTMLElement>(selector);
      if (cell) {
        place(element, last, cell, animate);
        reveal(host, cell, false);
      } else element.style.opacity = '0';
      markScrollEdges(host);
    };
    sync(glides(last.current));
    if (typeof ResizeObserver === 'undefined') return;
    // why: labels and badges change tab widths without a new selection; follow them without motion.
    const observer = new ResizeObserver(() => sync(false));
    for (const cell of host.children) if (cell !== element) observer.observe(cell);
    return () => observer.disconnect();
  }, [row, selector, value]);

  return { indicator, moveTo };
}
