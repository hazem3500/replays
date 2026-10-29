import { MIN_BLUR_SIZE } from '../../shared/effects.ts';

/** Padding around a snapped element, recorded px, so its edges are covered too. */
const SNAP_PAD_PX = 4;
/** A snap larger than this share of the frame is the page itself, not something to hide. */
const MAX_SNAP_AREA = 0.6;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * The recorded element under a click on the preview, as a blur box in frame fractions, or undefined when the click
 * lands on nothing smaller than most of the page. `stage` holds the replay iframe; any zoom or fit scale on it is
 * undone through its on-screen box.
 */
export function elementBoxAt(stage: Element | null | undefined, clientX: number, clientY: number) {
  const iframe = stage?.querySelector<HTMLIFrameElement>('.player-host iframe');
  const doc = iframe?.contentDocument;
  if (!iframe || !doc) return;
  const screen = iframe.getBoundingClientRect();
  const width = iframe.clientWidth;
  const height = iframe.clientHeight;
  if (screen.width <= 0 || screen.height <= 0 || width <= 0 || height <= 0) return;
  const x = ((clientX - screen.left) * width) / screen.width;
  const y = ((clientY - screen.top) * height) / screen.height;
  const target = doc.elementFromPoint(x, y);
  if (!target || target === doc.documentElement || target === doc.body) return;
  const rect = target.getBoundingClientRect();
  const left = clamp01((rect.left - SNAP_PAD_PX) / width);
  const top = clamp01((rect.top - SNAP_PAD_PX) / height);
  const right = clamp01((rect.right + SNAP_PAD_PX) / width);
  const bottom = clamp01((rect.bottom + SNAP_PAD_PX) / height);
  const box = { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
  if (box.width < MIN_BLUR_SIZE || box.height < MIN_BLUR_SIZE || box.width * box.height > MAX_SNAP_AREA) return;
  return box;
}
