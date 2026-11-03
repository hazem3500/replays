import { spring } from 'motion';
import { animate } from 'motion/mini';

import { deferred } from '../lib/deferred.ts';

export interface MarkAnimation {
  finished: Promise<void>;
  cancel: () => void;
  readonly playState: 'running' | 'finished' | 'idle';
}

const active = new WeakMap<Element, Set<MarkAnimation>>();

function easing(value: string) {
  if (value === 'spring' || value === 'dock') return { type: spring, bounce: value === 'spring' ? 0.08 : 0.02 };
  const parts = value
    .match(/^cubic-bezier\((.+)\)$/)?.[1]
    ?.split(',')
    .map(Number);
  const [a, b, c, d] = parts ?? [];
  if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
    const ease: [number, number, number, number] = [a, b, c, d];
    return { ease };
  }
  if (value === 'step-end') return { ease: (position: number) => (position < 1 ? 0 : 1) };
  return { ease: value === 'ease-in' ? ('easeIn' as const) : ('easeOut' as const) };
}

/** Motion owns each decorative track; the mark's state machine retains its semantic typing beats. */
export function markAnimate(
  element: HTMLElement | SVGElement,
  frames: Keyframe[],
  options: { duration: number; easing: string; fill?: FillMode },
): MarkAnimation {
  const original = { transform: element.style.transform, opacity: element.style.opacity };
  const restore = () => {
    element.style.setProperty('transform', original.transform);
    element.style.setProperty('opacity', original.opacity);
  };
  const controls = animate(
    [element],
    {
      ...(frames.some((frame) => frame.transform !== undefined)
        ? { transform: frames.map((frame) => String(frame.transform ?? 'none')) }
        : {}),
      ...(frames.some((frame) => frame.opacity !== undefined) ? { opacity: frames.map((frame) => Number(frame.opacity ?? 1)) } : {}),
    },
    {
      duration: options.duration / 1000,
      ...(frames.some((frame) => frame.offset !== undefined)
        ? { times: frames.map((frame, index) => frame.offset ?? index / (frames.length - 1)) }
        : {}),
      ...easing(options.easing),
    },
  );
  let state: MarkAnimation['playState'] = 'running';
  const { promise: finished, resolve: finish } = deferred();
  const group = active.get(element) ?? new Set<MarkAnimation>();
  active.set(element, group);
  const track: MarkAnimation = {
    get playState() {
      return state;
    },
    finished,
    cancel: () => {
      state = 'idle';
      controls.cancel();
      restore();
      group.delete(track);
      finish();
    },
  };
  group.add(track);
  void Promise.resolve(controls).then(() => {
    if (state === 'running') {
      state = 'finished';
      if (options.fill !== 'forwards') restore();
      group.delete(track);
    }
    finish();
  });
  return track;
}

/** Cancels only tracks this mark owns, including its temporary glyph and caret children. */
export function cancelMarkAnimations(element: Element, subtree = false) {
  for (const track of active.get(element) ?? []) track.cancel();
  if (subtree) for (const child of element.querySelectorAll('*')) cancelMarkAnimations(child);
}
