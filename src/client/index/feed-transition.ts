import { flushSync } from 'react-dom';

/**
 * Feed changes (sort, filters, search results, list/grid, a refresh that brings new items) as one
 * View Transition in which every feed item on or near the screen is its own layer (feed.css):
 * - items that stay glide to their new place (and morph between list and grid);
 * - items that leave fade out and shrink to 0.98 (140 ms, all at once);
 * - items that arrive rise 10 px and grow from 0.98 (260 ms, soft spring), 25 ms apart, at most the first
 *   12 (the rest just appear);
 * - the header is its own live layer, so it never fades.
 * With more than 60 items near the screen the change is a plain crossfade (no per-item layers).
 * List ↔ grid moves only the thumbnails (each glides and grows into its new place) while the text crossfades:
 * morphing whole rows into cards would stretch their text mid-flight.
 *
 * Changes made from inside an open popup skip the transition (updateUnderPopup), so the popup stays on top.
 *
 * Never queued: a change while one runs (or within REPEAT_MS of the last, e.g. a held key repeating) finishes the running one at once and applies instantly, after the running one's own change, so the
 * last key always wins. Reduced motion, no View Transitions support, or a page transition still running: the
 * change just applies.
 */
const REPEAT_MS = 250;
const MAX_LAYERS = 60;
const MAX_STAGGERED = 12;
const STAGGER_MS = 25;
/** Same curve as --vt-spring (styles.css): a soft settle with ~2.5 % overshoot. */
const SPRING = 'linear(0, 0.24 8%, 0.58 19%, 0.85 31%, 0.99 44%, 1.025 56%, 1.015 70%, 1)';

let running: ViewTransition | undefined;
/** The running transition's update, until its callback runs (after the old view is captured). */
let pending: (() => void) | undefined;
let lastAt = Number.NEGATIVE_INFINITY;

/** A valid <custom-ident> per entry id ("session:abc" → "feed-session_3aabc"). */
function layerName(id: string) {
  return `feed-${id.replace(/[^a-zA-Z0-9_-]/g, (character) => `_${character.charCodeAt(0).toString(16)}`)}`;
}

/** What becomes a layer: whole items, or (list ↔ grid) just their thumbnails. */
type Layer = 'item' | 'poster';
let layer: Layer = 'item';

const target = (item: HTMLElement) =>
  layer === 'item' ? item : item.querySelector<HTMLElement>(':scope > .poster, :scope > .poster-stack .stack-front > .poster');

/** Names the feed items on or near the screen; returns their ids in document order (empty: too many to name). */
function nameItems(): string[] {
  const items = [...document.querySelectorAll<HTMLElement>('.feed-list [data-entry-id]')];
  const height = window.innerHeight;
  // Read every box first, then write: no layout thrash.
  const near = items.filter((item) => {
    const box = item.getBoundingClientRect();
    return box.bottom > -height / 2 && box.top < height * 1.5;
  });
  if (near.length > MAX_LAYERS) return [];
  for (const item of near) {
    const element = target(item);
    element?.style.setProperty('view-transition-name', layerName(item.dataset.entryId!));
    element?.style.setProperty('view-transition-class', layer === 'item' ? 'feed-item' : 'feed-poster');
  }
  return near.map((item) => item.dataset.entryId!);
}

function unnameItems() {
  for (const element of document.querySelectorAll<HTMLElement>('.feed-list [style*="view-transition-name"]')) {
    element.style.removeProperty('view-transition-name');
    element.style.removeProperty('view-transition-class');
  }
}

/** Arriving items (in the new view, not the old one) rise in one after another: per-layer delays. */
function staggerArrivals(before: readonly string[], after: readonly string[]) {
  const old = new Set(before);
  const arriving = after.filter((id) => !old.has(id)).slice(0, MAX_STAGGERED);
  if (arriving.length === 0) return undefined;
  const style = document.createElement('style');
  style.textContent = arriving
    .map((id, index) => `::view-transition-new(${layerName(id)}):only-child { animation-delay: ${index * STAGGER_MS}ms; }`)
    .join('\n');
  document.head.append(style);
  return style;
}

/** An open menu, popover, select, sheet or card (they portal into body). */
function popupOpen() {
  return Boolean(
    document.querySelector(
      '[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="select-content"], [data-slot="drawer-content"], [role="dialog"]',
    ),
  );
}

/**
 * A change made from inside an open popup (e.g. choosing a host in the Filter menu): no view transition, whose
 * overlay would draw the feed's layers over the popup. The feed updates in place, the popup stays on top and
 * steady, and only items that weren't there before fade in.
 */
function updateUnderPopup(update: () => void) {
  const before = new Set([...document.querySelectorAll<HTMLElement>('.feed-list [data-entry-id]')].map((item) => item.dataset.entryId));
  flushSync(update);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const item of document.querySelectorAll<HTMLElement>('.feed-list [data-entry-id]')) {
    if (!before.has(item.dataset.entryId)) item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  }
}

export function feedTransition(update: () => void, layers: Layer = 'item') {
  const now = performance.now();
  const repeat = now - lastAt < REPEAT_MS;
  lastAt = now;
  const root = document.documentElement;
  if (
    running ||
    repeat ||
    typeof document.startViewTransition !== 'function' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    // A page transition (or the theme switch's crossfade) owns the screen while it runs.
    (document as Document & { activeViewTransition?: ViewTransition | null }).activeViewTransition ||
    root.dataset.themeSwitching
  ) {
    running?.skipTransition();
    if (pending) {
      // The running transition hasn't applied its change yet: queue this one right behind it, in order.
      const first = pending;
      pending = () => {
        first();
        update();
      };
      return;
    }
    update();
    return;
  }
  if (popupOpen()) {
    updateUnderPopup(update);
    return;
  }
  root.dataset.feedTransition = '';
  layer = layers;
  const before = nameItems();
  let stagger: HTMLStyleElement | undefined;
  pending = update;
  const transition = document.startViewTransition(() => {
    unnameItems();
    flushSync(() => {
      const apply = pending;
      pending = undefined;
      apply?.();
    });
    // Too many items for a layer each before: stay a plain crossfade after, too.
    if (before.length > 0) stagger = staggerArrivals(before, nameItems());
  });
  running = transition;
  void transition.finished.finally(() => {
    stagger?.remove();
    unnameItems();
    if (running !== transition) return;
    running = undefined;
    delete root.dataset.feedTransition;
  });
}

/**
 * First load: the first items on screen rise in one after another (WAAPI, the same motion as arriving items).
 * The caller skips it when the list was restored on Back (it should simply be there).
 */
export function staggerIn(container: ParentNode) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const height = window.innerHeight;
  const items = [...container.querySelectorAll<HTMLElement>('.feed-list [data-entry-id]')];
  const visible = items.filter((item) => {
    const box = item.getBoundingClientRect();
    return box.bottom > 0 && box.top < height;
  });
  visible.slice(0, MAX_STAGGERED).forEach((item, index) => {
    item.animate(
      [
        { opacity: 0, transform: 'translate3d(0, 10px, 0) scale(0.98)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 260, delay: index * STAGGER_MS, easing: SPRING, fill: 'backwards' },
    );
  });
}
