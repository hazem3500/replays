import { animate } from 'motion/mini';

import { element } from './default-ui-dom.ts';

/** A small spinner for a pending recovery; still under reduced motion. Call `stop` when it is removed. */
export function createStatusSpinner(): { node: HTMLElement; stop: () => void } {
  const node = element('span', { className: 'status-spinner' });
  node.setAttribute('aria-hidden', 'true');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation =
    reduced || typeof node.animate !== 'function'
      ? undefined
      : animate([node], { transform: ['rotate(0deg)', 'rotate(360deg)'] }, { duration: 0.9, ease: 'linear', repeat: Infinity });
  return { node, stop: () => animation?.stop() };
}
