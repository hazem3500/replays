import type { AppRouter } from '../router.tsx';
import { type Page, pageOf, pageOfPublicPath } from '../routing/page-key.ts';
import { preparePage } from '../routing/pages.ts';
import { settleFocus, stopFocusHandOff } from './focus.ts';
import { forgetHint, onCardIntent, writeHint } from './open-hint.ts';
import { cardFor, cardPicture, name, unnameAll, viewerPicture } from './shared-elements.ts';
import { currentTransition, follow, isTurn, nextTurn, supportsTransitions } from './state.ts';
import './page-motion.css';

/* why: page changes between the index and the viewer pages (a replay, its edit mode, a suite) stay in this document, so
 * the Query cache, the loaded viewer code and the index itself (kept mounted but hidden, routing/KeptIndex.tsx)
 * survive the trip. Index ↔ viewer pairs the visible thumbnail with the player picture, crossfading their contents
 * as its rectangle moves. Missing/offscreen pictures use the page crossfade. Cached pages render at once;
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
  before: () => Element | undefined;
  after: () => Element | undefined;
}

function directionFor(from: Page, to: Page): Direction {
  if (from.kind === 'index') return 'to-viewer';
  return to.kind === 'index' ? 'to-index' : 'page';
}

/** The link the last click landed on: its card is the one a page change opens from. */
let clicked: HTMLAnchorElement | undefined;
/** A swipe-back gesture already animated the change: it is not animated twice. */
let swiped = false;

function listenForInput() {
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
      swiped = Boolean((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition);
    },
    { capture: true },
  );
  document.addEventListener('pointerover', onCardIntent, { passive: true });
  document.addEventListener('focusin', onCardIntent);
}

/** The router alone commits navigation; naming snapshots never mounts another player or changes its history. */
function dressedCommit(plan: Plan | undefined, commit: () => Promise<void>) {
  if (!plan) return commit();
  if (!plan.animate) return plan.ready.then(commit);
  const root = document.documentElement;
  unnameAll();
  delete root.dataset.pageHero;
  root.dataset.pageTransition = 'page';
  const before = plan.before();
  name(before, 'vt-page-hero');
  const transition = document.startViewTransition(async () => {
    await plan.ready;
    await commit();
    if (!isTurn(plan.turn)) return;
    unnameAll();
    const after = plan.after();
    if (before && after) {
      name(after, 'vt-page-hero');
      root.dataset.pageHero = plan.direction;
    }
  });
  follow(transition);
  void transition.finished
    .catch(() => {})
    .then(() => {
      if (currentTransition()) return;
      delete root.dataset.pageTransition;
      delete root.dataset.pageHero;
      unnameAll();
    });
  return transition.updateCallbackDone;
}

export function installPageMotion(router: AppRouter) {
  const { base } = router.options.context.deployment;
  const opensPage = (page: Page) => (link: HTMLAnchorElement) =>
    link.origin === location.origin && pageOfPublicPath(router, link.pathname, base).key === page.key;
  // why: Back returns into the card the viewer was opened from (a replay can be listed twice, on its own and in a suite).
  let opened: HTMLAnchorElement | undefined;
  // invariant: the page change in flight, set before its loaders run and read when the router commits it.
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
    const ready = direction === 'to-index' ? Promise.resolve() : Promise.race([preparePage(to).catch(() => {}), delay(PREPARE_BUDGET_MS)]);
    const match = direction === 'to-viewer' ? cardFor(opensPage(to), link) : undefined;
    plan = {
      direction,
      from,
      animate: direction !== 'page' && !uaAnimated && supportsTransitions(),
      ready,
      turn,
      before: () => (direction === 'to-viewer' ? cardPicture(match) : viewerPicture()),
      after: () => (direction === 'to-index' ? cardPicture(cardFor(opensPage(from), opened)) : viewerPicture()),
    };
  });

  // why: the router wraps each commit in its startViewTransition; this one paces and dresses page changes.
  Object.assign(router, { startViewTransition: (commit: () => Promise<void>) => dressedCommit(plan, commit) });

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
      .catch(() => {})
      .then(() => {
        if (isTurn(current.turn)) settleFocus(toIndex, match);
      });
  });

  listenForInput();
}
