import { pictureOpacity, pictureRadius } from './picture-clip.ts';

const WIDTH = '--page-hero-width';
const HEIGHT = '--page-hero-height';
const CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const;
const CORNER_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface Corner {
  x: number;
  y: number;
}

interface Picture {
  opacity: number;
  rect: DOMRect;
  front: DOMRect;
  corners: Record<(typeof CORNERS)[number], Corner>;
}

interface Morph {
  before: Picture;
  after: Picture;
  width: number;
  height: number;
  snapshots: Record<'old' | 'new', { x: number; y: number; width: number; height: number }>;
}

const owners = new Map<string, { token: object; sheet: HTMLStyleElement }>();
const SNAPSHOT_PROPERTIES = ['x', 'y', 'width', 'height'] as const;

function frontOf(element: Element, rect: DOMRect) {
  const poster = element.matches('.shuffle-window, .poster-stack')
    ? element.querySelector(':scope > .poster:not(.poster-outgoing), :scope > .stack-front > .poster')
    : null;
  if (poster) {
    const front = poster.getBoundingClientRect();
    if (front.width > 0 && front.height > 0) return front;
  }
  if (!element.matches('.ct-picture')) return rect;
  const style = getComputedStyle(element);
  const width = Number.parseFloat(style.getPropertyValue('--frame-w'));
  const height = Number.parseFloat(style.getPropertyValue('--frame-h'));
  const x = Number.parseFloat(style.getPropertyValue('--frame-x')) || 0;
  const y = Number.parseFloat(style.getPropertyValue('--frame-y')) || 0;
  const cssWidth = Number.parseFloat(style.width);
  const cssHeight = Number.parseFloat(style.height);
  const scaleX = cssWidth > 0 ? rect.width / cssWidth : 1;
  const scaleY = cssHeight > 0 ? rect.height / cssHeight : 1;
  return width > 0 && height > 0 ? new DOMRect(rect.x + x * scaleX, rect.y + y * scaleY, width * scaleX, height * scaleY) : rect;
}

function normalized(picture: Picture) {
  const { rect, front } = picture;
  return new DOMRect(
    (rect.x - front.x) / front.width,
    (rect.y - front.y) / front.height,
    rect.width / front.width,
    rect.height / front.height,
  );
}

function register(before: Picture, after: Picture): Morph {
  const old = normalized(before);
  const next = normalized(after);
  const left = Math.min(old.left, next.left);
  const top = Math.min(old.top, next.top);
  const width = Math.max(old.right, next.right) - left;
  const height = Math.max(old.bottom, next.bottom) - top;
  const project = (picture: Picture) => ({
    ...picture,
    rect: new DOMRect(
      picture.front.x + left * picture.front.width,
      picture.front.y + top * picture.front.height,
      width * picture.front.width,
      height * picture.front.height,
    ),
  });
  const projectedBefore = project(before);
  const projectedAfter = project(after);
  const base =
    projectedBefore.rect.width * projectedBefore.rect.height > projectedAfter.rect.width * projectedAfter.rect.height
      ? projectedBefore.rect
      : projectedAfter.rect;
  const snapshotBox = (snapshot: DOMRect) => ({
    x: ((snapshot.x - left) / width) * base.width,
    y: ((snapshot.y - top) / height) * base.height,
    width: (snapshot.width / width) * base.width,
    height: (snapshot.height / height) * base.height,
  });
  return {
    before: projectedBefore,
    after: projectedAfter,
    width: base.width,
    height: base.height,
    snapshots: { old: snapshotBox(old), new: snapshotBox(next) },
  };
}

function registration(name: string, morph: Morph, zIndex: number) {
  const sheet = document.createElement('style');
  sheet.dataset.pageHeroCanvas = name;
  const values = [`${WIDTH}:${morph.width}px`, `${HEIGHT}:${morph.height}px`, `z-index:${zIndex}!important`];
  for (const [side, snapshot] of [
    ['old', morph.snapshots.old],
    ['new', morph.snapshots.new],
  ] as const) {
    for (const property of SNAPSHOT_PROPERTIES) values.push(`--page-hero-${side}-${property}:${snapshot[property]}px`);
  }
  sheet.textContent = `html[data-page-hero]::view-transition-group(${name}){${values.join(';')}}`;
  document.head.append(sheet);
  return sheet;
}

