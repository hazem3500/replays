import { type ComponentPropsWithoutRef, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils.ts';

/**
 * In-place label changes, morphed: the old label fades out with a slight blur and a 3 px drift up while the new one
 * fades in from 3 px below, and the wrapper's width eases from the old label's to the new one's (180 ms ease-out;
 * transform, opacity, filter and width only; animated-text styles in styles.css). Labels only: counts, times and the
 * speed keep NumberFlow.
 *
 * - The first render never animates; under prefers-reduced-motion every change is a plain swap.
 * - A change within RAPID_MS of the previous one swaps instantly (scrubbing, key repeat), so bursts never queue
 *   morphs.
 * - Accessibility: at rest it is the plain text. While morphing, both layers are aria-hidden and the final text sits
 *   in a visually hidden span, so a button's accessible name and screen readers see the final text once. No live
 *   region is added.
 * - At rest it is an inline span (parents' ellipsis and wrapping work as before); only while morphing is it an
 *   inline grid with an explicit width.
 */
export const RAPID_MS = 120;
export const MORPH_MS = 180;

export type TextChange = 'none' | 'instant' | 'animate';

/** How a change of label should render; pure, for tests. */
export function textChange({
  previous,
  next,
  previousAt,
  now,
  reduced,
}: {
  previous: string | undefined;
  next: string;
  /** When the label last changed (or first rendered). */
  previousAt: number;
  now: number;
  reduced: boolean;
}): TextChange {
  if (previous === undefined || previous === next) return 'none';
  if (reduced || now - previousAt < RAPID_MS) return 'instant';
  return 'animate';
}

/* Read outside render-time purity rules: the clock and the motion preference at the moment of a change. */
function clock() {
  return performance.now();
}
function prefersReduced() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Track {
  text: string;
  /** The label morphing out, while a morph runs. */
  out: string | undefined;
  at: number;
  /** Bumps per morph, so a new morph restarts the layers' animations. */
  id: number;
}

export function AnimatedText({
  text,
  from,
  className,
  ...props
}: {
  text: string;
  /** A label this one replaces although the component is new (a remounted page section): it morphs from it once. */
  from?: string | undefined;
  className?: string;
} & Omit<ComponentPropsWithoutRef<'span'>, 'children'>) {
  const [track, setTrack] = useState<Track>(() => ({ text: from ?? text, out: undefined, at: Number.NEGATIVE_INFINITY, id: 0 }));
  const wrapper = useRef<HTMLSpanElement>(null);
  const restWidth = useRef(0);
  // Derived state, updated during render (React's "adjusting state when a prop changes").
  if (track.text !== text) {
    const now = clock();
    const change = textChange({ previous: track.text, next: text, previousAt: track.at, now, reduced: prefersReduced() });
    setTrack({ text, out: change === 'animate' ? track.text : undefined, at: now, id: track.id + 1 });
  }
  const morphing = track.out !== undefined && track.text === text;

  useLayoutEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    if (!morphing) {
      element.style.removeProperty('width');
      restWidth.current = element.getBoundingClientRect().width;
      return;
    }
    // Width: from the old label's rest width to the new layer's, eased (the layers sit in one grid cell).
    const incoming = element.querySelector<HTMLElement>('[data-in]');
    const to = incoming?.getBoundingClientRect().width ?? 0;
    element.style.width = `${restWidth.current}px`;
    void element.offsetWidth;
    element.style.width = `${to}px`;
    const timer = window.setTimeout(
      () => setTrack((current) => (current.id === track.id ? { ...current, out: undefined } : current)),
      MORPH_MS,
    );
    return () => window.clearTimeout(timer);
  }, [morphing, track.id]);

  if (!morphing) {
    return (
      <span ref={wrapper} className={cn('atext', className)} {...props}>
        {text}
      </span>
    );
  }
  return (
    <span ref={wrapper} className={cn('atext', className)} data-morphing="" {...props}>
      <span className="visually-hidden">{text}</span>
      <span key={`out-${track.id}`} className="atext-layer" data-out="" aria-hidden="true">
        {track.out}
      </span>
      <span key={`in-${track.id}`} className="atext-layer" data-in="" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
