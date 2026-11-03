import { animate } from 'motion/mini';

import { element } from './default-ui-dom.ts';

/** An honestly indeterminate upload marker with native progress semantics and a custom visual track. */
export function createUploadActivity(label: string): { node: HTMLElement; stop: () => void } {
  const progress = element('progress', { className: 'sr-only' });
  progress.setAttribute('aria-label', label);
  const fill = element('span', { className: 'upload-activity-fill' });
  const track = element('span', { className: 'upload-activity-track' }, [fill]);
  track.setAttribute('aria-hidden', 'true');
  const node = element('span', { className: 'upload-activity' }, [progress, track]);
  const preference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  let animation: ReturnType<typeof animate> | undefined;
  const update = () => {
    animation?.stop();
    animation = undefined;
    fill.style.opacity = '';
    fill.style.transform = '';
    if (preference?.matches || typeof fill.animate !== 'function') return;
    animation = animate(
      [fill],
      { transform: ['translateX(-12px)', 'translateX(28px)'], opacity: [0, 1, 0] },
      {
        duration: 1.1,
        ease: 'easeInOut',
        repeat: Infinity,
      },
    );
  };
  update();
  preference?.addEventListener?.('change', update);
  return {
    node,
    stop() {
      preference?.removeEventListener?.('change', update);
      animation?.stop();
      fill.style.opacity = '';
      fill.style.transform = '';
    },
  };
}
