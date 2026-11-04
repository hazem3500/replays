import { animate } from 'motion/mini';
import { flushSync } from 'react-dom';

import { motionView } from '../transitions/motion-view.ts';
import { currentTransition } from '../transitions/state.ts';

import { ENTER_MS, ENTER_RISE_PX, EASE, reducedMotion, staggerDelay } from './list-motion.ts';

const MAX_NAMED = 24;
let generation = 0;
const pendingUpdates = new Set<() => void>();
let active: ReturnType<typeof motionView> | undefined;
const ident = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, (character) => `_${character.charCodeAt(0).toString(16)}`);

const PARTS = {
  card: { className: 'feed-card', selector: '' },
  poster: {
    className: 'feed-poster',
    selector:
      ':scope > .poster, :scope > .poster-stack .stack-front > .poster, :scope > .shuffle-window > .poster, :scope > .suite-sheet .shuffle-window > .poster, :scope > .suite-sheet .stack-front > .poster',
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
type ItemPart = keyof typeof PARTS;
const PART_NAMES = Object.keys(PARTS) as ItemPart[];

function partElement(item: HTMLElement, part: ItemPart) {
  const selector = PARTS[part].selector;
  if (!selector) return item;
  return [...item.querySelectorAll(selector)].find((element) => !element.closest('.suite-sheet-outgoing, .poster-outgoing')) ?? null;
}

/** The view-transition-name of one part of a feed entry (its `data-entry-id`), e.g. `poster-session_3ademo-shop`. */
function itemLayerName(part: ItemPart, entryId: string) {
  return `${part}-${ident(entryId)}`;
}

function name(element: Element | null, part: ItemPart, entryId: string) {
  if (element instanceof HTMLElement) layer(element, itemLayerName(part, entryId), PARTS[part].className, part);
}

function layer(element: HTMLElement, layerName: string, className: string, part: string) {
  element.style.setProperty('view-transition-name', layerName);
  element.style.setProperty('view-transition-class', className);
  element.dataset.feedLayer = part;
}

/**
 * invariant: every rear sheet of a suite stack is a layer of its own, on the front poster's timing. A sheet left
 * unnamed is painted into the card's snapshot and stretches with the whole card, detached from the stack.
 */
function nameSheets(item: HTMLElement, entryId: string) {
  for (const sheet of item.querySelectorAll<HTMLElement>(':is(.card-back, .stack-layer)[data-stack-depth]')) {
    if (sheet.closest('.suite-sheet-outgoing, .poster-outgoing')) continue;
    const depth = sheet.dataset.stackDepth!;
    layer(sheet, `back${depth}-${ident(entryId)}`, `feed-back-${depth}`, 'back');
  }
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
    day.dataset.feedLayer = 'day';
  }
}

/** Before the change: every near item, part by part. Returns their ids. */
function nameBefore(): string[] {
  nameDays();
  const items = nearItems();
  for (const item of items) {
    const id = item.dataset.entryId!;
    for (const part of PART_NAMES) name(partElement(item, part), part, id);
    nameSheets(item, id);
  }
  return items.map((item) => item.dataset.entryId!);
}

function unnameItems() {
  for (const element of document.querySelectorAll<HTMLElement>(':is(.feed-list, .feed-groups) [data-feed-layer]')) {
    element.style.removeProperty('view-transition-name');
    element.style.removeProperty('view-transition-class');
    delete element.dataset.feedLayer;
  }
}

/** An open menu, popover, select, sheet or card (they portal into body). */
function popupOpen() {
  return Boolean(
    document.querySelector(
      '[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="select-content"], [data-slot="drawer-content"], [role="dialog"]',
    ),
  );
}

/** Motion owns snapshot morphs and interruption; stable part names pair nested suite thumbnails across layouts. */
export function feedTransition(update: () => void, layers: 'item' | 'poster' = 'item') {
  const current = ++generation;
  let applied = false;
  const apply = () => {
    if (applied) return;
    applied = true;
    pendingUpdates.delete(apply);
    update();
  };
  if (
    typeof document.startViewTransition !== 'function' ||
    reducedMotion() ||
    popupOpen() ||
    currentTransition() ||
    document.documentElement.dataset.themeSwitching
  ) {
    active?.skipTransition();
    // why: a filter can open before a previous capture commits; its update still precedes this immediate result.
    for (const pending of pendingUpdates) pending();
    apply();
    unnameItems();
    delete document.documentElement.dataset.feedTransition;
    return;
  }
  pendingUpdates.add(apply);
  nameBefore();
  document.documentElement.dataset.feedTransition = layers === 'poster' ? 'view' : 'list';
  const transition = motionView(
    () => {
      if (current !== generation) {
        apply();
        return;
      }
      unnameItems();
      flushSync(apply);
      nameBefore();
    },
    (view) => {
      view
        .add(':is(.feed-list, .feed-groups) [data-feed-layer]')
        .layout({ duration: layers === 'poster' ? 0.56 : 0.28, ease: EASE })
        .enter(
          { opacity: [0, 1], transform: [`translateY(${ENTER_RISE_PX}px)`, 'none'] },
          { duration: ENTER_MS / 1000, delay: (index) => staggerDelay(index) / 1000 },
        )
        .exit({ opacity: 0 }, { duration: 0.12 })
        .old({ opacity: [1, 0] }, { duration: 0.14 })
        .new({ opacity: [0, 1] }, { duration: 0.18 })
        .add('.index-head')
        .old({ opacity: 1 })
        .new({ opacity: 1 });
    },
  );
  active = transition;
  void transition.finished.then(() => {
    if (active === transition) active = undefined;
    if (generation !== current) return;
    unnameItems();
    delete document.documentElement.dataset.feedTransition;
  });
}

/** The same Motion entrance is shared by initial loading and virtualized rows revealed while scrolling. */
export function revealFeedItems(items: readonly HTMLElement[]) {
  if (reducedMotion()) return;
  for (const [index, item] of items.entries()) {
    animate(
      [item],
      { opacity: [0, 1], translate: [`0 ${ENTER_RISE_PX}px`, '0 0'] },
      {
        duration: ENTER_MS / 1000,
        delay: staggerDelay(index) / 1000,
        ease: EASE,
      },
    );
  }
}

/** Keeps the existing first-load handover while Motion owns the animation controls. */
export function staggerIn(container: ParentNode) {
  const height = window.innerHeight;
  revealFeedItems(
    [...container.querySelectorAll<HTMLElement>('.feed-list [data-entry-id]')].filter((item) => {
      const box = item.getBoundingClientRect();
      return box.bottom > 0 && box.top < height;
    }),
  );
}
