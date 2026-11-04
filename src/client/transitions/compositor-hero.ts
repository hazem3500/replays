import { pictureOpacity, pictureRadius, placePicture } from './picture-clip.ts';

const WIDTH = '--page-hero-width';
const HEIGHT = '--page-hero-height';
const CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const;
const CORNER_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface Corner {
  x: number;
  y: number;
}

/** A picture as one end of a flight: where it is, where its front sits in it, its corners and its depth opacity. */
export interface Picture {
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
  /** The canvas in units of the front picture: where the front sits inside each snapshot. */
  unit: DOMRect;
  snapshots: Record<'old' | 'new', { x: number; y: number; width: number; height: number }>;
}

const owners = new Map<string, { token: object; sheet: HTMLStyleElement }>();
/** Each landing hero's on-screen front picture, read while its transition runs. */
const flying = new Map<string, () => DOMRect | undefined>();
/** Where interrupted heroes were when a newer page change skipped their transition. */
const interrupted = new Map<string, DOMRect>();
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
    unit: new DOMRect(left, top, width, height),
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

/**
 * The spot a run with no sheet of its own leaves from and returns to: this sheet's box, unseen.
 * why: it is measured while the stack shows, since the index is hidden by the time the comparison is captured.
 */
export function standIn(element: Element | null | undefined): Picture | undefined {
  const picture = measure(element);
  return picture && { ...picture, opacity: 0 };
}

/** The front picture's rectangle on screen right now, from its group's animated canvas. */
function frontInFlight(name: string, morph: Morph) {
  const style = getComputedStyle(document.documentElement, `::view-transition-group(${name})`);
  if (style.transform === 'none') return;
  const matrix = new DOMMatrixReadOnly(style.transform);
  const width = morph.width * matrix.a;
  const height = morph.height * matrix.d;
  if (!(width > 0 && height > 0)) return;
  const { unit } = morph;
  return new DOMRect(
    matrix.e - (unit.x / unit.width) * width,
    matrix.f - (unit.y / unit.height) * height,
    width / unit.width,
    height / unit.height,
  );
}

/** Places a picture so its front sits at `front`, keeping its own proportions, and measures it there. */
function startAt(element: Element | null | undefined, picture: Picture, front: DOMRect) {
  const scaleX = front.width / picture.front.width;
  const scaleY = front.height / picture.front.height;
  const { rect } = picture;
  if (element)
    placePicture(
      element,
      new DOMRect(
        front.x + (rect.x - picture.front.x) * scaleX,
        front.y + (rect.y - picture.front.y) * scaleY,
        rect.width * scaleX,
        rect.height * scaleY,
      ),
    );
  return measure(element) ?? picture;
}

/**
 * Records where every flying hero is, before a newer page change skips the transition carrying it.
 * why: the next transition then starts each shared picture where it is on screen, not where the skipped one would land.
 */
export function rememberInFlight() {
  interrupted.clear();
  for (const [name, read] of flying) {
    const front = read();
    if (front) interrupted.set(name, front);
  }
}

function transform(picture: Picture, morph: Morph) {
  const { rect } = picture;
  return `translate(${rect.left}px, ${rect.top}px) scale(${rect.width / morph.width}, ${rect.height / morph.height})`;
}

function cornerValue(picture: Picture, property: (typeof CORNERS)[number], morph: Morph) {
  const radius = picture.corners[property];
  return `${(radius.x * morph.width) / picture.rect.width}px ${(radius.y * morph.height) / picture.rect.height}px`;
}

/** The fixed canvas's transform with its position `progress` of the way along and its size from `size`. */
function transformAt(morph: Morph, progress: number, size: Picture) {
  const x = morph.before.rect.left + (morph.after.rect.left - morph.before.rect.left) * progress;
  const y = morph.before.rect.top + (morph.after.rect.top - morph.before.rect.top) * progress;
  return `translate(${x}px, ${y}px) scale(${size.rect.width / morph.width}, ${size.rect.height / morph.height})`;
}

const SIZE_SETTLED = 0.99;

