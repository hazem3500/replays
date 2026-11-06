import { animate } from 'motion/mini';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { Playback } from '../player.ts';
import { PHONE_GUTTER_PX } from './phone-timeline.ts';
import { startDrag, type TimelineScale } from './timeline-drag.ts';

/** How close (px) a finished scrub must land to a step start to settle on it. */
const SNAP_PX = 14;

/** The snap pulse is UI feedback, independent of the deterministic replay clock. */
function pulse(marker: HTMLElement | null | undefined) {
  if (!marker || typeof marker.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  animate([marker], { transform: ['scaleX(1)', 'scaleX(2.5)', 'scaleX(1)'] }, { duration: 0.24, ease: [0.23, 1, 0.32, 1] });
}

/**
 * A press on the phone's scale seeks to the time under it and a drag scrubs, as the desktop ruler does; a scrub that
 * ends within SNAP_PX of a step start settles on it, with a pulse of the playhead and a tick of vibration.
 */
export function startPhoneScrub(
  event: ReactPointerEvent<HTMLElement>,
  { player, timeline, snaps, scale }: { player: Playback; timeline: TimelineScale; snaps: readonly number[]; scale: number },
) {
  if (event.button !== 0) return;
  const marker = event.currentTarget.closest('.phone-track')?.querySelector<HTMLElement>('.phone-snap-marker');
  player.pause();
  player.beginScrub();
  player.seek(timeline.timeAt(event.clientX));
  startDrag(event, timeline, {
    move: (time) => player.seek(time),
    end: (moved, time) => {
      const near = moved ? snapTarget(time, snaps, scale, SNAP_PX) : undefined;
      if (near !== undefined) {
        player.seek(near);
        pulse(marker);
        if ('vibrate' in navigator) navigator.vibrate(8);
      }
      player.endScrub();
    },
  });
}

/**
 * The scroll offset that keeps the playhead (`x` px into the track) in view: unchanged while it shows clear of the
 * edges, else (and always while `follow`ing playback past the middle) the one that centres it, within the scroll range.
 */
export function scrollForPlayhead({
  x,
  scrollLeft,
  viewport,
  max,
  follow,
}: {
  x: number;
  scrollLeft: number;
  viewport: number;
  max: number;
  follow: boolean;
}) {
  const onScreen = x + PHONE_GUTTER_PX - scrollLeft;
  const centred = Math.min(Math.max(x + PHONE_GUTTER_PX - viewport / 2, 0), Math.max(0, max));
  if (follow && onScreen > viewport / 2) return centred;
  if (onScreen < PHONE_GUTTER_PX || onScreen > viewport - PHONE_GUTTER_PX) return centred;
  return scrollLeft;
}

/** Closest step within the inclusive pixel radius; equal distances retain input order, including exact matches. */
export function snapTarget(time: number, snaps: readonly number[], scale: number, px: number) {
  let nearest: number | undefined;
  let distance = Infinity;
  for (const at of snaps) {
    const next = Math.abs(at - time) * scale;
    if (next <= px && next < distance) {
      nearest = at;
      distance = next;
    }
  }
  return nearest;
}
