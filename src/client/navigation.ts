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
 * Index ↔ viewer runs as one View Transition (styles.css, "Page changes"), tagged `html[data-page-transition]`:
 * - The card's poster (or its live hover preview) morphs into the recorded frame inside the player: the
 *   viewer draws the same poster at the frame's exact rect (`.player-frame`, Transport.tsx) until rrweb has
 *   painted underneath, then crossfades to it. rrweb mounts only after the transition, so nothing heavy runs
 *   while the morph is on screen.
 * - The title and the source line move to the top bar as crossfading text (position only, never scaled), the
 *   duration badge fades where it was, the viewer's regions rise in 30–40 ms apart and the index recedes.
 * - Back reverses it into the card you came from (scroll restored first); a card that is off screen fades.
 * The new page renders inside the update callback: cached data and loaded code render the viewer itself (no
 * skeleton); otherwise the skeleton lands under the morph and the content crossfades in after it.
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

/** How long a page change may hold the old page to render the new one complete (cached data, loaded code). */
const PREPARE_BUDGET_MS = 80;

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

function onScreen(element: Element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
}

/** The index card that stands for a viewer route: the clicked link's card, else the first link to its page. */
function cardFor(target: Route, clicked?: HTMLAnchorElement | null) {
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
  const poster = card.querySelector('.stack-front > .poster') ?? card.querySelector(':scope > .poster');
  return { card, link, poster: poster && onScreen(poster) ? poster : undefined, source: card.querySelector('.source-lead') };
}

/** Names the index side: the card's poster, title, badge and source line. */
function nameCard(match: ReturnType<typeof cardFor>) {
  if (!match) return;
  if (match.poster) {
    name(match.poster, 'vt-hero');
    name(match.poster.querySelector('.poster-badge'), 'vt-badge');
  }
  if (onScreen(match.link)) name(match.link, 'vt-title');
  if (match.source && onScreen(match.source)) name(match.source, 'vt-source');
}

/** Names the viewer side: the recorded frame (the replay, or the poster over it while rrweb loads) and the title. */
function nameViewer() {
  const shell = document.querySelector('.app-shell:not(.skeleton-overlay *)');
  if (!shell) return;
  name(shell.querySelector('.player-frame, .sk-frame'), 'vt-hero');
  // A suite's card title is the suite's: it lands on the runs sidebar's heading.
  name(
    document.querySelector('.suite-sidebar-title h2') ?? shell.querySelector('.app-topbar .topbar-title-text, .sk-topbar .sk-title'),
    'vt-title',
  );
  name(shell.querySelector('.app-topbar .topbar-source-chip, .sk-topbar .sk-line-chip'), 'vt-source');
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
    () => decodedStills.add(still),
    () => undefined,
  );
}

let stillTimer = 0;
function onIntent(event: Event) {
  const card = event.target instanceof Element ? event.target.closest('.feed-item') : null;
  window.clearTimeout(stillTimer);
  if (card) stillTimer = window.setTimeout(() => warmStill(card), event.type === 'focusin' ? 0 : STILL_INTENT_MS);
}

function writeHint(target: Route, match: ReturnType<typeof cardFor>) {
  if (target.kind === 'index') return;
  const id = target.kind === 'replay' ? target.id : (target.replayId ?? target.id);
  const image = match?.poster?.querySelector<HTMLImageElement>(':scope > img');
  const ready = image?.complete && image.naturalWidth > 0;
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
      : ready
        ? { viewport: { width: image.naturalWidth, height: image.naturalHeight } }
        : {}),
    // The opening still (what rrweb paints first) when it is loaded, else the card's poster.
    ...(ready ? openingImage(image.currentSrc || image.src) : {}),
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

