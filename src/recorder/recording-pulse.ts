import { animate } from 'motion/mini';

/** Owns the recording indicator's wall-clock pulse and follows reduced-motion changes while it is visible. */
export function startRecordingPulse(dot: HTMLElement): () => void {
  const preference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  let animation: ReturnType<typeof animate> | undefined;
  const update = () => {
    animation?.stop();
    animation = undefined;
    dot.style.removeProperty('opacity');
    if (preference?.matches || typeof dot.animate !== 'function') return;
    animation = animate([dot], { opacity: [1, 0.5, 1] }, { duration: 2, ease: 'easeInOut', repeat: Infinity });
  };
  update();
  preference?.addEventListener?.('change', update);
  return () => {
    preference?.removeEventListener?.('change', update);
    animation?.stop();
    dot.style.removeProperty('opacity');
  };
}