function radiusPart(value: string, basis: number) {
  const numeric = Number.parseFloat(value) || 0;
  return value.endsWith('%') ? (numeric * basis) / 100 : numeric;
}

function measure(element: Element | null | undefined): Picture | undefined {
  if (!element?.isConnected) return;
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return;
  const radii = pictureRadius(element);
  const corner = (property: (typeof CORNERS)[number]) => {
    const [horizontal = '0', vertical = horizontal] = radii[property].split(/\s+/);
    return { x: radiusPart(horizontal, rect.width), y: radiusPart(vertical, rect.height) };
  };
  return {
    rect,
    front: frontOf(element, rect),
    opacity: pictureOpacity(element),
    corners: {
      borderTopLeftRadius: corner('borderTopLeftRadius'),
      borderTopRightRadius: corner('borderTopRightRadius'),
      borderBottomRightRadius: corner('borderBottomRightRadius'),
      borderBottomLeftRadius: corner('borderBottomLeftRadius'),
    },
  };
}

function transform(picture: Picture, morph: Morph) {
  const { rect } = picture;
  return `translate(${rect.left}px, ${rect.top}px) scale(${rect.width / morph.width}, ${rect.height / morph.height})`;
}

function cornerValue(picture: Picture, property: (typeof CORNERS)[number], morph: Morph) {
  const radius = picture.corners[property];
  return `${(radius.x * morph.width) / picture.rect.width}px ${(radius.y * morph.height) / picture.rect.height}px`;
}

function retarget(effect: KeyframeEffect, morph: Morph) {
  const frames = effect.getKeyframes();
  if (frames.some((frame) => 'width' in frame || 'height' in frame || 'transform' in frame)) {
    // why: fixed-size snapshots move on the compositor while Motion retains its authored spring timing.
    const before: Keyframe = { transform: transform(morph.before, morph), opacity: morph.before.opacity };
    const after: Keyframe = { transform: transform(morph.after, morph), opacity: morph.after.opacity };
    for (const property of CORNERS) {
      before[property] = cornerValue(morph.before, property, morph);
      after[property] = cornerValue(morph.after, property, morph);
    }
    effect.setKeyframes([before, after]);
    return;
  }
  const shorthand = frames.some((frame) => 'borderRadius' in frame);
  const properties = CORNERS.filter((property) => shorthand || frames.some((frame) => property in frame));
  if (!properties.length) return;
  const keyframes: PropertyIndexedKeyframes = {};
  for (const property of properties)
    keyframes[property] = [cornerValue(morph.before, property, morph), cornerValue(morph.after, property, morph)];
  effect.setKeyframes(keyframes);
  // why: geometry may overshoot, but corner radii must settle without becoming negative or snapping at handoff.
  effect.updateTiming({ easing: CORNER_EASE });
}

/** Adapts Motion's captured hero geometry to fixed-size compositor transforms without replacing its controls. */
export function createCompositorHero(element: Element | null | undefined, name = 'vt-page-hero', zIndex = 2) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw new Error('Invalid compositor hero name');
  if (!Number.isFinite(zIndex)) throw new Error('Invalid compositor hero depth');
  const before = measure(element);
  const token = {};
  let morph: Morph | undefined;
  let sheet: HTMLStyleElement | undefined;
  return {
    capture(afterElement: Element | null | undefined) {
      const after = measure(afterElement);
      if (!before || !after) return false;
      morph = register(before, after);
      sheet?.remove();
      owners.get(name)?.sheet.remove();
      sheet = registration(name, morph, zIndex);
      owners.set(name, { token, sheet });
      return true;
    },
    prepare() {
      if (!morph || owners.get(name)?.token !== token) return;
      for (const animation of document.getAnimations()) {
        if (animation.playState === 'finished' || animation.playState === 'idle') continue;
        const { effect } = animation;
        if (!(effect instanceof KeyframeEffect) || effect.pseudoElement !== `::view-transition-group(${name})`) continue;
        retarget(effect, morph);
      }
    },
    clear() {
      morph = undefined;
      sheet?.remove();
      sheet = undefined;
      if (owners.get(name)?.token === token) owners.delete(name);
    },
  };
}
