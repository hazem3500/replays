import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

import { setClientNavigation } from './intent-prefetch.ts';
import { isAppPage, parseRoute, type Route } from './route.ts';
import { OPEN_HINT_KEY, type OpenHint } from './ViewerSkeleton.tsx';

/*
 * Same-document navigation between the index and the viewer pages (a replay, a suite), so the Query cache,
 * the loaded viewer code and the index itself (kept mounted but hidden, App.tsx) survive the trip. Plain
 * left clicks on in-app links and Back/Forward are routed here; anything else (modifier clicks, new tabs,
 * other paths) stays a normal page load.
 *
 * Index ↔ viewer uses a measured shared-frame transition when a decoded card image can safely stand in for
 * the replay frame; otherwise it uses the page crossfade. Letter fallbacks and incompatible crops never
 * expand into a recording. Cached routes render immediately; slow routes keep their normal loading/error
 * state. History, focus and scroll restoration stay independent of animation, and reduced motion skips it.
 */

export type PageDirection = 'to-viewer' | 'to-index' | 'page';

const routeKey = (route: Route) => (route.kind === 'index' ? 'index' : `${route.kind}:${route.id}`);

// Read at install (installNavigation): this module also loads where there is no page (unit tests).
let route: Route = typeof location === 'undefined' ? { kind: 'index' } : parseRoute(location.pathname, location.search);
const listeners = new Set<() => void>();

