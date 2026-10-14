import { useSyncExternalStore } from 'react';

/*
 * Hover previews on the feed (Poster.tsx plays them): which row's preview plays, and whether this
 * device should autoplay at all. One preview at a time; pointer hover arms after an intent delay so
 * sweeping the mouse down the list plays nothing, reaching a row by keyboard plays at once.
 */

export const PREVIEW_INTENT_MS = 250;

type Timer = ReturnType<typeof setTimeout>;

export class PreviewHover {
  /** The row whose preview plays. */
  active: string | undefined;
  private armed: string | undefined;
  private timer: Timer | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly delay: number;
  private readonly schedule: (run: () => void, ms: number) => Timer;
  private readonly cancel: (timer: Timer) => void;

  constructor(options: { delay?: number; schedule?: (run: () => void, ms: number) => Timer; cancel?: (timer: Timer) => void } = {}) {
    this.delay = options.delay ?? PREVIEW_INTENT_MS;
    this.schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: string | undefined) {
    if (this.active === next) return;
    this.active = next;
    for (const listener of this.listeners) listener();
  }

  private disarm() {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
    this.armed = undefined;
  }

  /** Pointer entered a row: play it after the intent delay (another row's preview stops now). */
  enter(key: string) {
    if (this.active === key || this.armed === key) return;
    this.disarm();
    if (this.active !== undefined) this.set(undefined);
    this.armed = key;
    this.timer = this.schedule(() => {
      this.timer = undefined;
      this.armed = undefined;
      this.set(key);
    }, this.delay);
  }

  /** The keyboard reached a row: play it now. */
  reach(key: string) {
    this.disarm();
    this.set(key);
  }

  /** The pointer or the keyboard left a row: stop (and forget) its preview. */
  leave(key: string) {
    if (this.armed === key) this.disarm();
    if (this.active === key) this.set(undefined);
  }
}

export const previewHover = new PreviewHover();

/** True while `key`'s preview should play. */
export function usePreviewActive(key: string | undefined, controller: PreviewHover = previewHover) {
  return useSyncExternalStore(
    controller.subscribe,
    () => key !== undefined && controller.active === key,
    () => false,
  );
}

export interface PreviewEnvironment {
  reducedMotion: boolean;
  /** A fine pointer that can hover (not a phone). */
  hover: boolean;
  saveData: boolean;
  /** navigator.connection.effectiveType */
  effectiveType?: string | undefined;
}

/** Previews autoplay only with a hovering pointer, motion allowed, and a connection that is not metered or slow. */
export function previewsAllowed(environment: PreviewEnvironment) {
  return (
    environment.hover && !environment.reducedMotion && !environment.saveData && !['slow-2g', '2g'].includes(environment.effectiveType ?? '')
  );
}

export function currentPreviewEnvironment(): PreviewEnvironment {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return {
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    hover: matchMedia('(hover: hover) and (pointer: fine)').matches,
    saveData: Boolean(connection?.saveData),
    effectiveType: connection?.effectiveType,
  };
}

/** Pointer and keyboard handlers for a feed row; `key` identifies the row. */
export function previewHandlers(key: string, controller: PreviewHover = previewHover) {
  return {
    onPointerEnter: (event: { pointerType: string }) => {
      if (event.pointerType === 'mouse') controller.enter(key);
    },
    onPointerLeave: () => controller.leave(key),
    onFocus: (event: { target: EventTarget }) => {
      // Only keyboard arrival (:focus-visible) previews; a click lands on the link on its way to navigating.
      if ((event.target as Element).matches?.(':focus-visible')) controller.reach(key);
    },
    onBlur: (event: { currentTarget: EventTarget; relatedTarget: EventTarget | null }) => {
      if (!(event.currentTarget as Element).contains(event.relatedTarget as Node | null)) controller.leave(key);
    },
  };
}
