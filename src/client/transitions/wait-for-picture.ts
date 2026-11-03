import { onScreen, viewerPicture } from './shared-elements.ts';

let stopWaiting: (() => void) | undefined;

/** A newer navigation must never wait behind a superseded destination's loading budget. */
export function stopPictureWait() {
  stopWaiting?.();
}

function imageSource(image: HTMLImageElement) {
  return [image.src, image.srcset, image.sizes, image.currentSrc].join('|');
}

/** A source change invalidates decoding; failed images use the bounded fade fallback. */
function coverReadiness(wake: () => void) {
  let stopped = false;
  const covers = new Map<HTMLImageElement, { source: string; decoded: boolean; decoding: boolean; failed: boolean }>();
  const unlisten = () => {
    for (const image of covers.keys()) {
      image.removeEventListener('load', wake);
      image.removeEventListener('error', wake);
    }
    covers.clear();
  };
  const ready = (element: Element) => {
    if (!element.matches('.ct-picture')) return true;
    const image = element.querySelector<HTMLImageElement>('.ct-cover');
    if (!image) return false;
    const source = imageSource(image);
    let cover = covers.get(image);
    if (!cover || cover.source !== source) {
      cover = { source, decoded: false, decoding: false, failed: false };
      covers.set(image, cover);
      image.addEventListener('load', wake);
      image.addEventListener('error', wake);
    }
    if (!image.complete || image.naturalWidth === 0 || cover.failed) return false;
    if (cover.decoded) return true;
    if (!cover.decoding) {
      const pending = cover;
      pending.decoding = true;
      void image.decode().then(
        () => {
          if (stopped || covers.get(image) !== pending || imageSource(image) !== pending.source) return;
          pending.decoded = true;
          wake();
        },
        () => {
          if (stopped || covers.get(image) !== pending || imageSource(image) !== pending.source) return;
          pending.failed = true;
          wake();
        },
      );
    }
    return false;
  };
  return {
    ready,
    stop: () => {
      stopped = true;
      unlisten();
    },
  };
}

function capturePictures(focus: Element, ids: readonly string[]) {
  if (!ids.length) return [focus];
  const tiles = [...document.querySelectorAll<HTMLElement>('.app-shell:not(.skeleton-shell) .ct-tile[data-tile-id]')];
  const pictures: Element[] = [];
  for (const id of ids) {
    const tile = tiles.find((candidate) => candidate.dataset.tileId === id);
    if (!tile) return;
    if (tile.dataset.role === 'hidden' || !onScreen(tile)) continue;
    const picture = tile.querySelector('.ct-picture');
    if (!picture) return;
    pictures.push(picture);
  }
  return pictures.length ? pictures : undefined;
}

interface PictureGeometry {
  rect: DOMRect;
  frame: DOMRect | undefined;
}

function pictureGeometry(element: Element): PictureGeometry | undefined {
  const rect = element.getBoundingClientRect();
  if (!element.matches('.ct-picture')) return { rect, frame: undefined };
  const style = getComputedStyle(element);
  const x = Number.parseFloat(style.getPropertyValue('--frame-x'));
  const y = Number.parseFloat(style.getPropertyValue('--frame-y'));
  const width = Number.parseFloat(style.getPropertyValue('--frame-w'));
  const height = Number.parseFloat(style.getPropertyValue('--frame-h'));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(width > 0 && height > 0)) return;
  const boxWidth = Number.parseFloat(style.width);
  const boxHeight = Number.parseFloat(style.height);
  if (!(boxWidth > 0 && boxHeight > 0) || x < -1 || y < -1 || x + width > boxWidth + 1 || y + height > boxHeight + 1) return;
  if (Math.min(Math.abs(boxWidth - width), Math.abs(boxHeight - height)) > 1) return;
  if (Math.abs((boxWidth - width) / 2 - x) > 1 || Math.abs((boxHeight - height) / 2 - y) > 1) return;
  return { rect, frame: new DOMRect(x, y, width, height) };
}

function sameRect(before: DOMRect, after: DOMRect) {
  return (
    Math.abs(before.x - after.x) < 0.5 &&
    Math.abs(before.y - after.y) < 0.5 &&
    Math.abs(before.width - after.width) < 0.5 &&
    Math.abs(before.height - after.height) < 0.5
  );
}

function stableRects(previous: Map<Element, PictureGeometry> | undefined, next: Map<Element, PictureGeometry>) {
  if (previous?.size !== next.size) return false;
  for (const [element, geometry] of next) {
    const before = previous.get(element);
    if (!before || !sameRect(before.rect, geometry.rect)) return false;
    if (before.frame && geometry.frame && !sameRect(before.frame, geometry.frame)) return false;
    if (Boolean(before.frame) !== Boolean(geometry.frame)) return false;
  }
  return true;
}

/** Waits for stable focused geometry and its decoded cover, never for playback or unrelated requests. */
export function waitForPicture(current: () => boolean, budget = 500, ids: readonly string[] = []): Promise<Element | undefined> {
  stopPictureWait();
  return new Promise((resolve) => {
    let previous: Map<Element, PictureGeometry> | undefined;
    let frame = 0;
    let timer = 0;
    let finished = false;
    const cover = coverReadiness(check);
    const observer = new MutationObserver(check);
    const deadline = window.setTimeout(() => {
      check();
      finish();
    }, budget);
    const stop = () => finish();
    stopWaiting = stop;
    function finish(element?: Element) {
      if (finished) return;
      finished = true;
      observer.disconnect();
      cover.stop();
      window.clearTimeout(deadline);
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      if (stopWaiting === stop) stopWaiting = undefined;
      resolve(element);
    }
    function check() {
      if (finished) return;
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      if (!current()) return finish();
      const element = viewerPicture(true);
      if (!element) {
        previous = undefined;
        return;
      }
      const pictures = capturePictures(element, ids);
      if (!pictures) {
        previous = undefined;
        return;
      }
      let painted = true;
      const rects = new Map<Element, PictureGeometry>();
      for (const picture of pictures) {
        if (!cover.ready(picture)) painted = false;
        const geometry = pictureGeometry(picture);
        if (geometry) rects.set(picture, geometry);
        else painted = false;
      }
      if (painted && stableRects(previous, rects)) return finish(element);
      previous = rects;
      frame = requestAnimationFrame(check);
      // why: a native capture can suspend frame callbacks while its async update is pending.
      timer = window.setTimeout(check, 32);
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-current', 'data-role', 'src', 'srcset', 'sizes'],
    });
    check();
  });
}