function settleAfter(direction: PageDirection, match: ReturnType<typeof cardFor>) {
  if (direction === 'to-index') {
    if (match) {
      match.link.focus({ preventScroll: true });
      match.card.setAttribute('data-returned', '');
      window.setTimeout(() => match.card.removeAttribute('data-returned'), 1600);
    }
    return;
  }
  const player = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
  const heading = document.querySelector<HTMLElement>('.app-shell:not(.skeleton-shell) .app-topbar h1');
  const target = player ?? heading;
  if (!target) {
    // Still on the skeleton (a slow load, a skipped or slow transition): hand the keyboard to the player as soon as
    // the viewer replaces it, unless the person has moved it somewhere themselves meanwhile.
    handToPlayerWhenReady();
    return;
  }
  if (target === heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

const PLAYER_SELECTOR = '.app-shell:not(.skeleton-shell) #replay-player';
/** How long a page may stay on its skeleton and still hand the keyboard to the player when it arrives. */
const PLAYER_WAIT_MS = 15_000;
let stopWaitingForPlayer: (() => void) | undefined;

function handToPlayerWhenReady() {
  stopWaitingForPlayer?.();
  const startedOn = document.activeElement;
  const untouched = () => {
    const current = document.activeElement;
    return !current || current === document.body || current === startedOn || Boolean(current.closest('.skeleton-shell, .skeleton-overlay'));
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

function delay(ms: number) {
  return new Promise<void>((done) => window.setTimeout(done, ms));
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
  if (routeKey(from) === routeKey(next)) {
    // Back to the page on screen before a change in flight rendered (Back at once after a click): drop it.
    if (pendingKey !== undefined && pendingKey !== routeKey(next)) {
      sequence++;
      active?.skipTransition();
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
  const match = direction === 'to-viewer' ? cardFor(next, clicked) : undefined;
  if (direction === 'to-viewer') {
    writeHint(next, match);
    opened = match?.link;
  }
  // Ready what renders at once (the viewer's code, a cached or nearly-there bundle) within a small budget.
  const ready =
    direction === 'to-viewer' || direction === 'page'
      ? Promise.race([prepare(next).catch(() => undefined), delay(PREPARE_BUDGET_MS)])
      : undefined;

  let returned: ReturnType<typeof cardFor>;
  const update = () => {
    if (run !== sequence) return;
    pendingKey = undefined;
    flushSync(() => commit(next));
    if (direction === 'to-index') returned = restoreIndex(from);
    else window.scrollTo(0, 0);
  };

  if (!animate || !supportsTransitions() || direction === 'page') {
    active?.skipTransition();
    void (ready ?? Promise.resolve()).then(() => {
      if (run !== sequence) return;
      update();
      settleAfter(direction, returned);
    });
    return;
  }

  active?.skipTransition();
  const root = document.documentElement;
  unnameAll();
  if (direction === 'to-viewer') nameCard(match);
  else nameViewer();
  root.dataset.pageTransition = direction;
  if (direction === 'to-viewer' && hint?.still) root.dataset.pageStill = '';
  else delete root.dataset.pageStill;
  const before = measureNamed();
  let morphs: Morph[] = [];
  const transition = document.startViewTransition(async () => {
    await ready;
    unnameAll();
    update();
    if (run !== sequence) return;
    if (direction === 'to-viewer') nameViewer();
    else nameCard(returned);
    morphs = planMorphs(before, measureNamed());
  });
  active = transition;
  transition.ready.then(() => runMorphs(morphs)).catch(() => undefined);
  transition.finished
    .catch(() => undefined)
    .then(() => {
      if (active === transition) {
        active = undefined;
        delete root.dataset.pageTransition;
        delete root.dataset.pageStill;
        unnameAll();
        morphStyle.textContent = '';
        // The lists that waited for the landing fade in rather than pop (styles.css html[data-landed]).
        if (direction === 'to-viewer') {
          root.dataset.landed = '';
          window.setTimeout(() => delete root.dataset.landed, 300);
        }
      }
      if (run === sequence) settleAfter(direction, returned);
    });
}

/* ---------- Compositor-only morphs ----------
 * The browser animates a shared element's group by width, height and transform, and width/height run on the
 * main thread: any work there (the viewer filling its lists) would stall the frame mid-flight. Instead each
 * group keeps one size (the larger of its two boxes, so the snapshot only ever scales down and stays sharp)
 * and moves on transform alone, which the compositor runs. Text never scales: it slides, and its two
 * renderings crossfade at their own size (styles.css).
 */

interface Box {
  rect: DOMRect;
  radius: number;
}
interface Morph {
  name: string;
  from: string;
  to: string;
  radius?: [number, number];
}

const SCALED = new Set(['vt-hero']);
const MOVED = new Set(['vt-hero', 'vt-title', 'vt-source']);

const morphStyle = typeof document === 'undefined' ? ({} as HTMLStyleElement) : document.createElement('style');

function measureNamed() {
  const boxes = new Map<string, Box>();
  for (const element of named) {
    const group = element.style.viewTransitionName;
    if (!MOVED.has(group)) continue;
    boxes.set(group, {
      rect: element.getBoundingClientRect(),
      radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
    });
  }
  return boxes;
}

function planMorphs(before: Map<string, Box>, after: Map<string, Box>) {
  const morphs: Morph[] = [];
  let css = '';
  for (const [group, old] of before) {
    const next = after.get(group);
    if (!next || old.rect.width === 0 || next.rect.width === 0) continue;
    const a = old.rect;
    const b = next.rect;
    if (SCALED.has(group)) {
      const base = a.width * a.height > b.width * b.height ? a : b;
      const [w, h] = [base.width, base.height];
      css += `html::view-transition-group(${group}) { width: ${w}px !important; height: ${h}px !important; transform-origin: 0 0 !important; }\n`;
      morphs.push({
        name: group,
        from: `translate(${a.left}px, ${a.top}px) scale(${a.width / w}, ${a.height / h})`,
        to: `translate(${b.left}px, ${b.top}px) scale(${b.width / w}, ${b.height / h})`,
        radius: [(old.radius * w) / a.width, (Math.max(next.radius, 2) * w) / b.width],
      });
    } else {
      css += `html::view-transition-group(${group}) { width: ${b.width}px !important; height: ${b.height}px !important; transform-origin: 0 0 !important; }\n`;
      morphs.push({ name: group, from: `translate(${a.left}px, ${a.top}px)`, to: `translate(${b.left}px, ${b.top}px)` });
    }
  }
  morphStyle.textContent = css;
  if (!morphStyle.isConnected) document.head.append(morphStyle);
  return morphs;
}

function runMorphs(morphs: Morph[]) {
  const root = document.documentElement;
  const animations = root.getAnimations({ subtree: true });
  for (const morph of morphs) {
    const pseudoElement = `::view-transition-group(${morph.name})`;
    const computed = getComputedStyle(root, pseudoElement);
    const duration = Number.parseFloat(computed.animationDuration) * 1000 || 400;
    const easing = computed.animationTimingFunction || 'ease';
    for (const animation of animations)
      if ((animation.effect as KeyframeEffect | null)?.pseudoElement === pseudoElement) animation.cancel();
    root.animate({ transform: [morph.from, morph.to] }, { pseudoElement, duration, easing, fill: 'both' });
    // Corners ease from the card's radius to the player's (in the group's own, unscaled space).
    if (morph.radius)
      root.animate(
        { borderRadius: morph.radius.map((value) => `${value}px`) },
        { pseudoElement, duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
      );
  }
}

/* ---------- In-place swaps (a suite's runs) ----------
 * The runs sidebar stays perfectly still (its live layer, so only its selection glides), the frame crossfades
 * between the two runs at its rect (resizing smoothly if the aspect differs), the top bar and transport
 * crossfade in place, and the step rail and panel crossfade with a 4 px rise (styles.css, "run"). The new run
 * renders complete inside the update (rrweb included: a crossfade has nothing to stall), and the old one stays
 * on screen while its data loads, up to a short wait. A switch while one runs (a held J) lands at once.
 */

let inPlace = false;

/** True while an in-place swap renders: the player mounts at once, lists fill at once. */
export const swappingInPlace = () => inPlace;

const RUN_WAIT_MS = 1200;

export function swapInPlace(update: () => void, ready: Promise<unknown>, { instant = false }: { instant?: boolean } = {}) {
  const root = document.documentElement;
  root.dataset.navigated = '';
  // The opened card's poster belongs to the run the page opened on, not to the next one.
  hint = undefined;
  const run = ++sequence;
  if (instant || active || !supportsTransitions()) {
    active?.skipTransition();
    update();
    return;
  }
  void Promise.race([ready.catch(() => undefined), delay(RUN_WAIT_MS)]).then(() => {
    if (run !== sequence) return;
    if (active) {
      update();
      return;
    }
    unnameAll();
    name(document.querySelector('.app-shell .player-frame'), 'vt-hero');
    root.dataset.pageTransition = 'run';
    const transition = document.startViewTransition(() => {
      unnameAll();
      inPlace = true;
      try {
        flushSync(update);
      } finally {
        inPlace = false;
      }
      name(document.querySelector('.app-shell .player-frame, .app-shell .sk-frame'), 'vt-hero');
    });
    active = transition;
    transition.finished
      .catch(() => undefined)
      .then(() => {
        if (active !== transition) return;
        active = undefined;
        delete root.dataset.pageTransition;
        unnameAll();
      });
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
  document.addEventListener('pointerover', onIntent, { passive: true });
  document.addEventListener('focusin', onIntent);
  setClientNavigation(true);
}
