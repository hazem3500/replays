import { type RefObject, useLayoutEffect } from 'react';

/** Regions narrower than this get the compact, icon-only Remove bubble. */
const COMPACT_PX = 64;
/** Room kept between the bubble and the track's ends. */
const EDGE_PX = 4;

function coversLabel(lane: Element | undefined, left: number, right: number) {
  if (!lane) return false;
  for (const label of lane.querySelectorAll('.tl-region-label')) {
    const box = label.getBoundingClientRect();
    if (box.width > 0 && box.right > left && box.left < right) return true;
  }
  return false;
}

/**
 * Places a selected region's Remove bubble: centred on the region and clamped to its track, on the side of its lane
 * (above, else below) where it covers no other clip's label, and compact (just ×) on a short region. It writes the
 * bubble's `--bubble-x`, `data-side` and `data-compact` directly, so placement never re-renders the timeline.
 */
export function useBubblePlacement(region: RefObject<HTMLElement | null>, selected: boolean, left: number, width: number) {
  useLayoutEffect(() => {
    const root = region.current;
    const bubble = root?.querySelector<HTMLElement>('.tl-region-remove');
    if (!root || !bubble || !selected) return;
    bubble.toggleAttribute('data-compact', width < COMPACT_PX);
    const own = bubble.getBoundingClientRect().width;
    const track = root.closest('.tl-track');
    const trackWidth = track?.clientWidth ?? width;
    // why: `left` and `width` are the region's place on the track, so the bubble is placed in track coordinates.
    const offset = Math.min(Math.max(width / 2 - own / 2, EDGE_PX - left), trackWidth - left - own - EDGE_PX);
    bubble.style.setProperty('--bubble-x', `${offset}px`);
    const start = root.getBoundingClientRect().left + offset;
    const lanes = [...(root.closest('.timeline')?.querySelectorAll('.tl-lane') ?? [])];
    const index = lanes.findIndex((lane) => lane.contains(root));
    const above = lanes[index - 1];
    const below = lanes[index + 1];
    const side = !coversLabel(above, start, start + own) || !below || coversLabel(below, start, start + own) ? 'above' : 'below';
    bubble.dataset.side = side;
  }, [region, selected, left, width]);
}
