import { animate } from 'motion/mini';

import type { AnimatedIconDefinition, PartMotion } from './animated-icon-data.ts';

function frames(motion: PartMotion) {
  const pose = `translate(${motion.x ?? 0}px, ${motion.y ?? 0}px) rotate(${motion.rotate ?? 0}deg) scale(${motion.sx ?? motion.scale ?? 1}, ${motion.sy ?? motion.scale ?? 1})`;
  const opacity = motion.opacity ?? 1;
  switch (motion.kind) {
    case 'shift':
      return { transform: ['none', pose, 'none'], opacity: [1, opacity, 1] };
    case 'from':
      return { transform: [pose, 'none'], opacity: [opacity, 1] };
    case 'spin':
      return { transform: ['rotate(0deg)', `rotate(${motion.rotate ?? 0}deg)`] };
    case 'draw':
      return { strokeDashoffset: [1, 0], opacity: [0, 1] };
  }
}

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
