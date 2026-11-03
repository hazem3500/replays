import { animate } from 'motion/mini';
import { SHARED_ICON_GESTURES, gestureFrames, type AnimatedIconDefinition } from './icon-gestures.ts';

const NS = 'http://www.w3.org/2000/svg';

export type GestureIconName = keyof typeof SHARED_ICON_GESTURES;

/** A decorative icon drawn from the viewer's shared gesture data; the control that holds it carries the name. */
export function gestureIcon(name: GestureIconName): SVGSVGElement {
  const definition: AnimatedIconDefinition = SHARED_ICON_GESTURES[name];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon gesture-icon gesture-${name}`);
  const group = document.createElementNS(NS, 'g');
  group.dataset.iconGroup = '';
  if (definition.motion) group.style.transformOrigin = definition.motion.origin ?? 'center';
  for (const [index, part] of definition.parts.entries()) {
    const node = document.createElementNS(NS, part.el);
    for (const [key, value] of Object.entries(part.attrs)) node.setAttribute(key, value);
    node.dataset.iconPart = String(index);
    if (part.motion) node.style.transformOrigin = part.motion.origin ?? 'center';
    group.append(node);
  }
  svg.append(group);
  return svg;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Plays `name`'s gesture once on hover or keyboard focus of `control`, like the viewer's AnimatedIcon: never loops,
 * never restarts mid-play, and stays still under reduced motion. Returns a cleanup that stops it at rest.
 */
export function playGestureOnIntent(control: HTMLElement, svg: SVGSVGElement, name: GestureIconName): () => void {
  const definition: AnimatedIconDefinition = SHARED_ICON_GESTURES[name];
  let running: ReturnType<typeof animate>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    for (const animation of running) animation.cancel();
    running = [];
  };
  const play = () => {
    if (timer !== undefined || reducedMotion()) return;
    const targets: [SVGElement | null, AnimatedIconDefinition['motion']][] = [
      [svg.querySelector<SVGElement>('[data-icon-group]'), definition.motion],
      ...definition.parts.map((part, index): [SVGElement | null, AnimatedIconDefinition['motion']] => [
        svg.querySelector<SVGElement>(`[data-icon-part="${index}"]`),
        part.motion,
      ]),
    ];
    for (const [target, motion] of targets) {
      if (!target || !motion || typeof target.animate !== 'function') continue;
      const delay = motion.delay ?? 0;
      running.push(
        animate([target], gestureFrames(motion), {
          duration: Math.max(definition.ms - delay, 60) / 1000,
          delay: delay / 1000,
          ease: 'easeOut',
        }),
      );
    }
    // why: a small margin lets every part finish before another hover may start the gesture again.
    timer = setTimeout(stop, definition.ms + 40);
  };
  control.addEventListener('pointerenter', play);
  control.addEventListener('focus', play);
  return () => {
    control.removeEventListener('pointerenter', play);
    control.removeEventListener('focus', play);
    stop();
  };
}
