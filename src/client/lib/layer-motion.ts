import { animate } from 'motion/mini';

const running = new Map<HTMLElement, ReturnType<typeof animate>>();

/** A measured highlight keeps its current pose when another row takes over. */
export function moveLayer(
  element: HTMLElement,
  pose: Record<string, string>,
  instant: boolean,
  { duration = 0.18, ease = 'easeOut' }: { duration?: number; ease?: 'easeOut' | [number, number, number, number] } = {},
) {
  const current = running.get(element);
  if (current) {
    // why: stopping drops the animation's effect; without committing where it was, a retarget snaps back to its start.
    const computed = getComputedStyle(element);
    const live = Object.fromEntries(Object.keys(pose).map((key) => [key, computed.getPropertyValue(key)]));
    current.stop();
    Object.assign(element.style, live);
  }
  element.style.setProperty('transition', 'none');
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches || typeof element.animate !== 'function') {
    Object.assign(element.style, pose);
    running.delete(element);
    return;
  }
  const animation = animate([element], pose, { duration, ease });
  running.set(element, animation);
  void animation.then(() => {
    if (running.get(element) === animation) running.delete(element);
  });
}

/** Whether a highlight is mid-move, so a reflow can retarget it instead of snapping it to rest. */
export function layerMoving(element: HTMLElement) {
  return running.has(element);
}

/** Changing the motion preference settles current highlights without replaying their entrances. */
export function settleLayers() {
  for (const animation of running.values()) animation.complete();
  running.clear();
}

export function stopLayer(element: HTMLElement | null) {
  if (!element) return;
  running.get(element)?.stop();
  running.delete(element);
}
