import type { AppRouter } from '../router.tsx';
import { type Page, pageOf, pageOfPublicPath } from '../routing/page-key.ts';
import { preparePage } from '../routing/pages.ts';
import { settleFocus, stopFocusHandOff } from './focus.ts';
import { forgetHint, onCardIntent, writeHint } from './open-hint.ts';
import { cardFor, cardPicture, holdStill, namePicture, unnameAll, viewerPicture } from './shared-elements.ts';
import { motionView } from './motion-view.ts';
import { currentTransition, follow, isTurn, nextTurn, supportsTransitions } from './state.ts';
import { stopPictureWait, waitForPicture } from './wait-for-picture.ts';
import { createCompositorHero, rememberInFlight } from './compositor-hero.ts';
import { createRecordingTransition } from './recording-transition.ts';
import { heroLayers, heroSpring } from './hero-spring.ts';

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
  waitForStage: boolean;
  card: HTMLElement | undefined;
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
  root.dataset.pageTransition = 'motion-page';
  // why: the returning snapshot must match the focused card's brightness before focus is restored at handoff.
  for (const card of document.querySelectorAll('[data-transition-return]')) card.removeAttribute('data-transition-return');
  if (plan.direction === 'to-index') plan.card?.setAttribute('data-transition-return', '');
  let still = holdStill(undefined);
  const before = plan.before();
  const recordings = createRecordingTransition(plan.card, plan.direction === 'to-index');
  if (!recordings.active) namePicture(before, 'vt-page-hero');
  const hero = createCompositorHero(recordings.active ? undefined : before);
  const transition = motionView(
    async () => {
      await plan.ready;
      await commit();
      if (!isTurn(plan.turn)) return;
      if (plan.direction === 'to-index') still = holdStill(plan.card);
      unnameAll();
      const after = plan.waitForStage ? await waitForPicture(() => isTurn(plan.turn), 500, recordings.ids) : plan.after();
      if (!isTurn(plan.turn)) return;
      if (recordings.active && after) {
        if (recordings.capture()) root.dataset.pageHero = plan.direction;
      } else if (!recordings.active && before && after) {
        namePicture(after, 'vt-page-hero');
        root.dataset.pageHero = plan.direction;
        hero.capture(after);
      }
    },
    (view) => {
      view.old({ opacity: [1, 1] }).new({ opacity: [0, 1] });
      if (recordings.active) {
        recordings.configure(view);
        return;
      }
      if (!before) return;
      const returning = plan.direction === 'to-index';
      const fade = heroLayers(returning);
      view
        .add('[style*="view-transition-name: vt-page-hero"]')
        .group(false)
        .crop(true)
        .layout(heroSpring(returning))
        .old(fade.source.keyframes, fade.source.options)
        .new(fade.destination.keyframes, fade.destination.options)
        .exit({ opacity: [1, 0] }, { duration: 0.12 })
        .enter({ opacity: [0, 1] });
    },
    () => {
      if (isTurn(plan.turn)) {
        still.pause();
        hero.prepare();
        recordings.prepare();
      }
    },
  );
  follow(transition);
  void transition.finished
    .catch(() => {})
    .then(() => {
      hero.clear();
      recordings.clear();
      still.release();
      // invariant: a newer page change owns the card now; it may already have marked it returning.
      if (!isTurn(plan.turn)) return;
      plan.card?.removeAttribute('data-transition-return');
      delete root.dataset.pageTransition;
      delete root.dataset.pageHero;
      unnameAll();
    });
  return transition.updateCallbackDone;
}

/** Returning to the index is instant; opening a page waits for its data, at most the prepare budget. */
function readyFor(direction: Direction, to: Page): Promise<unknown> {
  if (direction === 'to-index') return Promise.resolve();
  return Promise.race([preparePage(to).catch(() => {}), delay(PREPARE_BUDGET_MS)]);
}

/** A hidden index keeps its DOM: stop any hover preview so it doesn't play on behind the viewer. */
function pauseIndexPreviews() {
  for (const video of document.querySelectorAll<HTMLVideoElement>('.index-shell video, .feed-list video')) video.pause();
}

