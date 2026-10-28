import { writeSessionStorage } from '../storage.ts';
import { OPEN_HINT_KEY, type OpenHint } from '../ViewerSkeleton.tsx';
import type { CardMatch } from './shared-elements.ts';

/*
 * What the clicked card knows about the page it opens: its poster (and so the recording's aspect), title and step
 * count, so the viewer's skeleton has the real shape and the player's first frame is the card's picture.
 */

let hint: OpenHint | undefined;
let hintAt = Number.NEGATIVE_INFINITY;

/** The opened card's poster, for the player's first frame right after a navigation (none later on). */
export function freshPoster() {
  return hint?.poster && performance.now() - hintAt < 4000 ? hint.poster : undefined;
}

/** The opened card's poster belongs to the recording the page opened on, not to the next one. */
export function forgetHint() {
  hint = undefined;
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
 * Opening stills (src/server/posters.ts): the replay as the viewer first paints it, next to each poster. A card the
 * pointer rests on (or the keyboard reaches) loads its still, so opening it can land on exactly what rrweb will draw:
 * the morph crossfades poster → still mid-flight (styles.css, html[data-page-still]) and rrweb's hand-over is then a
 * crossfade between two identical pictures.
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

/** Pointer or keyboard intent on a card: load its opening still once the intent holds. */
export function onCardIntent(event: Event) {
  const card = event.target instanceof Element ? event.target.closest('.feed-item') : null;
  window.clearTimeout(stillTimer);
  if (card) stillTimer = window.setTimeout(() => warmStill(card), event.type === 'focusin' ? 0 : STILL_INTENT_MS);
}

/**
 * Records what the opened card knows, for the page `pageId` (a replay, or a suite: the skeleton reads it back on any of
 * its addresses). `replayId` is the recording it opens on (a suite's run, when the address names one).
 */
export function writeHint(pageId: string, replayId: string, match: CardMatch | undefined) {
  const image = match?.poster?.querySelector<HTMLImageElement>(':scope > img');
  const ready = image?.complete && image.naturalWidth > 0;
  // why: a suite's card shows its landing run's poster: that run's summary shapes the skeleton.
  const posterId = image ? /\/replays\/([^/]+)\/poster/.exec(image.src)?.[1] : undefined;
  const summary = listed.get(posterId ? decodeURIComponent(posterId) : replayId);
  hintAt = performance.now();
  hint = {
    id: replayId,
    ...(match ? { title: match.link.textContent?.trim() ?? '' } : {}),
    ...(summary ? { steps: summary.steps, source: Boolean(summary.sources?.length) } : {}),
    ...(summary?.viewport
      ? { viewport: summary.viewport }
      : ready
        ? { viewport: { width: image.naturalWidth, height: image.naturalHeight } }
        : {}),
    // why: the opening still (what rrweb paints first) when it is loaded, else the card's poster.
    ...(ready ? openingImage(image.currentSrc || image.src) : {}),
  };
  writeSessionStorage(OPEN_HINT_KEY, JSON.stringify({ ...hint, id: pageId }));
}