export function subscribeRoute(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const currentRoute = () => route;

function commit(next: Route) {
  route = next;
  for (const listener of listeners) listener();
}

/** Readies a route before its first render (code + cached data); App.tsx registers it. */
let prepare: (next: Route) => Promise<unknown> = () => Promise.resolve();
export function setRoutePreparer(prepareRoute: (next: Route) => Promise<unknown>) {
  prepare = prepareRoute;
}

let active: ViewTransition | undefined;

/** Resolves when the running page transition has started animating (at once when none runs). */
export function afterMorphStart(): Promise<void> {
  return active
    ? active.ready.then(
        () => undefined,
        () => undefined,
      )
    : afterPageTransition();
}

/** Resolves when the running page transition has finished (at once when none runs). */
export function afterPageTransition(): Promise<void> {
  const transition = active ?? (document as Document & { activeViewTransition?: ViewTransition | null }).activeViewTransition;
  return transition
    ? transition.finished.then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}

export function pageTransitionRunning() {
  return Boolean(active ?? (document as Document & { activeViewTransition?: ViewTransition | null }).activeViewTransition);
}

/**
 * False while the page transition that mounted the caller runs, then true. Long lists (the step rail, the
 * inspector's rows) render their shell inside the transition and fill once it has landed: the click shows
 * motion sooner, and no list render competes with the animation for the main thread.
 */
export function useFilledAfterTransition() {
  // A run switch crossfades whole panels in place: they render complete inside it.
  const [filled, setFilled] = useState(() => !active || inPlace);
  useEffect(() => {
    if (filled) return;
    let live = true;
    void afterPageTransition().then(() => live && setFilled(true));
    return () => {
      live = false;
    };
  }, [filled]);
  return filled;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Shared elements ---------- */

const named = new Set<HTMLElement>();
function name(element: Element | null | undefined, value: string) {
  if (!(element instanceof HTMLElement)) return;
  element.style.viewTransitionName = value;
  named.add(element);
}
function unnameAll() {
  for (const element of named) element.style.viewTransitionName = '';
  named.clear();
}

/** Name only the active page's header: the index stays mounted, hidden by React Activity. */
function nameTopbar(target: Route) {
  const shell = target.kind === 'index' ? '.index-shell' : target.kind === 'comparison' ? '.cmp-workspace' : '.app-shell';
  const headers = document.querySelectorAll<HTMLElement>(`${shell} .app-topbar, ${shell} .editor-mobile-header`);
  name([...headers].find((header) => !header.closest('[hidden]') && getComputedStyle(header).display !== 'none'), 'vt-topbar');
}

function cancelTransition() {
  const previous = active;
  active = undefined;
  previous?.skipTransition();
  delete document.documentElement.dataset.pageTransition;
  unnameAll();
}

function onScreen(element: Element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
}

/** The index card that stands for a viewer route: the clicked link's card, else the first link to its page. */
function cardFor(target: Route, clicked?: HTMLAnchorElement | null, allowHidden = false) {
  if (target.kind === 'index') return undefined;
  const matches = (link: HTMLAnchorElement) => {
    const linked = parseRoute(link.pathname, link.search);
    return linked.kind === target.kind && linked.id === target.id;
  };
  let link = clicked?.isConnected && clicked.closest('.feed-item') && matches(clicked) ? clicked : undefined;
  link ??= [...document.querySelectorAll<HTMLAnchorElement>('.index-shell a.row-target, a.row-target')].find(
    (candidate) => matches(candidate) && onScreen(candidate),
  );
  const card = link?.closest<HTMLElement>('.feed-item');
  if (!link || !card) return undefined;
  const poster = card.querySelector<HTMLElement>('.stack-front > .poster') ?? card.querySelector<HTMLElement>(':scope > .poster');
  // Only a linked source has a top-bar chip to morph into; a plain one ("Agent capture") stays in the card's layer
  // and moves with it, instead of an unpaired layer that pops in place.
  const source = card.querySelector('.source-lead:not(.source-lead-plain)');
  return { card, link, poster: poster && (allowHidden || onScreen(poster)) ? poster : undefined, source };
}

// A completed fetch does not prove decoding has finished (posters use decoding="async"). Warm decoding
// from load/intent, never await it on navigation, and only pair resources whose decode promise succeeded.
const decodedImages = new Set<string>();
const decodingImages = new WeakMap<HTMLImageElement, string>();
function decodeImage(image: HTMLImageElement) {
  const src = image.currentSrc || image.src;
  if (!image.complete || image.naturalWidth === 0 || !src || decodedImages.has(src) || decodingImages.get(image) === src || typeof image.decode !== 'function') return;
  decodingImages.set(image, src);
  void image.decode().then(
    () => {
      if (image.complete && image.naturalWidth > 0 && (image.currentSrc || image.src) === src) decodedImages.add(src);
    },
    () => {
      if (decodingImages.get(image) === src) decodingImages.delete(image);
    },
  );
}

function decodedImage(image: HTMLImageElement | null | undefined): image is HTMLImageElement {
  return Boolean(image?.complete && image.naturalWidth > 0 && decodedImages.has(image.currentSrc || image.src));
}

function onImageLoad(event: Event) {
  if (event.target instanceof HTMLImageElement && event.target.closest('.poster')) decodeImage(event.target);
}

function imageFor(poster: HTMLElement | undefined) {
  if (!poster || poster.dataset.phase !== 'ready' || poster.querySelector('.poster-video[data-shown]')) return undefined;
  const image = poster.querySelector<HTMLImageElement>(':scope > img');
  if (image) decodeImage(image);
  return decodedImage(image) ? image : undefined;
}

function ratio(width: number, height: number) {
  return width > 0 && height > 0 ? width / height : undefined;
}

function aspectSafe(source: number | undefined, destination: number | undefined) {
  if (!source || !destination) return false;
  // Cards crop to 16:10 while most recordings are 16:9. That small crop is safe because the image pair
  // crossfades during the move; portrait, square and otherwise substantially different frames stay a page fade.
  return Math.abs(Math.log(source / destination)) <= Math.log(1.16);
}

function posterAspect(poster: HTMLElement) {
  const box = poster.getBoundingClientRect();
  const measured = ratio(box.width, box.height);
  if (measured) return measured;
  // On Back the kept index is hidden until the update callback. Its card templates have fixed 16:10 geometry.
  return poster.classList.contains('poster-card') || poster.classList.contains('poster-row') ? 1.6 : undefined;
}

function openingAspect(target: Route, image: HTMLImageElement | undefined) {
  const id = target.kind === 'suite' ? (target.replayId ?? target.id) : target.kind === 'index' ? undefined : target.id;
  const viewport = id && hint?.id === id ? hint.viewport : id ? listed.get(id)?.viewport : undefined;
  return ratio(viewport?.width ?? 0, viewport?.height ?? 0) ?? ratio(image?.naturalWidth ?? 0, image?.naturalHeight ?? 0);
}

function viewerFrame() {
  return document.querySelector<HTMLElement>('.app-shell:not(.skeleton-shell) .player-frame');
}

function visibleViewerFrame() {
  const frame = document.querySelector<HTMLElement>(PLAYER_SELECTOR + ' .player-frame');
  const cover = frame?.querySelector<HTMLImageElement>('.player-cover[data-covering]');
  const player = frame?.querySelector('iframe, .player-host > *');
  const covered = decodedImage(cover);
  return frame && onScreen(frame) && (covered || player) ? frame : undefined;
}

/** A cold route pairs to its decoded poster-backed skeleton; a loaded route pairs to the player frame. */
function openingDestination() {
  const frame = viewerFrame();
  const cover = frame?.querySelector<HTMLImageElement>('.player-cover[data-covering]');
  const player = frame?.querySelector('iframe, .player-host > *');
  if (frame && (decodedImage(cover) || player)) return frame;
  const skeleton = document.querySelector<HTMLElement>('.skeleton-shell .sk-frame');
  const poster = skeleton?.querySelector<HTMLImageElement>('.sk-poster');
  return skeleton && decodedImage(poster) ? skeleton : undefined;
}

/* ---------- The hint the viewer opens with ---------- */

/** What the clicked card knows about the page it opens: its poster (and so the recording's aspect) and title. */
let hint: OpenHint | undefined;

let hintAt = Number.NEGATIVE_INFINITY;

/** The opened card's poster, for the player's first frame right after a navigation (none later on). */
export function freshPoster() {
  return hint?.poster && performance.now() - hintAt < 4000 ? hint.poster : undefined;
}

interface ListedReplay {
  id: string;
  steps: number;
  viewport?: { width: number; height: number } | undefined;
  sources?: readonly unknown[] | undefined;
}
const listed = new Map<string, ListedReplay>();

/** The index reports what it lists, so an opened replay's skeleton has its real shape (panel, steps, aspect). */
export function rememberListed(items: readonly ListedReplay[]) {
  for (const item of items) listed.set(item.id, item);
}

/*
 * Opening stills (src/server/posters.ts): the replay as the viewer first paints it, next to each poster. A card
 * the pointer rests on (or the keyboard reaches) loads its still, so opening it can land on exactly what rrweb
 * will draw: the morph crossfades poster → still mid-flight (styles.css, html[data-page-still]) and rrweb's
 * hand-over is then a crossfade between two identical pictures.
 */
const OPEN_STILL_VERSION = 1;
const decodedStills = new Set<string>();
const STILL_INTENT_MS = 120;

const stillFor = (poster: string) =>
  /\/poster(\?|$)/.test(poster) ? poster.replace(/\/poster(\?.*)?$/, `/open?v=${OPEN_STILL_VERSION}`) : undefined;

function openingImage(poster: string): { poster: string; still?: boolean } {
  const still = stillFor(poster);
  return still && decodedStills.has(still) ? { poster: still, still: true } : { poster };
}

function warmStill(card: Element) {
  const poster = card.querySelector<HTMLImageElement>('.stack-front > .poster > img, :scope > .poster > img');
  const still = poster?.src ? stillFor(poster.src) : undefined;
  if (!still || decodedStills.has(still)) return;
  const image = new Image();
  image.src = still;
  image.decode().then(
    () => {
      decodedStills.add(still);
      decodedImages.add(image.currentSrc || image.src);
    },
    () => undefined,
  );
}

let stillTimer = 0;
function onIntent(event: Event) {
  const card = event.target instanceof Element ? event.target.closest('.feed-item') : null;
  const image = card?.querySelector<HTMLImageElement>('.stack-front > .poster > img, :scope > .poster > img');
  if (image) decodeImage(image);
  window.clearTimeout(stillTimer);
  if (card) stillTimer = window.setTimeout(() => warmStill(card), event.type === 'focusin' ? 0 : STILL_INTENT_MS);
}

function writeHint(target: Route, match: ReturnType<typeof cardFor>) {
  if (target.kind === 'index') return;
  const id = target.kind === 'suite' ? (target.replayId ?? target.id) : target.id;
  const image = imageFor(match?.poster);
  // A suite's card shows its landing run's poster: that run's summary shapes the skeleton.
  const posterId = image ? /\/replays\/([^/]+)\/poster/.exec(image.src)?.[1] : undefined;
  const summary = listed.get(posterId ? decodeURIComponent(posterId) : id);
  hintAt = performance.now();
  hint = {
    id,
    ...(match ? { title: match.link.textContent?.trim() ?? '' } : {}),
    ...(summary ? { steps: summary.steps, source: Boolean(summary.sources?.length) } : {}),
    ...(summary?.viewport
      ? { viewport: summary.viewport }
      : image
        ? { viewport: { width: image.naturalWidth, height: image.naturalHeight } }
        : {}),
    // The opening still (what rrweb paints first) when it is loaded, else the card's poster.
    ...(image ? openingImage(image.currentSrc || image.src) : {}),
  };
  try {
    sessionStorage.setItem(OPEN_HINT_KEY, JSON.stringify({ ...hint, id: target.id }));
  } catch {
    // Storage blocked: the skeleton draws its default shape.
  }
}

/* ---------- Scroll and keyboard position ---------- */

let indexScroll = 0;
/** The link the viewer was opened from: Back returns into that card (a replay can be listed twice, e.g. on its own and in a suite). */
let opened: HTMLAnchorElement | undefined;
/** The index URL last left for a viewer page; the index stays mounted for it (App.tsx). */
let returnTo: URL | undefined;
let indexGeneration = 0;
/** The URL on screen before the current change (Back/Forward have already replaced location by then). */
let shownUrl: URL | undefined;

/** Changes when the index shown is a different list than the one kept (other filters): App.tsx remounts it. */
export const currentIndexGeneration = () => indexGeneration;
const sameIndex = (url: URL) => Boolean(returnTo && returnTo.pathname === url.pathname && returnTo.search === url.search);

function restoreIndex(from: Route) {
  window.scrollTo(0, indexScroll);
  // Back on the index: the card you came from, if it is still listed.
  const match = from.kind === 'index' ? undefined : cardFor(from, opened);
  return match;
}

type NavigationFocusIntent = number;
type InputIntent = { kind: 'keyboard' | 'pointer'; at: number; generation: number };
const FOCUS_INTENT_FRESH_MS = 1000;
let inputGeneration = 0;
let lastInput: InputIntent | undefined;

function noteInput(kind: InputIntent['kind']) {
  lastInput = { kind, at: performance.now(), generation: ++inputGeneration };
}

function keyboardFocusIntent(): NavigationFocusIntent | undefined {
  return lastInput?.kind === 'keyboard' && performance.now() - lastInput.at <= FOCUS_INTENT_FRESH_MS
    ? lastInput.generation
    : undefined;
}

function settleAfter(direction: PageDirection, match: ReturnType<typeof cardFor>, focusIntent?: NavigationFocusIntent) {
  if (direction === 'to-index') {
    if (match) {
      if (focusIntent !== undefined && inputGeneration === focusIntent) match.link.focus({ preventScroll: true });
      match.card.setAttribute('data-returned', '');
      window.setTimeout(() => match.card.removeAttribute('data-returned'), 1600);
    }
    return;
  }
  // Pointer and touch navigation should not move focus to the player. Besides avoiding a focus ring that
  // can look like a purple stage border on phones, this leaves focus where the person put it.
  if (focusIntent === undefined || inputGeneration !== focusIntent) return;
  const player = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
  const heading = document.querySelector<HTMLElement>('.app-shell:not(.skeleton-shell) .app-topbar h1');
  const target = player ?? heading;
  if (!target) {
    // Still on the skeleton (a slow load, a skipped or slow transition): hand the keyboard to the player as soon as
    // the viewer replaces it, unless the person has moved it somewhere themselves meanwhile.
    handToPlayerWhenReady(focusIntent);
    return;
  }
  if (target === heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

const PLAYER_SELECTOR = '.app-shell:not(.skeleton-shell) #replay-player';
/** How long a page may stay on its skeleton and still hand the keyboard to the player when it arrives. */
const PLAYER_WAIT_MS = 15_000;
let stopWaitingForPlayer: (() => void) | undefined;

function handToPlayerWhenReady(focusIntent: NavigationFocusIntent) {
  stopWaitingForPlayer?.();
  const startedOn = document.activeElement;
  const untouched = () => {
    const current = document.activeElement;
    return (
      inputGeneration === focusIntent &&
      (!current || current === document.body || current === startedOn || Boolean(current.closest('.skeleton-shell, .skeleton-overlay')))
    );
  };
  const check = () => {
    const player = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
    if (!player) return false;
    stop();
    if (untouched()) player.focus({ preventScroll: true });
    return true;
  };
  const observer = new MutationObserver(() => void check());
  const timer = window.setTimeout(() => stop(), PLAYER_WAIT_MS);
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    stopWaitingForPlayer = undefined;
  };
  stopWaitingForPlayer = stop;
  if (check()) return;
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ---------- Navigating ---------- */

function directionFor(from: Route, to: Route): PageDirection {
  if (from.kind === 'index' && to.kind !== 'index') return 'to-viewer';
  if (from.kind !== 'index' && to.kind === 'index') return 'to-index';
  return 'page';
}

function supportsTransitions() {
  return typeof document.startViewTransition === 'function' && !reducedMotion();
}

let sequence = 0;
/** The page a change in flight is rendering (its update hasn't run yet). */
let pendingKey: string | undefined;

/**
 * Shows `next` (the URL is already updated): renders it inside a View Transition when that helps, else at once.
 * `clicked` is the link that started it (its card is the shared element).
 */
function show(
  next: Route,
  {
    clicked,
    animate = true,
    leaving = shownUrl,
  }: { clicked?: HTMLAnchorElement | null | undefined; animate?: boolean; leaving?: URL } = {},
) {
  const from = route;
  shownUrl = new URL(location.href);
  const focusIntent = keyboardFocusIntent();
  stopWaitingForPlayer?.();
  if (routeKey(from) === routeKey(next)) {
    // Back to the page on screen before a change in flight rendered (Back at once after a click): drop it.
    if (pendingKey !== undefined && pendingKey !== routeKey(next)) {
      sequence++;
      cancelTransition();
    }
    pendingKey = undefined;
    commit(next);
    return;
  }
  pendingKey = routeKey(next);
  const direction = directionFor(from, next);
  const run = ++sequence;
  document.documentElement.dataset.navigated = '';
  if (next.kind === 'index' && from.kind !== 'index' && !sameIndex(new URL(location.href))) {
    indexGeneration++;
    indexScroll = 0;
  }
  if (from.kind === 'index') {
    indexScroll = window.scrollY;
    returnTo = leaving;
    // A hidden index keeps its DOM: stop any hover preview so it doesn't play on behind the viewer.
    for (const video of document.querySelectorAll<HTMLVideoElement>('.index-shell video, .feed-list video')) video.pause();
  }
  const match = direction === 'to-viewer' ? cardFor(next, clicked) : direction === 'to-index' ? cardFor(from, opened, true) : undefined;
  if (direction === 'to-viewer') {
    writeHint(next, match);
    opened = match?.link;
  } else if (direction === 'page') hint = undefined;
  // Warm code/cached data without holding navigation for preparation or an animation timer.
  void prepare(next).catch(() => undefined);

  const posterImage = imageFor(match?.poster);
  const posterContentAspect = ratio(posterImage?.naturalWidth ?? 0, posterImage?.naturalHeight ?? 0);
  const openingRatio = openingAspect(direction === 'to-index' ? from : next, posterImage);
  const sourceFrame = direction === 'to-index' ? visibleViewerFrame() : undefined;
  const sourceAspect =
    direction === 'to-viewer'
      ? match?.poster && posterAspect(match.poster)
      : sourceFrame && ratio(sourceFrame.getBoundingClientRect().width, sourceFrame.getBoundingClientRect().height);
  const heroSource =
    direction === 'to-viewer' && match?.poster && posterImage && aspectSafe(sourceAspect, openingRatio) && aspectSafe(posterContentAspect, openingRatio)
      ? match.poster
      : direction === 'to-index' && sourceFrame && match?.poster && posterImage &&
          aspectSafe(sourceAspect, posterAspect(match.poster)) && aspectSafe(posterContentAspect, sourceAspect)
        ? sourceFrame
        : undefined;

  let returned: ReturnType<typeof cardFor>;
  let updated = false;
  const update = () => {
    if (run !== sequence || updated) return;
    updated = true;
    pendingKey = undefined;
    // Ordinary replay/editor switches paint their player inside the snapshot, as suite switches do.
    // No extra mount or deferred iframe entrance is introduced by enabling their page transition.
    inPlace = direction === 'page';
    try {
      flushSync(() => commit(next));
    } finally {
      inPlace = false;
    }
    if (direction === 'to-index') returned = restoreIndex(from);
    else window.scrollTo(0, 0);
  };

  if (!animate || !supportsTransitions()) {
    cancelTransition();
    update();
    settleAfter(direction, returned, focusIntent);
    return;
  }

  cancelTransition();
  const root = document.documentElement;
  nameTopbar(from);
  if (heroSource) name(heroSource, 'vt-hero');
  root.dataset.pageTransition = 'page';
  const render = () => {
    // A skipped transition may still invoke its update. It must not clear the newer trip's names.
    if (run !== sequence || updated) return;
    // The old snapshot is already captured. Clear its live name before React mounts the matching destination,
    // so interruption cannot leave duplicate/stale names in the document.
    unnameAll();
    update();
    if (run === sequence) nameTopbar(next);
    if (run === sequence && heroSource) {
      const destination = direction === 'to-index' ? match?.poster : openingDestination();
      const destinationBox = destination?.getBoundingClientRect();
      const destinationAspect = destinationBox && ratio(destinationBox.width, destinationBox.height);
      const expectedAspect = direction === 'to-index' && match?.poster ? posterAspect(match.poster) : openingRatio;
      if (
        destination &&
        aspectSafe(sourceAspect, destinationAspect) &&
        aspectSafe(expectedAspect, destinationAspect) &&
        aspectSafe(posterContentAspect, destinationAspect)
      )
        name(destination, 'vt-hero');
    }
  };
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(render);
  } catch {
    // A rejected capture must never prevent navigation or run its update twice.
    cancelTransition();
    update();
    settleAfter(direction, returned, focusIntent);
    return;
  }
  active = transition;
  // skipTransition() rejects ready even when nobody is waiting for the player to mount.
  void transition.ready.catch(() => undefined);
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      if (active === transition) {
        active = undefined;
        delete root.dataset.pageTransition;
        unnameAll();
      }
      if (run === sequence) settleAfter(direction, returned, focusIntent);
    });
}

/* ---------- In-place swaps (a suite's runs) ----------
 * The runs sidebar stays perfectly still (its live layer, so only its selection glides), the frame crossfades
 * between the two runs at its rect (resizing smoothly if the aspect differs), the top bar and transport
 * crossfade in place, and the step rail and panel crossfade with a 4 px rise (styles.css, "run"). The new run
 * renders complete inside the update (rrweb included: a crossfade has nothing to stall). Data is warmed by
 * the caller, without a loading or animation wait. A switch while one runs (a held J) lands at once.
 */

let inPlace = false;

/** True while an in-place swap renders: the player mounts at once, lists fill at once. */
export const swappingInPlace = () => inPlace;

export function swapInPlace(update: () => void, ready: Promise<unknown>, { instant = false }: { instant?: boolean } = {}) {
  const root = document.documentElement;
  root.dataset.navigated = '';
  // The opened card's poster belongs to the run the page opened on, not to the next one.
  hint = undefined;
  const run = ++sequence;
  void ready.catch(() => undefined);
  let updated = false;
  const apply = () => {
    if (run !== sequence || updated) return;
    updated = true;
    inPlace = true;
    try {
      flushSync(update);
    } finally {
      inPlace = false;
    }
  };
  if (instant || active || !supportsTransitions()) {
    cancelTransition();
    apply();
    return;
  }
  cancelTransition();
  nameTopbar(route);
  name(document.querySelector('.app-shell .player-frame'), 'vt-hero');
  root.dataset.pageTransition = 'run';
  const render = () => {
    if (run !== sequence || updated) return;
    unnameAll();
    apply();
    if (run !== sequence) return;
    nameTopbar(route);
    name(document.querySelector('.app-shell .player-frame, .app-shell .sk-frame'), 'vt-hero');
  };
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(render);
  } catch {
    cancelTransition();
    apply();
    return;
  }
  active = transition;
  void transition.ready.catch(() => undefined);
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      if (active !== transition) return;
      active = undefined;
      delete root.dataset.pageTransition;
      unnameAll();
    });
}

