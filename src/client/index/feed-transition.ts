import { flushSync } from 'react-dom';

import { ENTER_KEYFRAMES, ENTER_MS, EASE, MORPH_STAGGER_MAX_MS, MORPH_STAGGER_MS, reducedMotion, staggerDelay } from './list-motion.ts';

/**
 * The index list's motion system: one View Transition for every feed change (sort, filters, search results,
 * list ↔ grid, a refresh that brings new items), with the same per-item layers for all of them (list-motion.css;
 * the shared numbers are in list-motion.ts):
 * - items that stay glide to their new place, part by part: the item's frame (`card-<id>`, .feed-card) and its
 *   thumbnail (`poster-<id>`, .feed-poster) move and resize; its title, meta line and source chip (`title-<id>`,
 *   `meta-<id>`, `src-<id>`; .feed-title, .feed-meta, .feed-src) only move, their two snapshots kept at their
 *   natural size and crossfading, so a title reflowing between one line (list) and two (grid) reads as text
 *   settling, never as text stretching. List ↔ grid starts them 8 ms apart in visual order (at most 60 ms);
 * - the rest of an item's text (`aside-<id>`, `ext-<id>`, the thumbnail's `badge-<id>`; .feed-aside) moves like
 *   the title, and day headings
 *   (`day-<label>`, .feed-day) glide to their new place too;
 * - a suite's rear sheets (`back1-<id>`, `back2-<id>`) pair across layouts and follow the front by 20 / 40 ms;
 * - items that arrive are one layer each (`card-<id>`): they fade in and rise 8 px, 25 ms apart (at most 150 ms);
 * - items that leave fade out (120 ms, no slide);
 * - the header is its own live layer (feed.css), so it never fades; everything else crossfades.
 * Only items on or near the screen get layers (at most 24); names come from itemLayerName and exist only while the
 * transition runs, so they never meet a page transition's.
 *
 * Changes made from inside an open popup skip the transition (updateUnderPopup), so the popup stays on top.
 *
 * Never queued: a change while one runs (or within REPEAT_MS of the last: a held key repeating, search keystrokes)
 * finishes the running one at once and applies instantly, after the running one's own change, so the last key
 * always wins and nothing stacks. Reduced motion, no View Transitions support, or a page transition still running:
 * the change just applies.
 */
const REPEAT_MS = 250;
const MAX_NAMED = 24;

let running: ViewTransition | undefined;
/** The running transition's update, until its callback runs (after the old view is captured). */
let pending: (() => void) | undefined;
let lastAt = Number.NEGATIVE_INFINITY;

/** An entry id as the tail of a valid <custom-ident> ("session:abc" → "session_3aabc"). */
const ident = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, (character) => `_${character.charCodeAt(0).toString(16)}`);

/** Each item's layers: its view-transition-class, and where it is in the item ('' = the item itself). */
const PARTS = {
  card: { className: 'feed-card', selector: '' },
  poster: {
    className: 'feed-poster',
    selector:
      ':scope > .poster, :scope > .poster-stack .stack-front > .poster, :scope > .shuffle-window > .poster, :scope > .suite-sheet .shuffle-window > .poster, :scope > .suite-sheet .stack-front > .poster',
  },
  back1: {
    className: 'feed-back-1',
    selector: '.card-back-1, .stack-layer-1',
  },
  back2: {
    className: 'feed-back-2',
    selector: '.card-back-2, .stack-layer-2',
  },
  title: { className: 'feed-title', selector: '.feed-title' },
  meta: { className: 'feed-meta', selector: '.feed-meta' },
  src: { className: 'feed-src', selector: '.feed-meta .source-lead' },
  // why: the frame's snapshot must be only its surface (it resizes; text must not), so the rest of the item's text
  // (the time column on wide lists, a grid suite's time-and-runs line, plugin fields) gets layers of its own.
  aside: { className: 'feed-aside', selector: ':scope > .feed-cols, :scope > .suite-sheet > .feed-cols, .feed-meta-end' },
  // why: the thumbnail's duration / run-count badge keeps its size while the thumbnail scales under it.
  badge: {
    className: 'feed-aside',
    selector: '.poster > .poster-badge',
  },
  ext: { className: 'feed-aside', selector: '.feed-ext' },
} as const;
export type ItemPart = keyof typeof PARTS;
const PART_NAMES = Object.keys(PARTS) as ItemPart[];

function partElement(item: HTMLElement, part: ItemPart) {
  const selector = PARTS[part].selector;
  if (!selector) return item;
  return [...item.querySelectorAll(selector)].find((element) => !element.closest('.suite-sheet-outgoing, .poster-outgoing')) ?? null;
}

/** The view-transition-name of one part of a feed entry (its `data-entry-id`), e.g. `poster-session_3ademo-shop`. */
export function itemLayerName(part: ItemPart, entryId: string) {
  return `${part}-${ident(entryId)}`;
}

function name(element: Element | null, part: ItemPart, entryId: string) {
  if (!(element instanceof HTMLElement)) return;
  element.style.setProperty('view-transition-name', itemLayerName(part, entryId));
  element.style.setProperty('view-transition-class', PARTS[part].className);
}

/** The feed items on or near the screen (at most MAX_NAMED, in document order, which is also visual order). */
function nearItems() {
  const height = window.innerHeight;
  // why: read every box first, then write, so naming never thrashes layout.
  return [...document.querySelectorAll<HTMLElement>('.feed-list [data-entry-id]')]
    .filter((item) => {
      const box = item.getBoundingClientRect();
      return box.bottom > -height / 4 && box.top < height * 1.25;
    })
    .slice(0, MAX_NAMED);
}

