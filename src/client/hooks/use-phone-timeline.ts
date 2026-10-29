import { useEffect, useRef, useState } from 'react';

import { formatClock } from '../../shared/replay.ts';
import { clampScale, timeAtScroll } from '../editor/phone-timeline.ts';
import type { Playback } from '../player.ts';

/** Quiet time after the last scroll event before a scrub (with its momentum) counts as finished. */
const SETTLE_MS = 140;
/** How close (px) a finished scrub must land to a step start to settle on it. */
const SNAP_PX = 14;

interface PhoneTimelineOptions {
  player: Playback;
  /** The playhead's range input: kept on the clock for the keyboard and screen readers. */
  seek: HTMLInputElement | null;
  /** Pixels per ms. */
  scale: number;
  /** The scale that fits the whole recording; zoom stays within half of it and MAX_SCALE. */
  fit: number;
  /** Step starts (ms) a scrub settles on when it ends close to one. */
  snaps: readonly number[];
  onScale: (scale: number) => void;
}

interface Latest {
  readonly current: PhoneTimelineOptions;
}

/** Two fingers or Ctrl + wheel scale px per ms around the playhead, within clampScale. */
function pinchZoom(latest: Latest) {
  let pinch: { distance: number; scale: number } | undefined;
  const zoom = (next: number) => latest.current.onScale(clampScale(next, latest.current.fit));
  const distance = (touches: TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
  };
  return {
    active: () => pinch !== undefined,
    start: (event: TouchEvent) => {
      if (event.touches.length === 2) pinch = { distance: distance(event.touches), scale: latest.current.scale };
    },
    move: (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2 || pinch.distance === 0) return;
      event.preventDefault();
      zoom((pinch.scale * distance(event.touches)) / pinch.distance);
    },
    end: (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = undefined;
    },
    wheel: (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoom(latest.current.scale * Math.exp(-event.deltaY / 240));
    },
  };
}

/**
 * The lanes' scroll position and the clock as one: `follow` scrolls to the clock, and a scroll it did not make is a
 * scrub that pauses, seeks and, once quiet, settles on a step start it lands near.
 */
function scrubber(scroller: HTMLElement, latest: Latest, pinching: () => boolean) {
  const { player } = latest.current;
  let expected = -1;
  let scrubbing = false;
  let settle = 0;
  const place = (left: number) => {
    expected = left;
    scroller.scrollTo({ left, behavior: 'instant' });
  };
  const announce = () => {
    const { seek } = latest.current;
    if (!seek) return;
    const time = player.getTime();
    seek.value = String(Math.round(time));
    seek.setAttribute('aria-valuetext', formatClock(time));
  };
  const finish = () => {
    const { scale, snaps } = latest.current;
    const time = timeAtScroll(scroller.scrollLeft, scale, player.duration);
    const near = snaps.find((at) => Math.abs(at - time) * scale <= SNAP_PX && Math.abs(at - time) * scale > 0.5);
    if (near !== undefined) {
      player.seek(near);
      scroller.scrollTo({ left: near * scale, behavior: 'smooth' });
      scroller.toggleAttribute('data-snapped', true);
      if ('vibrate' in navigator) navigator.vibrate(8);
      return;
    }
    scrubbing = false;
    expected = scroller.scrollLeft;
    scroller.removeAttribute('data-snapped');
    player.endScrub();
  };
  return {
    place,
    follow: () => {
      announce();
      if (scrubbing || pinching()) return;
      const left = player.getTime() * latest.current.scale;
      if (Math.abs(scroller.scrollLeft - left) >= 0.5) place(left);
    },
    scroll: () => {
      if ((!scrubbing && Math.abs(scroller.scrollLeft - expected) <= 1) || pinching()) return;
      if (!scrubbing) {
        scrubbing = true;
        player.pause();
        player.beginScrub();
      }
      player.seek(timeAtScroll(scroller.scrollLeft, latest.current.scale, player.duration));
      window.clearTimeout(settle);
      settle = window.setTimeout(finish, SETTLE_MS);
    },
    dispose: () => {
      window.clearTimeout(settle);
      if (scrubbing) player.endScrub();
    },
  };
}

function listen<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  passive: boolean,
) {
  target.addEventListener(type, listener, { passive });
  return () => target.removeEventListener(type, listener);
}

/**
 * One position for the phone timeline and the playhead: the clock scrolls the lanes under the centre line, and a
 * finger (with the platform's momentum), a wheel or a mouse drag scrolling them scrubs, settling on a step start it
 * lands near. Two fingers or Ctrl + wheel zoom around the playhead.
 */
export function usePhoneTimeline(scroller: HTMLElement | null, options: PhoneTimelineOptions) {
  const latest = useRef(options);
  const control = useRef<ReturnType<typeof scrubber>>(null);
  const { player, scale } = options;

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!scroller) return;
    const pinch = pinchZoom(latest);
    const scrub = scrubber(scroller, latest, pinch.active);
    control.current = scrub;
    scrub.follow();
    const stops = [
      player.subscribeTime(scrub.follow),
      listen(scroller, 'scroll', scrub.scroll, true),
      listen(scroller, 'touchstart', pinch.start, true),
      listen(scroller, 'touchmove', pinch.move, false),
      listen(scroller, 'touchend', pinch.end, true),
      listen(scroller, 'touchcancel', pinch.end, true),
      listen(scroller, 'wheel', pinch.wheel, false),
    ];
    return () => {
      control.current = null;
      scrub.dispose();
      for (const stop of stops) stop();
    };
  }, [scroller, player]);

  useEffect(() => {
    control.current?.place(player.getTime() * scale);
  }, [scroller, player, scale]);
}

/** The lanes' width as they resize (0 until measured): what the whole recording is fitted to. */
export function useLanesWidth(scroller: HTMLElement | null) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!scroller) return;
    const measure = () => setWidth(scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);
  return width;
}