type NavState = { __nav?: { fromIndex?: boolean } };

/** Opens `href` in this document (a pushed history entry). Returns false when it isn't an in-app page. */
export function navigate(href: string, { clicked, replace = false }: { clicked?: HTMLAnchorElement | null; replace?: boolean } = {}) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || !isAppPage(url.pathname)) return false;
  const next = parseRoute(url.pathname, url.search);
  // Back to the index you came from: step back in history instead of stacking another index entry.
  if (next.kind === 'index' && route.kind !== 'index' && (history.state as NavState | null)?.__nav?.fromIndex && sameIndex(url)) {
    history.back();
    return true;
  }
  const state: NavState = { __nav: { fromIndex: route.kind === 'index' } };
  // The index may have rewritten its own URL (filters): leave from where it is now.
  const leaving = new URL(location.href);
  if (replace) history.replaceState(state, '', url);
  else history.pushState(state, '', url);
  show(next, { clicked, leaving });
  return true;
}

function onClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
  if (link.origin !== location.origin || link.getAttribute('href')?.startsWith('#')) return;
  const next = parseRoute(link.pathname, link.search);
  // Only page changes between the index and a viewer page; the index's own links (filters, the logo) stay as they are.
  if (routeKey(next) === routeKey(route)) return;
  if (!isAppPage(link.pathname)) return;
  event.preventDefault();
  navigate(link.href, { clicked: link });
}

function onPopState(event: PopStateEvent) {
  const next = parseRoute(location.pathname, location.search);
  if (routeKey(next) === routeKey(route) && pendingKey === undefined) return;
  // A swipe-back gesture already animated the change: don't animate it twice.
  show(next, { animate: !(event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition });
}

let installed = false;

/** Routes in-app page changes through this module. Call once, before the first render. */
export function installNavigation() {
  if (installed) return;
  installed = true;
  route = parseRoute(location.pathname, location.search);
  shownUrl = new URL(location.href);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('click', onClick);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('pointerdown', () => noteInput('pointer'), { capture: true, passive: true });
  window.addEventListener('keydown', (event) => {
    if (!['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) noteInput('keyboard');
  }, { capture: true });
  document.addEventListener('pointerover', onIntent, { passive: true });
  document.addEventListener('focusin', onIntent);
  document.addEventListener('load', onImageLoad, true);
  for (const image of document.querySelectorAll<HTMLImageElement>('.poster > img')) decodeImage(image);
  setClientNavigation(true);
}
