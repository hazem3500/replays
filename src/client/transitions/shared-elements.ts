import { preparePictureClip, restorePictureClips } from './picture-clip.ts';

/* why: the elements a transition names: an in-place run swap pairs the player frame with itself. */

const named = new Set<HTMLElement>();
const classes = new Map<HTMLElement, { value: string; priority: string }>();

export function name(element: Element | null | undefined, value: string) {
  if (!(element instanceof HTMLElement)) return;
  element.style.setProperty('view-transition-name', value);
  named.add(element);
}

export function unnameAll() {
  for (const element of named) element.style.removeProperty('view-transition-name');
  named.clear();
  restorePictureClips();
  for (const [element, original] of classes) {
    if (original.value) element.style.setProperty('view-transition-class', original.value, original.priority);
    else element.style.removeProperty('view-transition-class');
  }
  classes.clear();
}

/** Snapshot the real clipping radius so Motion can interpolate asymmetric poster corners into the player. */
export function namePicture(element: Element | null | undefined, value: string) {
  if (!(element instanceof HTMLElement)) return;
  preparePictureClip(element);
  if (!classes.has(element))
    classes.set(element, {
      value: element.style.getPropertyValue('view-transition-class'),
      priority: element.style.getPropertyPriority('view-transition-class'),
    });
  element.style.setProperty('view-transition-class', `${classes.get(element)?.value ?? ''} page-hero`.trim());
  name(element, value);
}

export function onScreen(element: Element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
}

export interface CardMatch {
  card: HTMLElement;
  link: HTMLAnchorElement;
  poster: Element | undefined;
}

/** The index card that stands for a page: the clicked link's card, else the first visible link to it. */
export function cardFor(opens: (link: HTMLAnchorElement) => boolean, clicked?: HTMLAnchorElement | null): CardMatch | undefined {
  let link = clicked?.isConnected && clicked.closest('.feed-item') && opens(clicked) ? clicked : undefined;
  link ??= [...document.querySelectorAll<HTMLAnchorElement>('.index-shell a.row-target, a.row-target')].find(
    (candidate) => opens(candidate) && onScreen(candidate),
  );
  const card = link?.closest<HTMLElement>('.feed-item');
  if (!link || !card) return undefined;
  const poster = card.querySelector(
    '.suite-sheet > .shuffle-window > .poster:not(.poster-outgoing), .stack-front > .poster, :scope > .poster',
  );
  return { card, link, poster: poster && onScreen(poster) ? poster : undefined };
}

/** The loaded front picture, without its badge or card controls. */
export function cardPicture(match: CardMatch | undefined) {
  const video = match?.poster?.querySelector<HTMLVideoElement>(':scope > .poster-video[data-shown]');
  if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && onScreen(video)) return video;
  const image = match?.poster?.querySelector<HTMLImageElement>(':scope > img');
  return image?.complete && image.naturalWidth > 0 && onScreen(image) ? image : undefined;
}

/** Each distinct recording keeps its own stack depth; a repeated recording uses the frontmost source. */
export function cardPictures(card: HTMLElement | undefined, visible = true) {
  const pictures = new Map<string, Element>();
  if (!card?.matches('.feed-suite')) return pictures;
  const front = card.querySelector<HTMLElement>('.shuffle-window[data-replay-id], .stack-front[data-replay-id]');
  const rears = [...card.querySelectorAll<HTMLElement>('[data-stack-depth][data-replay-id]:not([data-stack-reserve])')].sort(
    (a, b) => Number(a.dataset.stackDepth) - Number(b.dataset.stackDepth),
  );
  for (const sheet of [front, ...rears]) {
    const id = sheet?.dataset.replayId;
    if (!sheet || !id || pictures.has(id) || (visible && !sheetShown(sheet))) continue;
    const picture = sheet === front ? frontPicture(sheet) : sheet;
    if (picture) pictures.set(id, picture);
  }
  return pictures;
}

function sheetShown(sheet: HTMLElement) {
  return onScreen(sheet) && getComputedStyle(sheet).opacity !== '0';
}

/** The front sheet's playing preview, else its loaded poster; nothing while the poster is still loading. */
function frontPicture(sheet: HTMLElement): Element | undefined {
  const video = sheet.querySelector<HTMLVideoElement>(':scope > .poster:not(.poster-outgoing) > .poster-video[data-shown]');
  if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return video;
  const image = sheet.querySelector<HTMLImageElement>(':scope > .poster:not(.poster-outgoing) > img');
  return image?.complete && image.naturalWidth > 0 ? image : undefined;
}

export function viewerPictures(ids: readonly string[]) {
  const pictures = new Map<string, Element>();
  for (const tile of document.querySelectorAll<HTMLElement>('.app-shell:not(.skeleton-shell) .ct-tile[data-tile-id]')) {
    const id = tile.dataset.tileId;
    const picture = tile.querySelector('.ct-picture');
    if (id && ids.includes(id) && picture && tile.dataset.role !== 'hidden' && onScreen(picture)) pictures.set(id, picture);
  }
  return pictures;
}

/** The focused comparison picture, single player, or matching loading frame, without its surrounding controls. */
export function viewerPicture(real = false) {
  const element = document.querySelector(
    real
      ? '.app-shell:not(.skeleton-shell) .ct-tile[data-current] .ct-picture, .app-shell:not(.skeleton-shell) .player-frame'
      : '.app-shell .ct-tile[data-current] .ct-picture, .app-shell .player-frame, .app-shell .sk-frame:has(.sk-poster)',
  );
  return element && element.getBoundingClientRect().height > 0 && onScreen(element) ? element : undefined;
}
