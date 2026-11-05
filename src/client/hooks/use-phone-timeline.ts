import { useEffect, useRef, useState } from 'react';

import { formatClock } from '../../shared/replay.ts';
import { scrollForPlayhead } from '../editor/phone-scrub.ts';
import { clampScale, PHONE_GUTTER_PX } from '../editor/phone-timeline.ts';
import type { Playback } from '../player.ts';

interface PhoneTimelineOptions {
  player: Playback;
  /** The playhead's range input: kept on the clock for the keyboard and screen readers. */
  seek: HTMLInputElement | null;
  /** Pixels per ms. */
  scale: number;
  /** The scale that fits the whole recording; zoom stays between it and MAX_SCALE. */
  fit: number;
  /** The track the playhead line rides on (its --playhead is the clock's x). */
  track: HTMLElement | null;
  onScale: (scale: number) => void;
}

interface Latest {
  readonly current: PhoneTimelineOptions;
}

const distance = (touches: TouchList) => {
  const [a, b] = [touches[0], touches[1]];
  return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
};

/** Two fingers or Ctrl + wheel scale px per ms around the playhead, within clampScale. */
function pinchZoom(latest: Latest) {
  let pinch: { distance: number; scale: number } | undefined;
  const zoom = (next: number) => latest.current.onScale(clampScale(next, latest.current.fit));
  return {
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
 * The playhead on the track and the lanes' scroll as one: the clock places the playhead line and keeps it in view
 * (centred while playback runs past the middle), but never moves the lanes under a scrub. `recentre` centres it.
 */
function follower(scroller: HTMLElement, latest: Latest) {
  const { player } = latest.current;
  const announce = (time: number) => {
    const { seek } = latest.current;
    if (!seek) return;
    seek.value = String(Math.round(time));
    seek.setAttribute('aria-valuetext', formatClock(time));
  };
  return (recentre: boolean) => {
    const { scale, track } = latest.current;
    const time = player.getTime();
    const x = time * scale;
    track?.style.setProperty('--playhead', `${x}px`);
    announce(time);
    if (player.isScrubbing() && !recentre) return;
    const viewport = scroller.clientWidth;
    const max = scroller.scrollWidth - viewport;
    const left = recentre
      ? Math.min(Math.max(x + PHONE_GUTTER_PX - viewport / 2, 0), Math.max(0, max))
      : scrollForPlayhead({ x, scrollLeft: scroller.scrollLeft, viewport, max, follow: player.getState().status === 'playing' });
    if (Math.abs(scroller.scrollLeft - left) >= 0.5) scroller.scrollTo({ left, behavior: 'instant' });
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
 * The phone timeline's playhead and zoom: the clock moves the playhead line along the track and scrolls the lanes to
 * keep it in view; two fingers or Ctrl + wheel zoom, keeping the playhead in the middle once the recording overflows.
 */
export function usePhoneTimeline(scroller: HTMLElement | null, options: PhoneTimelineOptions) {
  const latest = useRef(options);
  const place = useRef<ReturnType<typeof follower>>(null);
  const { player, scale, track } = options;

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!scroller) return;
    const pinch = pinchZoom(latest);
    const follow = follower(scroller, latest);
    place.current = follow;
    follow(false);
    const stops = [
      player.subscribeTime(() => follow(false)),
      listen(scroller, 'touchstart', pinch.start, true),
      listen(scroller, 'touchmove', pinch.move, false),
      listen(scroller, 'touchend', pinch.end, true),
      listen(scroller, 'touchcancel', pinch.end, true),
      listen(scroller, 'wheel', pinch.wheel, false),
    ];
    return () => {
      place.current = null;
      for (const stop of stops) stop();
    };
  }, [scroller, player]);

  useEffect(() => {
    // why: a new scale or track moves the playhead's x before the clock next ticks.
    track?.style.setProperty('--playhead', `${player.getTime() * scale}px`);
    place.current?.(true);
  }, [player, scale, track]);
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
