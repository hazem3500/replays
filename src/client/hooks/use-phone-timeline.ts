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

/**
 * One position for the phone timeline and the playhead: the clock scrolls the lanes under the centre line, and a
 * finger (with the platform's momentum), a wheel or a mouse drag scrolling them scrubs, settling on a step start it
 * lands near. Two fingers or Ctrl + wheel zoom around the playhead.
 */
export function usePhoneTimeline(scroller: HTMLElement | null, options: PhoneTimelineOptions) {
  const latest = useRef(options);
  const expected = useRef(-1);
  const { player, scale } = options;

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!scroller) return;
    expected.current = player.getTime() * scale;
    scroller.scrollTo({ left: expected.current, behavior: 'instant' });
  }, [scroller, player, scale]);

  useEffect(() => {
    if (!scroller) return;
    let scrubbing = false;
    let settle = 0;
    let pinch: { distance: number; scale: number } | undefined;
    const place = (left: number) => {
      expected.current = left;
      scroller.scrollTo({ left, behavior: 'instant' });
    };
    const announce = () => {
      const { seek } = latest.current;
      if (!seek) return;
      const time = player.getTime();
      seek.value = String(Math.round(time));
      seek.setAttribute('aria-valuetext', formatClock(time));
    };
    const follow = () => {
      announce();
      if (scrubbing || pinch) return;
      const left = player.getTime() * latest.current.scale;
      if (Math.abs(scroller.scrollLeft - left) >= 0.5) place(left);
    };
    const finish = () => {
      const { scale: current, snaps } = latest.current;
      const time = timeAtScroll(scroller.scrollLeft, current, player.duration);
      const near = snaps.find((at) => Math.abs(at - time) * current <= SNAP_PX && Math.abs(at - time) * current > 0.5);
      if (near !== undefined) {
        player.seek(near);
        scroller.scrollTo({ left: near * current, behavior: 'smooth' });
        scroller.dataset.snapped = '';
        if ('vibrate' in navigator) navigator.vibrate(8);
        return;
      }
      scrubbing = false;
      expected.current = scroller.scrollLeft;
      delete scroller.dataset.snapped;
      player.endScrub();
    };
    const onScroll = () => {
      if (!scrubbing && Math.abs(scroller.scrollLeft - expected.current) <= 1) return;
      if (pinch) return;
      if (!scrubbing) {
        scrubbing = true;
        player.pause();
        player.beginScrub();
      }
      player.seek(timeAtScroll(scroller.scrollLeft, latest.current.scale, player.duration));
      window.clearTimeout(settle);
      settle = window.setTimeout(finish, SETTLE_MS);
    };
    const zoom = (next: number) => {
      const { fit, onScale } = latest.current;
      onScale(clampScale(next, fit));
    };
    const distance = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]];
      return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) pinch = { distance: distance(event.touches), scale: latest.current.scale };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2 || pinch.distance === 0) return;
      event.preventDefault();
      zoom((pinch.scale * distance(event.touches)) / pinch.distance);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = undefined;
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoom(latest.current.scale * Math.exp(-event.deltaY / 240));
    };
    follow();
    const stop = player.subscribeTime(follow);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      stop();
      window.clearTimeout(settle);
      if (scrubbing) player.endScrub();
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      scroller.removeEventListener('wheel', onWheel);
    };
  }, [scroller, player]);
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