/** How a page change morphs: which picture leaves, which arrives, and the card it returns to. */
function planFor(
  change: { direction: Direction; from: Page; to: Page; ready: Promise<unknown>; turn: number; uaAnimated: boolean },
  opening: ReturnType<typeof cardFor>,
  returning: () => ReturnType<typeof cardFor>,
): Plan {
  const { direction, from, to, ready, turn, uaAnimated } = change;
  const match = direction === 'to-viewer' ? opening : undefined;
  return {
    direction,
    from,
    animate: direction !== 'page' && !uaAnimated && supportsTransitions(),
    ready,
    turn,
    // why: Back during a slow open leaves from the loading frame's poster, the picture the open was flying to.
    before: () => (direction === 'to-viewer' ? cardPicture(match) : viewerPicture()),
    after: () => (direction === 'to-index' ? cardPicture(returning()) : viewerPicture()),
    waitForStage: direction === 'to-viewer' && to.kind === 'suite',
    card: direction === 'to-viewer' ? match?.card : returning()?.card,
  };
}

export function installPageMotion(router: AppRouter) {
  const { base } = router.options.context.deployment;
  const opensPage = (page: Page) => (link: HTMLAnchorElement) =>
    link.origin === location.origin && pageOfPublicPath(router, link.pathname, base).key === page.key;
  // why: Back returns into the card the viewer was opened from (a replay can be listed twice, on its own and in a suite).
  let opened: HTMLAnchorElement | undefined;
  // invariant: the page change in flight, set before its loaders run and read when the router commits it.
  let plan: Plan | undefined;
  let commitPlan: Plan | undefined;
  let opening: { page: Page; turn: number } | undefined;

  router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
    const link = clicked;
    const uaAnimated = swiped;
    clicked = undefined;
    swiped = false;
    if (!fromLocation) return;
    const from = opening && isTurn(opening.turn) ? opening.page : pageOf(router, fromLocation.pathname);
    const to = pageOf(router, toLocation.pathname);
    // why: suite loaders canonicalize their address before the opening commit updates fromLocation.
    if (opening?.page.key === to.key && isTurn(opening.turn)) return;
    stopFocusHandOff();
    plan = undefined;
    commitPlan = undefined;
    opening = undefined;
    if (from.key === to.key) return;
    stopPictureWait();
    const direction = directionFor(from, to);
    rememberInFlight();
    const turn = nextTurn();
    if (direction === 'to-viewer') opening = { page: to, turn };
    document.documentElement.dataset.navigated = '';
    if (from.kind === 'index') pauseIndexPreviews();
    if (direction === 'to-viewer') {
      const match = cardFor(opensPage(to), link);
      const pageId = to.suiteId ?? to.replayId;
      if (pageId) writeHint(pageId, to.replayId ?? pageId, match);
      opened = match?.link;
    } else forgetHint();
    const ready = readyFor(direction, to);
    plan = planFor({ direction, from, to, ready, turn, uaAnimated }, cardFor(opensPage(to), link), () => cardFor(opensPage(from), opened));
    commitPlan = plan;
  });

  // why: the router wraps each commit in its startViewTransition; this one paces and dresses page changes.
  Object.assign(router, {
    startViewTransition: (commit: () => Promise<void>) => {
      const current = commitPlan;
      commitPlan = undefined;
      return dressedCommit(current, commit);
    },
  });

  router.subscribe('onRendered', () => {
    const current = plan;
    plan = undefined;
    if (!current) return;
    const toIndex = current.direction === 'to-index';
    // why: back on the index, the card you came from, if it is still listed.
    const match = toIndex ? cardFor(opensPage(current.from), opened) : undefined;
    const transition = current.animate ? currentTransition() : undefined;
    if (!transition) {
      if (opening?.turn === current.turn) opening = undefined;
      settleFocus(toIndex, match);
      return;
    }
    void transition.finished
      .catch(() => {})
      .then(() => {
        if (opening?.turn === current.turn) opening = undefined;
        if (isTurn(current.turn)) settleFocus(toIndex, match);
      });
  });

  listenForInput();
}
