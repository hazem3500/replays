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
import { blurRect, blursAt, NO_EFFECTS, type PlaybackEffects, zoomAt, zoomTransform } from '../shared/effects.ts';

/** Blur radius in recorded px: enough that text under it cannot be read at any zoom. */
const BLUR_PX = 16;

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
    for (const _blur of effects.blurs) {
      const box = this.wrapper.ownerDocument.createElement('div');
      box.className = 'replay-blur';
      box.setAttribute('aria-hidden', 'true');
      Object.assign(box.style, {
        position: 'absolute',
        zIndex: '3',
        left: '0',
        top: '0',
        // A strong blur, plus a light veil so the box reads as one even over a plain background.
        backdropFilter: `blur(${BLUR_PX}px) saturate(0.7)`,
        background: 'rgb(140 140 150 / 0.3)',
        borderRadius: '6px',
        pointerEvents: 'none',
        display: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      (box.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = box.style.backdropFilter;
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
      const rect = shown.includes(index) ? blurRect(this.effects.blurs[index]!, zoom, viewport) : undefined;
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