/** Day headings on or near the screen glide too (`day-<label>`), instead of crossfading between two places. */
function nameDays() {
  const height = window.innerHeight;
  const days = [...document.querySelectorAll<HTMLElement>('.feed-groups .feed-day')].filter((day) => {
    const box = day.getBoundingClientRect();
    return box.bottom > -height / 4 && box.top < height * 1.25;
  });
  for (const day of days) {
    day.style.setProperty('view-transition-name', `day-${ident(day.textContent ?? '')}`);
    day.style.setProperty('view-transition-class', 'feed-day');
  }
}

/** Before the change: every near item, part by part. Returns their ids. */
function nameBefore(): string[] {
  nameDays();
  const items = nearItems();
  for (const item of items) {
    const id = item.dataset.entryId!;
    for (const part of PART_NAMES) name(partElement(item, part), part, id);
  }
  return items.map((item) => item.dataset.entryId!);
}

/** After the change: items that stay part by part (they pair with their old parts), arrivals as one layer. */
function nameAfter(before: ReadonlySet<string>) {
  nameDays();
  const staying: string[] = [];
  const arriving: string[] = [];
  for (const item of nearItems()) {
    const id = item.dataset.entryId!;
    if (!before.has(id)) {
      name(item, 'card', id);
      arriving.push(id);
      continue;
    }
    for (const part of PART_NAMES) name(partElement(item, part), part, id);
    staying.push(id);
  }
  return { staying, arriving };
}

function unnameItems() {
  for (const element of document.querySelectorAll<HTMLElement>(':is(.feed-list, .feed-groups) [style*="view-transition-name"]')) {
    element.style.removeProperty('view-transition-name');
    element.style.removeProperty('view-transition-class');
  }
}

/**
 * Per-layer delays: arrivals one after another (25 ms apart, at most 150 ms); on list ↔ grid also the items that
 * stay (8 ms apart, at most 60 ms).
 */
function staggerLayers(staying: readonly string[], arriving: readonly string[], morph: boolean) {
  const rules: string[] = [];
  for (const [index, id] of arriving.entries()) {
    const delay = staggerDelay(index);
    if (delay > 0) rules.push(`::view-transition-new(${itemLayerName('card', id)}) { animation-delay: ${delay}ms; }`);
  }
  if (morph)
    for (const [index, id] of staying.entries()) {
      const delay = staggerDelay(index, MORPH_STAGGER_MS, MORPH_STAGGER_MAX_MS);
      for (const part of PART_NAMES) {
        const following = part === 'back1' ? 20 : part === 'back2' ? 40 : 0;
        const partDelay = delay + following;
        if (partDelay === 0) continue;
        const selectors = ['group', 'old', 'new'].map((pseudo) => `::view-transition-${pseudo}(${itemLayerName(part, id)})`);
        rules.push(`${selectors.join(', ')} { animation-delay: ${partDelay}ms; }`);
      }
    }
  if (rules.length === 0) return undefined;
  const style = document.createElement('style');
  style.textContent = rules.join('\n');
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
  if (reducedMotion()) return;
  for (const item of document.querySelectorAll<HTMLElement>('.feed-list [data-entry-id]')) {
    if (!before.has(item.dataset.entryId)) item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: EASE });
  }
}

/** `'poster'`: the change is list ↔ grid (the items that stay also start a little apart). */
export function feedTransition(update: () => void, layers: 'item' | 'poster' = 'item') {
  const now = performance.now();
  const repeat = now - lastAt < REPEAT_MS;
  lastAt = now;
  const root = document.documentElement;
  if (
    running ||
    repeat ||
    typeof document.startViewTransition !== 'function' ||
    reducedMotion() ||
    // why: a page transition (or the theme switch's crossfade) owns the screen while it runs.
    (document as Document & { activeViewTransition?: ViewTransition | null }).activeViewTransition ||
    root.dataset.themeSwitching
  ) {
    running?.skipTransition();
    if (pending) {
      // why: the running transition hasn't applied its change yet; this one must follow it, in order.
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
  const morph = layers === 'poster';
  root.dataset.feedTransition = morph ? 'view' : 'list';
  const before = nameBefore();
  let stagger: HTMLStyleElement | undefined;
  pending = update;
  const transition = document.startViewTransition(() => {
    unnameItems();
    flushSync(() => {
      const apply = pending;
      pending = undefined;
      apply?.();
    });
    const { staying, arriving } = nameAfter(new Set(before));
    stagger = staggerLayers(staying, arriving, morph);
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
 * First load: the items on screen rise in one after another (WAAPI, the same entrance as arriving items; the
 * skeleton's copy leaves on the same beat, FeedSkeleton.tsx). The caller skips it when the list was restored on
 * Back (it should simply be there).
 */
export function staggerIn(container: ParentNode) {
  if (reducedMotion()) return;
  const height = window.innerHeight;
  const items = [...container.querySelectorAll<HTMLElement>('.feed-list [data-entry-id]')];
  const visible = items.filter((item) => {
    const box = item.getBoundingClientRect();
    return box.bottom > 0 && box.top < height;
  });
  for (const [index, item] of visible.entries()) {
    item.animate(ENTER_KEYFRAMES, {
      duration: ENTER_MS,
      delay: staggerDelay(index),
      easing: EASE,
      fill: 'backwards',
    });
  }
}
