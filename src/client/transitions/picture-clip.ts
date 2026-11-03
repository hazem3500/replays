const CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const;
type Corners = Record<(typeof CORNERS)[number], string>;
const radii = new Map<Element, Corners>();
const opacities = new Map<Element, number>();
const styles = new Map<HTMLElement, Map<string, { value: string; priority: string }>>();

function override(element: HTMLElement, property: string, value: string) {
  let original = styles.get(element);
  if (!original) {
    original = new Map();
    styles.set(element, original);
  }
  if (!original.has(property))
    original.set(property, { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
  element.style.setProperty(property, value, 'important');
}

/** Original clipping corners remain available after rectangular snapshot preparation. */
export function pictureRadius(element: Element): Corners {
  const known = radii.get(element);
  if (known) return known;
  const clip = element.closest('.poster, .ct-tile') ?? element.querySelector(':scope > .sk-poster') ?? element;
  const style = getComputedStyle(clip);
  return {
    borderTopLeftRadius: style.borderTopLeftRadius,
    borderTopRightRadius: style.borderTopRightRadius,
    borderBottomRightRadius: style.borderBottomRightRadius,
    borderBottomLeftRadius: style.borderBottomLeftRadius,
  };
}

/** Capture opacity is independent from the depth opacity animated on the compositor group. */
export function pictureOpacity(element: Element): number {
  const known = opacities.get(element);
  if (known !== undefined) return known;
  const opacity = Number.parseFloat(getComputedStyle(element).opacity);
  return Number.isFinite(opacity) ? opacity : 1;
}

function squareCorners(element: HTMLElement) {
  const clip = getComputedStyle(element).clipPath;
  override(element, 'border-radius', '0px');
  // why: translated rear images still need their rectangular crop while only the rounded corners interpolate.
  if (clip.startsWith('inset(') && /\sround\s/.test(clip)) override(element, 'clip-path', clip.replace(/\s+round[\s\S]*\)$/, ')'));
}

/** Snapshot full corner pixels without changing the media's rectangular crop or paint containment. */
export function preparePictureClip(element: HTMLElement) {
  if (!radii.has(element)) radii.set(element, pictureRadius(element));
  if (!opacities.has(element)) opacities.set(element, pictureOpacity(element));
  override(element, 'opacity', '1');
  squareCorners(element);
  if (element.matches('.card-back, .stack-layer')) {
    for (const child of element.querySelectorAll<HTMLElement>(':scope > .poster, :scope > .poster > img, :scope > .poster > video'))
      squareCorners(child);
  }
  let ancestor: HTMLElement | null = element.parentElement;
  while (ancestor) {
    if (ancestor.matches('.poster, .card-back, .stack-layer, .shuffle-window, .poster-stack, .ct-tile, .player-frame'))
      squareCorners(ancestor);
    if (ancestor.matches('.feed-item, .ct-tile, .player-frame')) break;
    ancestor = ancestor.parentElement;
  }
}

/**
 * Places a picture so it covers `rect` for the next capture; restored with the other capture-owned properties.
 * why: an interrupted page change shows its first captured frame while the router commits; it must match the screen.
 */
export function placePicture(element: Element, rect: DOMRect) {
  if (!(element instanceof HTMLElement)) return;
  override(element, 'transform', 'none');
  const layout = element.getBoundingClientRect();
  if (!(layout.width > 0 && layout.height > 0)) return;
  override(element, 'transform-origin', '0 0');
  const scale = `scale(${rect.width / layout.width}, ${rect.height / layout.height})`;
  override(element, 'transform', `translate(${rect.x - layout.x}px, ${rect.y - layout.y}px) ${scale}`);
}

/** Restores only capture-owned properties, including inline priorities, on commit and cancellation. */
export function restorePictureClips() {
  for (const [element, properties] of styles) {
    for (const [property, original] of properties) {
      if (original.value) element.style.setProperty(property, original.value, original.priority);
      else element.style.removeProperty(property);
    }
  }
  styles.clear();
  radii.clear();
  opacities.clear();
}
