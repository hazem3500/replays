import { clickEffectOf, type ReplayCursorSettings } from '../shared/cursor.ts';
import type { ReplaySource } from '../shared/replay.ts';

import { buildCursorTrack, type CursorTrack, cursorInput, cursorPose, type Pose } from './cursor-motion.ts';
import { type CursorGlyph, cursorColorValue, cursorTheme } from './cursor-themes.ts';

/**
 * Our cursor inside the rrweb wrapper, in the replay's page coordinates. Only
 * the element's transform changes per frame; the glyph is counter-scaled so it
 * keeps one on-screen size whatever the replay's fit scale.
 */
export class ReplayCursor {
  private readonly element: HTMLDivElement;
  private readonly media: MediaQueryList | undefined;
  private track: CursorTrack;
  private settings: ReplayCursorSettings | undefined;
  private readonly pose: Pose = { visible: false, x: 0, y: 0, heading: 0, scale: 1, opacity: 1, press: -1 };
  private glyph: CursorGlyph | undefined;
  private glyphKey = '';
  private fitScale = 1;
  private contextScale = 1;
  /** The fit scale only changes when the stage or the recorded viewport resizes; measure it then, not every frame. */
  private fitDirty = true;
  private lastTime = Number.NaN;
  private lastTransform = '';
  private lastOpacity = '';
  private lastVisible: boolean | undefined;
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly fitObserver: MutationObserver | undefined;

  private readonly wrapper: HTMLElement;
  private readonly events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>;
  private readonly base: number;
  private readonly source: ReplaySource | undefined;

  constructor(
    wrapper: HTMLElement,
    events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>,
    base: number,
    settings?: ReplayCursorSettings,
    source?: ReplaySource,
  ) {
    this.wrapper = wrapper;
    this.source = source;
    this.events = events;
    this.base = base;
    this.settings = settings;
    this.media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
    this.track = this.planTrack();
    this.media?.addEventListener('change', this.onMotionPreference);

    const element = document.createElement('div');
    element.className = 'replay-cursor';
    element.setAttribute('aria-hidden', 'true');
    element.hidden = true;
    wrapper.append(element);
    this.element = element;
    this.mountGlyph();

    // The fit scale changes when the stage resizes; a transform on an ancestor fires no observer, so watch the stage boxes.
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(this.invalidateFit);
      for (let node: HTMLElement | null = wrapper.parentElement, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
        this.resizeObserver.observe(node);
      }
    }
    const host = wrapper.parentElement;
    if (host && typeof MutationObserver === 'function') {
      this.fitObserver = new MutationObserver(this.invalidateFit);
      this.fitObserver.observe(host, { attributes: true, attributeFilter: ['style'] });
    }
  }

  /** Places the cursor for playhead `time` (ms from the first event). */
  update(time: number) {
    this.lastTime = time;
    // Without a ResizeObserver nothing marks the fit stale, so measure every time.
    if (this.fitDirty || !this.resizeObserver) this.measureFit();
    const pose = cursorPose(this.track, this.base + time, this.pose);
    if (pose.visible !== this.lastVisible) {
      this.element.hidden = !pose.visible;
      this.lastVisible = pose.visible;
    }
    if (!pose.visible) return;
    this.glyph?.feedback(pose.press ?? -1);
    // Idle fade (cursorPose): written only when it changes, so a resting cursor costs no style writes.
    const opacity = pose.opacity >= 1 ? '' : pose.opacity.toFixed(3);
    if (opacity !== this.lastOpacity) {
      this.element.style.opacity = opacity;
      this.lastOpacity = opacity;
    }
    const transform = `translate3d(${pose.x.toFixed(2)}px,${pose.y.toFixed(2)}px,0) rotate(${(pose.heading - Math.PI / 4).toFixed(4)}rad) scale(${((pose.scale * (this.settings?.size ?? 1) * this.contextScale) / this.fitScale).toFixed(4)})`;
    if (transform === this.lastTransform) return;
    this.element.style.transform = transform;
    this.lastTransform = transform;
  }

  setSettings(settings: ReplayCursorSettings | undefined) {
    if (JSON.stringify(settings) === JSON.stringify(this.settings)) return;
    this.settings = settings;
    this.mountGlyph();
    this.onMotionPreference();
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.fitObserver?.disconnect();
    this.media?.removeEventListener('change', this.onMotionPreference);
    this.element.remove();
  }

  /** Draws the saved theme and tint; keeps the mounted glyph when neither changed. */
  private mountGlyph() {
    const theme = cursorTheme(this.settings?.appearance);
    const color = cursorColorValue(this.settings?.color);
    const effect = clickEffectOf(this.settings);
    const key = `${theme.id}|${color ?? ''}|${effect}`;
    if (key === this.glyphKey) return;
    this.glyphKey = key;
    const glyph = theme.create(this.element.ownerDocument, { color, effect });
    this.glyph = glyph;
    this.element.replaceChildren(...glyph.nodes);
    const style = this.element.style;
    style.width = `${glyph.width}px`;
    style.height = `${glyph.height}px`;
    style.marginLeft = `-${glyph.hotspot.x}px`;
    style.marginTop = `-${glyph.hotspot.y}px`;
    style.transformOrigin = `${glyph.hotspot.x}px ${glyph.hotspot.y}px`;
    this.lastTransform = '';
  }

  private planTrack() {
    return buildCursorTrack(cursorInput(this.events), {
      reducedMotion: this.media?.matches ?? false,
      settings: this.settings,
      source: this.source,
    });
  }

  /** The replay's fit scale (the host is CSS-transformed). A layout read, so only after a resize. */
  private measureFit() {
    const context = Number.parseFloat(this.wrapper.parentElement?.style.getPropertyValue('--player-cursor-size') ?? '');
    this.contextScale = Number.isFinite(context) && context > 0 ? context : 1;
    const declared = Number.parseFloat(this.wrapper.parentElement?.style.getPropertyValue('--player-scale') ?? '');
    if (Number.isFinite(declared) && declared > 0) {
      // why: ancestor layout projections are transient; the stage publishes its actual replay fit independently.
      this.fitScale = declared;
      this.fitDirty = false;
      return;
    }
    const width = this.wrapper.offsetWidth;
    const scale = width > 0 ? this.wrapper.getBoundingClientRect().width / width : 1;
    this.fitScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    // why: an unlaid-out standalone host must be measured again when it gains dimensions.
    this.fitDirty = width === 0;
  }

  private readonly invalidateFit = () => {
    this.fitDirty = true;
    if (!Number.isNaN(this.lastTime)) this.update(this.lastTime);
  };

  private readonly onMotionPreference = () => {
    this.track = this.planTrack();
    if (!Number.isNaN(this.lastTime)) this.update(this.lastTime);
  };
}
