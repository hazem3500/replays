import type { ReplayCursorSettings } from '../shared/cursor.ts';

import { buildCursorTrack, type CursorTrack, cursorInput, cursorPose, type Pose } from './cursor-motion.ts';
import { type CursorGlyph, cursorColorValue, cursorTheme, type CursorTheme } from './cursor-themes.ts';
import { viewerRegistry } from './plugins/registry.ts';

export interface ReplayCursorOptions {
  /** The agent tag's text (the replay's source). */
  label?: string;
}

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
  private theme: CursorTheme | undefined;
  private glyph: CursorGlyph | undefined;
  private glyphKey = '';
  private readonly label: string;
  private readonly unsubscribeThemes: () => void;
  private fitScale = 1;
  /** The fit scale only changes when the stage or the recorded viewport resizes; measure it then, not every frame. */
  private fitDirty = true;
  private lastTime = Number.NaN;
  private lastTransform = '';
  private lastOpacity = '';
  private lastVisible: boolean | undefined;
  private readonly resizeObserver: ResizeObserver | undefined;

  private readonly wrapper: HTMLElement;
  private readonly events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>;
  private readonly base: number;

  constructor(
    wrapper: HTMLElement,
    events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>,
    base: number,
    settings?: ReplayCursorSettings,
    options: ReplayCursorOptions = {},
  ) {
    this.wrapper = wrapper;
    this.events = events;
    this.base = base;
    this.settings = settings;
    this.label = options.label ?? 'Agent';
    this.media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
    this.track = buildCursorTrack(cursorInput(events), { reducedMotion: this.media?.matches ?? false, settings: this.settings });
    this.media?.addEventListener('change', this.onMotionPreference);

    const element = document.createElement('div');
    element.className = 'replay-cursor';
    element.setAttribute('aria-hidden', 'true');
    element.hidden = true;
    wrapper.append(element);
    this.element = element;
    this.mountGlyph();
    // why: plugin themes can arrive after the player mounts; redraw once a saved plugin theme becomes available.
    this.unsubscribeThemes = viewerRegistry.subscribe(() => this.mountGlyph());

    // The fit scale changes when the stage resizes; a transform on an ancestor fires no observer, so watch the stage boxes.
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        this.fitDirty = true;
        if (!Number.isNaN(this.lastTime)) this.update(this.lastTime);
      });
      for (let node: HTMLElement | null = wrapper.parentElement, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
        this.resizeObserver.observe(node);
      }
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
    const transform = `translate3d(${pose.x.toFixed(2)}px,${pose.y.toFixed(2)}px,0) rotate(${(pose.heading - Math.PI / 4).toFixed(4)}rad) scale(${((pose.scale * (this.settings?.size ?? 1)) / this.fitScale).toFixed(4)})`;
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

  /** Settles once the cursor's current frame is drawn (themes that draw asynchronously); export waits on it. */
  ready() {
    return this.glyph?.ready?.() ?? Promise.resolve();
  }

  destroy() {
    this.unsubscribeThemes();
    this.glyph?.destroy?.();
    this.resizeObserver?.disconnect();
    this.media?.removeEventListener('change', this.onMotionPreference);
    this.element.remove();
  }

  /** Draws the saved theme and colour; keeps the current glyph when neither resolves differently. */
  private mountGlyph() {
    const theme = cursorTheme(this.settings?.appearance);
    const color = theme.tintable ? cursorColorValue(this.settings?.color) : undefined;
    const key = `${color ?? ''}|${this.label}`;
    if (theme === this.theme && key === this.glyphKey) return;
    this.glyph?.destroy?.();
    this.theme = theme;
    this.glyphKey = key;
    const glyph = theme.create({ document: this.element.ownerDocument, color, label: this.label });
    this.glyph = glyph;
    this.element.replaceChildren(...glyph.nodes);
    this.layout(glyph);
    // why: a theme may learn its hotspot once loaded (CUA themes read it from their manifest).
    void glyph.ready?.().then(() => {
      if (this.glyph === glyph) this.layout(glyph);
    });
    this.lastTransform = '';
    if (!Number.isNaN(this.lastTime)) this.update(this.lastTime);
  }

  /** The box and its hotspot: the element's top left sits on the pose, shifted back by the hotspot. */
  private layout(glyph: CursorGlyph) {
    const style = this.element.style;
    style.width = `${glyph.width}px`;
    style.height = `${glyph.height}px`;
    style.marginLeft = `-${glyph.hotspot.x}px`;
    style.marginTop = `-${glyph.hotspot.y}px`;
    style.transformOrigin = `${glyph.hotspot.x}px ${glyph.hotspot.y}px`;
  }

  /** The replay's fit scale (the host is CSS-transformed). A layout read, so only after a resize. */
  private measureFit() {
    const width = this.wrapper.offsetWidth;
    const scale = width > 0 ? this.wrapper.getBoundingClientRect().width / width : 1;
    this.fitScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    // Not laid out yet (width 0): measure again next time.
    this.fitDirty = width === 0;
  }

  private readonly onMotionPreference = () => {
    this.track = buildCursorTrack(cursorInput(this.events), { reducedMotion: this.media?.matches ?? false, settings: this.settings });
    if (!Number.isNaN(this.lastTime)) this.update(this.lastTime);
  };
}