/** How a flight is shaped: `lag` holds the stacked size while sheets spread out (fan-out.ts). */
export interface FlightShape {
  lag: number;
  returning: boolean;
}

function geometry(morph: Morph, { lag, returning }: FlightShape) {
  const start: Keyframe = { offset: 0, transform: transform(morph.before, morph), opacity: morph.before.opacity };
  const end: Keyframe = { offset: 1, transform: transform(morph.after, morph), opacity: morph.after.opacity };
  for (const property of CORNERS) {
    start[property] = cornerValue(morph.before, property, morph);
    end[property] = cornerValue(morph.after, property, morph);
  }
  // why: a dimmed rear sheet turns opaque as it leaves its stack and dims again only as it lands back in it.
  const frames: Keyframe[] = [
    start,
    end,
    { offset: returning ? 0.8 : 0.2, opacity: returning ? morph.before.opacity : morph.after.opacity },
  ];
  if (lag > 0) {
    const at = returning ? 1 - lag : lag;
    frames.push({ offset: at, transform: transformAt(morph, at, returning ? morph.after : morph.before) });
  }
  // why: the spring overshoots along the final segment; full size before it keeps the bounce in the position alone.
  frames.push({ offset: SIZE_SETTLED, transform: transformAt(morph, SIZE_SETTLED, morph.after) });
  return frames.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
}

function retarget(effect: KeyframeEffect, morph: Morph, shape: FlightShape) {
  const frames = effect.getKeyframes();
  if (frames.some((frame) => 'width' in frame || 'height' in frame || 'transform' in frame)) {
    // why: fixed-size snapshots move on the compositor while Motion retains its authored spring timing.
    effect.setKeyframes(geometry(morph, shape));
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

/**
 * Adapts Motion's captured hero geometry to fixed-size compositor transforms without replacing its controls.
 * `from` stands in for a source the old page never showed (standIn); `capture` takes one for a missing destination.
 */
export function createCompositorHero(element: Element | null | undefined, name = 'vt-page-hero', zIndex = 2, from?: Picture) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw new Error('Invalid compositor hero name');
  if (!Number.isFinite(zIndex)) throw new Error('Invalid compositor hero depth');
  const measured = from ?? measure(element);
  const start = interrupted.get(name);
  interrupted.delete(name);
  const before = measured && start && !from ? startAt(element, measured, start) : measured;
  const token = {};
  let morph: Morph | undefined;
  let sheet: HTMLStyleElement | undefined;
  let created: Animation | undefined;
  const read = () => (morph ? frontInFlight(name, morph) : undefined);
  return {
    capture(afterElement: Element | null | undefined, to?: Picture) {
      const after = to ?? measure(afterElement);
      if (!before || !after) return false;
      morph = register(before, after);
      sheet?.remove();
      owners.get(name)?.sheet.remove();
      sheet = registration(name, morph, zIndex);
      owners.set(name, { token, sheet });
      flying.set(name, read);
      return true;
    },
    flight() {
      return morph ? { from: morph.before.rect, to: morph.after.rect } : undefined;
    },
    // why: a picture in only one snapshot gets no browser flight; given a sibling's spring timing, it flies on its own.
    prepare(shape: FlightShape = { lag: 0, returning: false }, timing?: EffectTiming) {
      if (!morph || owners.get(name)?.token !== token) return;
      const pseudoElement = `::view-transition-group(${name})`;
      let retargeted = false;
      for (const animation of document.getAnimations()) {
        if (animation.playState === 'finished' || animation.playState === 'idle') continue;
        const { effect } = animation;
        if (!(effect instanceof KeyframeEffect) || effect.pseudoElement !== pseudoElement) continue;
        retarget(effect, morph, shape);
        retargeted = true;
      }
      if (retargeted || !timing) return;
      created?.cancel();
      created = document.documentElement.animate(geometry(morph, shape), { ...timing, pseudoElement, fill: 'both' });
    },
    clear() {
      created?.cancel();
      created = undefined;
      if (flying.get(name) === read) flying.delete(name);
      morph = undefined;
      sheet?.remove();
      sheet = undefined;
      if (owners.get(name)?.token === token) owners.delete(name);
    },
  };
}
