/**
 * Draws a replay's effects (src/shared/effects.ts) over the rrweb wrapper, as a pure function of the playhead, like
 * the replay cursor: the zoom is a transform on the wrapper (the page, the cursor and the step outline zoom together)
 * and each blur box is an element over the recorded page that blurs what is under it. The viewer, the editor preview
 * and the server's video render all draw through this, so an MP4 hides exactly what the viewer hides.
 *
 * Blur boxes sit beside the wrapper, not in it: they are placed through the zoom and clipped to the frame
 * (effects.ts blurRect), because Chromium drops a backdrop-filter whose box reaches past a clipping ancestor.
 * Styles are inline: the render page has none of the app's stylesheet.
 */
import { type BlurStyle, blurRect, blursAt, NO_EFFECTS, type PlaybackEffects, zoomAt, zoomTransform } from '../shared/effects.ts';

/** Blur radius in recorded px: enough that text under it cannot be read at any zoom. */
const BLUR_PX = 18;
/** The soft edge, recorded px, drawn outside the box so the box itself stays fully hidden. */
const FEATHER_PX = 8;
const FEATHER_MASK = (edge: string) =>
  `linear-gradient(${edge}, transparent, #000 ${FEATHER_PX}px, #000 calc(100% - ${FEATHER_PX}px), transparent)`;

/** Inline styles per blur style: the render page has none of the app's stylesheet. */
function boxStyle(style: BlurStyle | undefined): Partial<CSSStyleDeclaration> {
  if (style === 'redact') return { background: '#1d2027', boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.08)', borderRadius: '4px' };
  return {
    backdropFilter: `blur(${BLUR_PX}px)`,
    background: 'rgb(255 255 255 / 0.04)',
    borderRadius: `${FEATHER_PX}px`,
    maskImage: `${FEATHER_MASK('to right')}, ${FEATHER_MASK('to bottom')}`,
    maskComposite: 'intersect',
  };
}

/** A blur box grown outward by its feather, still clipped to the frame; a redaction is drawn exactly. */
function featheredRect(
  rect: ReturnType<typeof blurRect>,
  style: BlurStyle | undefined,
  scale: number,
  viewport: { width: number; height: number },
) {
  if (!rect || style === 'redact') return rect;
  const pad = FEATHER_PX * scale;
  const left = Math.max(0, rect.left - pad);
  const top = Math.max(0, rect.top - pad);
  const right = Math.min(viewport.width, rect.left + rect.width + pad);
  const bottom = Math.min(viewport.height, rect.top + rect.height + pad);
  return { left, top, width: right - left, height: bottom - top };
}

export class EffectsLayer {
  private effects: PlaybackEffects = NO_EFFECTS;
  private readonly boxes: HTMLElement[] = [];
  private suspendZoom = false;
  private last = '';

  private readonly wrapper: HTMLElement;
  private readonly viewport: () => { width: number; height: number };

  constructor(wrapper: HTMLElement, viewport: () => { width: number; height: number }) {
    this.wrapper = wrapper;
    this.viewport = viewport;
    wrapper.style.transformOrigin = '0 0';
  }

  set(effects: PlaybackEffects, time: number) {
    this.effects = effects;
    for (const box of this.boxes.splice(0)) box.remove();
    const parent = this.wrapper.parentElement ?? this.wrapper;
    for (const blur of effects.blurs) {
      const box = this.wrapper.ownerDocument.createElement('div');
      box.className = 'replay-blur';
      box.setAttribute('aria-hidden', 'true');
      Object.assign(box.style, {
        position: 'absolute',
        zIndex: '3',
        left: '0',
        top: '0',
        pointerEvents: 'none',
        display: 'none',
        ...boxStyle(blur.style),
      } satisfies Partial<CSSStyleDeclaration>);
      box.dataset.style = blur.style ?? 'blur';
      // why: Safari still needs the prefixed backdrop filter and mask for a viewer opened there.
      if (box.style.backdropFilter) box.style.setProperty('-webkit-backdrop-filter', box.style.backdropFilter);
      if (box.style.maskImage) {
        box.style.setProperty('-webkit-mask-image', box.style.maskImage);
        box.style.setProperty('-webkit-mask-composite', 'source-in');
      }
      parent.append(box);
      this.boxes.push(box);
    }
    this.last = '';
    this.update(time);
  }

  /** The editor holds the zoom at 1× while a blur box is being placed, so the box matches the page under it. */
  setZoomSuspended(suspended: boolean, time: number) {
    this.suspendZoom = suspended;
    this.last = '';
    this.update(time);
  }

  update(time: number) {
    const viewport = this.viewport();
    const zoom = this.suspendZoom ? { scale: 1, x: 0, y: 0 } : zoomTransform(zoomAt(this.effects.zooms, time, viewport), viewport);
    const shown = blursAt(this.effects.blurs, time);
    const key = `${zoom.scale.toFixed(4)},${zoom.x.toFixed(2)},${zoom.y.toFixed(2)}|${shown.join(',')}|${viewport.width}x${viewport.height}`;
    if (key === this.last) return;
    this.last = key;
    this.wrapper.style.transform = zoom.scale === 1 ? '' : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    for (const [index, box] of this.boxes.entries()) {
      const blur = this.effects.blurs[index];
      const rect =
        blur && shown.includes(index) ? featheredRect(blurRect(blur, zoom, viewport), blur.style, zoom.scale, viewport) : undefined;
      if (!rect) {
        box.style.display = 'none';
        continue;
      }
      Object.assign(box.style, {
        display: 'block',
        transform: `translate(${rect.left}px, ${rect.top}px)`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }
  }

  destroy() {
    for (const box of this.boxes.splice(0)) box.remove();
    this.wrapper.style.transform = '';
  }
}
