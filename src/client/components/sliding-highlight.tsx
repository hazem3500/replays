import { type RefObject, useLayoutEffect, useRef } from 'react';
import { layerMoving, moveLayer, stopLayer } from '../lib/layer-motion.ts';

/**
 * A wrapping segmented control's selection move: 200 ms on a no-overshoot ease-out that settles like a critically damped
 * spring. Its text emphasis and figures use the same curve and length (`--strip-move` in compare.css).
 */
const ROW_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const ROW_GLIDE = { duration: 0.2, ease: ROW_EASE };

/** Changes faster than this apart (a held key, a scrub) move the highlight instantly. */
const RAPID_MS = 250;
/** Jumps across more than this many rows move it instantly, too. */
const MAX_GLIDE_ROWS = 4;

/**
 * One highlight element for a list's current row, instead of a background per row: it slides to the row
 * (Motion transform and height) and jumps when the move is not one to watch:
 * the first placement, a resize, rapid changes, jumps of more than four rows, or when `instant()` says so (a
 * scrub, a key repeat). The list must be the highlight's offset parent (position: relative).
 *
 * Call `place()` after the list has scrolled the row into view, so the highlight never travels through
 * off-screen space.
 */
export function useSlidingHighlight(
  list: RefObject<HTMLElement | null>,
  { selector, index, instant }: { selector: string; index: number; instant?: () => boolean },
) {
  const highlight = useRef<HTMLDivElement>(null);
  const last = useRef({ index: -1, at: 0, width: 0 });

  const place = () => {
    const element = highlight.current;
    const container = list.current;
    const row = container?.querySelector<HTMLElement>(selector);
    if (!element || !container) return;
    if (!row) {
      element.style.opacity = '0';
      return;
    }
    const previous = last.current;
    const now = performance.now();
    const jump =
      previous.index < 0 ||
      container.clientWidth !== previous.width ||
      now - previous.at < RAPID_MS ||
      Math.abs(index - previous.index) > MAX_GLIDE_ROWS ||
      Boolean(instant?.());
    moveLayer(element, { opacity: '1', transform: `translateY(${row.offsetTop}px)`, height: `${row.offsetHeight}px` }, jump);
    last.current = { index, at: now, width: container.clientWidth };
  };

  // Re-place without motion when the list resizes (a resizer drag, a font swap).
  useLayoutEffect(() => {
    const container = list.current;
    const element = highlight.current;
    if (!container) return;
    let width = container.clientWidth;
    const observer = new ResizeObserver(() => {
      // Only a width change moves rows (they reflow); height changes (a header count rolling) do not.
      if (container.clientWidth === width) return;
      width = container.clientWidth;
      last.current = { ...last.current, index: -1 };
      const row = container.querySelector<HTMLElement>(selector);
      if (!element || !row) return;
      moveLayer(element, { transform: `translateY(${row.offsetTop}px)`, height: `${row.offsetHeight}px` }, true);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      stopLayer(element);
    };
  }, [list, selector]);

  return { highlight, place };
}

/**
 * The horizontal sibling for segmented controls and tabs: one pill (or underline) that slides to the
 * selected cell (Motion transform and width). It jumps without motion on
 * the first placement (a popover opening), on resizes, and on rapid changes (a held arrow key).
 * `selector` finds the selected cell inside `container`; `value` is what changes when the selection does. `rows` is for a
 * control that wraps onto more than one line: the pill takes the cell's size outright and moves by transform alone
 * (compositor-only, so a busy main thread does not stall it) on ROW_GLIDE; a move to another line fades in place
 * instead of travelling diagonally across the grid.
 */
export function useSlidingPill(
  container: RefObject<HTMLElement | null>,
  { selector, value, rows = false }: { selector: string; value: unknown; rows?: boolean },
) {
  const pill = useRef<HTMLSpanElement>(null);
  const last = useRef({ at: 0, placed: false });

  useLayoutEffect(() => {
    const host = container.current;
    const element = pill.current;
    if (!host || !element) return;
    const place = (animate: boolean) => {
      const cell = host.querySelector<HTMLElement>(selector);
      if (!cell) {
        element.style.opacity = '0';
        return;
      }
      const target = `${cell.offsetLeft},${cell.offsetTop},${cell.offsetWidth},${cell.offsetHeight}`;
      // invariant: a placement toward where the pill is already headed is a no-op, so a re-render, a route change or an
      // observer report never restarts or snaps a glide in flight.
      if (element.dataset.target === target && element.style.opacity === '1') return;
      element.dataset.target = target;
      if (rows) {
        const line = String(cell.offsetTop);
        const otherLine = element.dataset.line !== undefined && element.dataset.line !== line;
        element.dataset.line = line;
        element.style.width = `${cell.offsetWidth}px`;
        element.style.height = `${cell.offsetHeight}px`;
        const transform = `translate(${cell.offsetLeft}px, ${cell.offsetTop}px)`;
        if (animate && otherLine) {
          moveLayer(element, { transform, opacity: '0' }, true);
          moveLayer(element, { opacity: '1' }, false, ROW_GLIDE);
        } else moveLayer(element, { opacity: '1', transform }, !animate, ROW_GLIDE);
        return;
      }
      moveLayer(element, { opacity: '1', width: `${cell.offsetWidth}px`, transform: `translateX(${cell.offsetLeft}px)` }, !animate);
    };
    // The selection this placement is for (also handy when inspecting the DOM).
    element.dataset.selected = String(value);
    const now = performance.now();
    place(last.current.placed && now - last.current.at > RAPID_MS);
    last.current = { at: now, placed: true };
    // why: labels and counts resize cells without resizing the control; at rest the pill follows at once, mid-glide it
    // retargets, so a reflow during a switch never snaps the glide.
    const observer = new ResizeObserver(() => place(layerMoving(element)));
    // Never the pill itself: its own width animates during a glide, and reacting to that would snap it.
    for (const cell of host.children) if (cell !== element) observer.observe(cell);
    return () => {
      observer.disconnect();
      stopLayer(element);
    };
  }, [container, selector, value, rows]);

  return pill;
}

const SELECTED = '[aria-selected="true"], [aria-current]:not([aria-current="false"]), [aria-pressed="true"]';

/** Whether an item is the container's current selection (a tab, a current row, a pressed flip or a checked radio's label). */
function isSelected(item: HTMLElement) {
  return item.matches(SELECTED) || Boolean(item.closest('label')?.querySelector('input:checked'));
}

/**
 * The hover layer: one subtle pill per container that glides to the item under the pointer (or, for menus and
 * selects, the item Base UI marks `data-highlighted`, so keyboard navigation glides the same way). It sits under
 * the items and under the active highlight, appears in place on first entry (no slide in from elsewhere), and
 * fades out when the pointer leaves. Transforms and opacity only; CSS hides it on coarse pointers.
 */
export function HoverGlide({
  container,
  itemSelector,
  followHighlighted = false,
}: {
  container: RefObject<HTMLElement | null>;
  /** Items the pill can sit on (direct targets of the pointer, matched with closest()). */
  itemSelector: string;
  /** Menus and selects: track `[data-highlighted]` (pointer and keyboard) instead of the hovered item. */
  followHighlighted?: boolean;
}) {
  const pill = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = pill.current;
    // Portalled popups (menus, selects) may not have filled the container ref yet: the pill lives inside it.
    const root = container.current ?? element?.parentElement ?? null;
    if (!root || !element) return;
    let shown = false;
    const place = (item: HTMLElement | null) => {
      if (!item || !root.contains(item)) {
        if (shown) {
          shown = false;
          element.dataset.visible = 'false';
          moveLayer(element, { opacity: '0' }, false, { duration: 0.18 });
        }
        return;
      }
      const box = item.getBoundingClientRect();
      const frame = root.getBoundingClientRect();
      const x = box.left - frame.left + root.scrollLeft - root.clientLeft;
      const y = box.top - frame.top + root.scrollTop - root.clientTop;
      // First entry: appear in place; afterwards glide.
      moveLayer(
        element,
        { transform: `translate(${x}px, ${y}px)`, width: `${box.width}px`, height: `${box.height}px`, ...(shown ? { opacity: '1' } : {}) },
        !shown,
        { duration: 0.14 },
      );
      if (!shown) {
        shown = true;
        moveLayer(element, { opacity: '1' }, false, { duration: 0.12 });
      }
      element.dataset.visible = 'true';
    };
    if (followHighlighted) {
      // itemSelector may be a list: the [data-highlighted] filter has to apply to every alternative.
      const highlighted = itemSelector
        .split(',')
        .map((selector) => `${selector.trim()}[data-highlighted]`)
        .join(', ');
      const sync = () => place(root.querySelector<HTMLElement>(highlighted));
      const observer = new MutationObserver(sync);
      observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-highlighted'] });
      sync();
      return () => {
        observer.disconnect();
        stopLayer(element);
      };
    }
    // invariant: hover never sits on the selection; when the hovered item becomes selected it fades as the selected
    // surface glides in, so the two never stack.
    let hovered: HTMLElement | null = null;
    const sync = () => place(hovered && !isSelected(hovered) ? hovered : null);
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      hovered = event.target instanceof Element ? event.target.closest<HTMLElement>(itemSelector) : null;
      sync();
    };
    const onLeave = () => {
      hovered = null;
      sync();
    };
    const selection = new MutationObserver(sync);
    selection.observe(root, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'aria-pressed'] });
    root.addEventListener('pointerover', onMove);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('change', sync);
    return () => {
      selection.disconnect();
      root.removeEventListener('pointerover', onMove);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('change', sync);
      stopLayer(element);
    };
  }, [container, followHighlighted, itemSelector]);
  return <div ref={pill} className="hover-glide" data-visible="false" aria-hidden="true" />;
}
