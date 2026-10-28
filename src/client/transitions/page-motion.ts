import type { AppRouter } from '../router.tsx';
import { type Page, pageOf, pageOfPublicPath } from '../routing/page-key.ts';
import { preparePage } from '../routing/pages.ts';
import { settleFocus, stopFocusHandOff } from './focus.ts';
import { forgetHint, onCardIntent, writeHint } from './open-hint.ts';
import { cardFor, unnameAll } from './shared-elements.ts';
import { currentTransition, follow, isTurn, nextTurn, supportsTransitions } from './state.ts';

/*
 * Page changes between the index and the viewer pages (a replay, its edit mode, a suite) stay in this document, so
 * the Query cache, the loaded viewer code and the index itself (kept mounted but hidden, routing/KeptIndex.tsx)
 * survive the trip. Index ↔ viewer uses one short crossfade (styles.css, html[data-page-transition]); thumbnails never
 * expand into a recording, since they can differ from its opening frame and aspect ratio. Cached pages render at once;
 * slow ones keep their own loading and error states. The router owns history and scroll restoration; this module
 * only dresses its view transition, and reduced motion or a back swipe the browser already animated get none.
 */

type Direction = 'to-viewer' | 'to-index' | 'page';

/** How long a page change may hold the old page to render the new one complete (cached data, loaded code). */
const PREPARE_BUDGET_MS = 80;

const delay = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));

interface Plan {
  direction: Direction;
  from: Page;
  animate: boolean;
  ready: Promise<unknown>;
  turn: number;
}

const directionFor = (from: Page, to: Page): Direction => (from.kind === 'index' ? 'to-viewer' : to.kind === 'index' ? 'to-index' : 'page');

export function installPageMotion(router: AppRouter) {
  const { base } = router.options.context.deployment;
  const opensPage = (page: Page) => (link: HTMLAnchorElement) =>
    link.origin === location.origin && pageOfPublicPath(router, link.pathname, base).key === page.key;
  let clicked: HTMLAnchorElement | undefined;
  /** The link the viewer was opened from: Back returns into that card (a replay can be listed twice, on its own and in a suite). */
  let opened: HTMLAnchorElement | undefined;
  let swiped = false;
  /** The page change in flight: set before its loaders run, read when the router commits it. */
  let plan: Plan | undefined;

  router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
    stopFocusHandOff();
    const link = clicked;
    const uaAnimated = swiped;
    clicked = undefined;
    swiped = false;
    plan = undefined;
    if (!fromLocation) return;
    const from = pageOf(router, fromLocation.pathname);
    const to = pageOf(router, toLocation.pathname);
    if (from.key === to.key) return;
    const direction = directionFor(from, to);
    const turn = nextTurn();
    document.documentElement.dataset.navigated = '';
    if (from.kind === 'index')
      // why: a hidden index keeps its DOM: stop any hover preview so it doesn't play on behind the viewer.
      for (const video of document.querySelectorAll<HTMLVideoElement>('.index-shell video, .feed-list video')) video.pause();
    if (direction === 'to-viewer') {
      const match = cardFor(opensPage(to), link);
      const pageId = to.suiteId ?? to.replayId;
      if (pageId) writeHint(pageId, to.replayId ?? pageId, match);
      opened = match?.link;
    } else forgetHint();
    plan = {
      direction,
      from,
      animate: direction !== 'page' && !uaAnimated && supportsTransitions(),
      ready:
        direction === 'to-index' ? Promise.resolve() : Promise.race([preparePage(to).catch(() => undefined), delay(PREPARE_BUDGET_MS)]),
      turn,
    };
  });

  // why: the router wraps each commit in this; a page change renders its page within the budget, inside one crossfade.
  router.startViewTransition = (commit: () => Promise<void>) => {
    const current = plan;
    if (!current) return commit();
    if (!current.animate) return current.ready.then(commit);
    const root = document.documentElement;
    unnameAll();
    root.dataset.pageTransition = 'page';
    const transition = document.startViewTransition(async () => {
      await current.ready;
      await commit();
    });
    follow(transition);
    void transition.finished
      .catch(() => undefined)
      .then(() => {
        if (currentTransition()) return;
        delete root.dataset.pageTransition;
        unnameAll();
      });
    return transition.updateCallbackDone;
  };

  router.subscribe('onRendered', () => {
    const current = plan;
    plan = undefined;
    if (!current) return;
    const toIndex = current.direction === 'to-index';
    // why: back on the index, the card you came from, if it is still listed.
    const match = toIndex ? cardFor(opensPage(current.from), opened) : undefined;
    const transition = current.animate ? currentTransition() : undefined;
    if (!transition) {
      settleFocus(toIndex, match);
      return;
    }
    void transition.finished
      .catch(() => undefined)
      .then(() => {
        if (isTurn(current.turn)) settleFocus(toIndex, match);
      });
  });

  window.addEventListener(
    'click',
    (event) => {
      clicked = (event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null) ?? undefined;
    },
    { capture: true },
  );
  window.addEventListener(
    'popstate',
    (event) => {
      // why: a swipe-back gesture already animated the change: don't animate it twice.
      swiped = Boolean((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition);
    },
    { capture: true },
  );
  document.addEventListener('pointerover', onCardIntent, { passive: true });
  document.addEventListener('focusin', onCardIntent);
}
