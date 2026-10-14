import { type RefObject, useLayoutEffect, useRef } from 'react';

/** Changes faster than this apart (a held key, a scrub) move the highlight instantly. */
const RAPID_MS = 250;
/** Jumps across more than this many rows move it instantly, too. */
const MAX_GLIDE_ROWS = 4;

/**
 * One highlight element for a list's current row, instead of a background per row: it slides to the row
 * (transform + height, CSS transition on `.sliding-highlight`) and jumps when the move is not one to watch:
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
    element.style.transition = jump ? 'none' : '';
    element.style.opacity = '1';
    element.style.transform = `translateY(${row.offsetTop}px)`;
    element.style.height = `${row.offsetHeight}px`;
    last.current = { index, at: now, width: container.clientWidth };
  };

  // Re-place without motion when the list resizes (a resizer drag, a font swap).
  useLayoutEffect(() => {
    const container = list.current;
    if (!container) return;
    let width = container.clientWidth;
    const observer = new ResizeObserver(() => {
      // Only a width change moves rows (they reflow); height changes (a header count rolling) do not.
      if (container.clientWidth === width) return;
      width = container.clientWidth;
      last.current = { ...last.current, index: -1 };
      const element = highlight.current;
      const row = container.querySelector<HTMLElement>(selector);
      if (!element || !row) return;
      element.style.transition = 'none';
      element.style.transform = `translateY(${row.offsetTop}px)`;
      element.style.height = `${row.offsetHeight}px`;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [list, selector]);

  return { highlight, place };
}

/**
 * The horizontal sibling for segmented controls and tabs: one pill (or underline) that slides to the
 * selected cell (transform + width; the CSS transition lives on the pill). It jumps without motion on
 * the first placement (a popover opening), on resizes, and on rapid changes (a held arrow key).
 * `selector` finds the selected cell inside `container`; `value` is what changes when the selection does.
 */
export function useSlidingPill(container: RefObject<HTMLElement | null>, { selector, value }: { selector: string; value: unknown }) {
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
      element.style.transition = animate ? '' : 'none';
      element.style.opacity = '1';
      element.style.width = `${cell.offsetWidth}px`;
      element.style.transform = `translateX(${cell.offsetLeft}px)`;
      if (!animate) void element.offsetWidth;
      element.style.transition = '';
    };
    // The selection this placement is for (also handy when inspecting the DOM).
    element.dataset.selected = String(value);
    const now = performance.now();
    place(last.current.placed && now - last.current.at > RAPID_MS);
    last.current = { at: now, placed: true };
    // Labels and counts change cell widths without resizing the control: watch every cell. A new observer
    // reports every cell once on observe(); only a real size change may move the pill instantly, otherwise
    // that first report would cancel the glide this selection change just started.
    const widths = new Map<Element, number>();
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        if (widths.has(entry.target) && widths.get(entry.target) !== width) changed = true;
        widths.set(entry.target, width);
      }
      if (changed) place(false);
    });
    // Never the pill itself: its own width animates during a glide, and reacting to that would snap it.
    for (const cell of host.children) if (cell !== element) observer.observe(cell);
    return () => observer.disconnect();
  }, [container, selector, value]);

  return pill;
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
        }
        return;
      }
      const box = item.getBoundingClientRect();
      const frame = root.getBoundingClientRect();
      const x = box.left - frame.left + root.scrollLeft - root.clientLeft;
      const y = box.top - frame.top + root.scrollTop - root.clientTop;
      // First entry: appear in place; afterwards glide.
      element.style.transition = shown ? '' : 'opacity 120ms var(--ease-out)';
      element.style.transform = `translate(${x}px, ${y}px)`;
      element.style.width = `${box.width}px`;
      element.style.height = `${box.height}px`;
      if (!shown) {
        shown = true;
        // Commit the position before fading in, so nothing slides from the previous spot.
        void element.offsetWidth;
        element.style.transition = '';
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
      return () => observer.disconnect();
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      place((event.target as Element | null)?.closest<HTMLElement>(itemSelector) ?? null);
    };
    const onLeave = () => place(null);
    root.addEventListener('pointerover', onMove);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      root.removeEventListener('pointerover', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [container, followHighlighted, itemSelector]);
  return <div ref={pill} className="hover-glide" data-visible="false" aria-hidden="true" />;
}
