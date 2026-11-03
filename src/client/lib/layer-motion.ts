import { animate } from 'motion/mini';

const running = new Map<HTMLElement, ReturnType<typeof animate>>();

/** A measured highlight keeps its current pose when another row takes over. */
export function moveLayer(element: HTMLElement, pose: Record<string, string>, instant: boolean, duration = 0.18) {
  running.get(element)?.stop();
  element.style.setProperty('transition', 'none');
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches || typeof element.animate !== 'function') {
    Object.assign(element.style, pose);
    running.delete(element);
    return;
  }
  const animation = animate([element], pose, { duration, ease: 'easeOut' });
  running.set(element, animation);
  void animation.then(() => {
    if (running.get(element) === animation) running.delete(element);
  });
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
