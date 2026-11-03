import { animate } from 'motion/mini';

import { gestureFrames as frames } from '../../recorder/icon-gestures.ts';
import type { AnimatedIconDefinition, PartMotion } from './animated-icon-data.ts';

/** Plays one gesture with Motion, restoring every SVG part to its static pose on cancellation. */
export function animateIcon(svg: SVGSVGElement, definition: AnimatedIconDefinition) {
  const animations: ReturnType<typeof animate>[] = [];
  const play = (target: SVGElement | null, motion: PartMotion | undefined) => {
    if (!target || !motion || typeof target.animate !== 'function') return;
    const delay = motion.delay ?? 0;
    animations.push(
      animate([target], frames(motion), {
        duration: Math.max(definition.ms - delay, 60) / 1000,
        delay: delay / 1000,
        ease: 'easeOut',
      }),
    );
  };
  play(svg.querySelector<SVGElement>('[data-icon-group]'), definition.motion);
  for (const [index, part] of definition.parts.entries()) play(svg.querySelector<SVGElement>(`[data-icon-part="${index}"]`), part.motion);
  return () => {
    for (const animation of animations) animation.cancel();
  };
}
