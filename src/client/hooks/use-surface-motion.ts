import { animate } from 'motion/mini';
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

import { haltMotion } from '../lib/halt-motion.ts';

export type SurfaceMotionKind = 'popover' | 'tooltip' | 'modal' | 'backdrop' | 'sheet' | 'drawer' | 'drawer-backdrop' | 'pane';

function awayTransform(kind: SurfaceMotionKind, side: string | undefined) {
  if (kind === 'sheet') return 'translateY(100%)';
  if (kind === 'drawer') return 'translateY(calc(100% - var(--bleed, 48px) + 2px))';
  if (kind === 'modal') return 'scale(0.96)';
  if (kind === 'tooltip') return 'scale(0.98)';
  if (kind === 'pane' && side === 'left') return 'translateX(-8px)';
  if (kind === 'pane' && side === 'right') return 'translateX(8px)';
  if (kind !== 'popover') return 'none';
  if (side === 'top') return 'translateY(4px) scale(0.96)';
  if (side === 'left' || side === 'right') return 'scale(0.96)';
  return 'translateY(-4px) scale(0.96)';
}

function surfaceDuration(open: boolean, kind: SurfaceMotionKind) {
  if (!open && kind === 'tooltip') return 0;
  if (!open || kind === 'pane') return 0.12;
  return kind === 'tooltip' ? 0.15 : 0.2;
}

function drawerInteraction(node: HTMLElement, open: boolean, kind: SurfaceMotionKind, initial: ReturnType<typeof animate>) {
  let controls = initial;
  const away = awayTransform(kind, node.dataset.side);
  const observer = new MutationObserver(() => {
    haltMotion(node, controls);
    if (node.hasAttribute('data-swiping')) {
      node.style.removeProperty(kind === 'drawer' ? 'transform' : 'opacity');
      return;
    }
    const current = getComputedStyle(node);
    controls = animate(
      [node],
      kind === 'drawer' ? { transform: [current.transform, open ? 'none' : away] } : { opacity: [Number(current.opacity), open ? 1 : 0] },
      { duration: 0.2, ease: [0.23, 1, 0.32, 1] },
    );
  });
  observer.observe(node, { attributes: true, attributeFilter: ['data-swiping'] });
  return () => {
    observer.disconnect();
    haltMotion(node, controls);
  };
}

function instantSurface(node: HTMLElement, instant: boolean) {
  return (
    instant ||
    node.hasAttribute('data-instant') ||
    Boolean(node.closest('[data-instant-switch]')) ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function surfacePose(node: HTMLElement, open: boolean, initial: boolean, away: string) {
  const computed = getComputedStyle(node);
  const entering = initial && open;
  return { opacity: entering ? 0 : Number(computed.opacity || 1), transform: entering ? away : computed.transform };
}

function retainSurface(
  node: HTMLElement,
  controls: ReturnType<typeof animate>,
  options: { open: boolean; kind: SurfaceMotionKind; retained: boolean },
) {
  const { open, kind, retained } = options;
  let active = true;
  if (retained && !open)
    void controls.then(() => {
      if (active) node.style.setProperty('visibility', 'hidden');
    });
  const stop =
    kind === 'drawer' || kind === 'drawer-backdrop' ? drawerInteraction(node, open, kind, controls) : () => haltMotion(node, controls);
  return () => {
    active = false;
    stop();
  };
}

function surfaceAnimation(
  node: HTMLElement,
  {
    open,
    kind,
    initial,
    instant,
  }: {
    open: boolean;
    kind: SurfaceMotionKind;
    initial: boolean;
    instant: boolean;
  },
) {
  const reduced = instantSurface(node, instant);
  const retained = node.classList.contains('upload-drop-overlay');
  if (retained) node.style.setProperty('visibility', initial && !open ? 'hidden' : 'visible');
  const away = reduced ? 'none' : awayTransform(kind, node.dataset.side);
  const { opacity, transform } = surfacePose(node, open, initial, away);
  if (typeof node.animate !== 'function' || reduced) {
    node.style.setProperty('opacity', open ? '1' : '0');
    node.style.setProperty('transform', 'none');
    if (retained && !open) node.style.setProperty('visibility', 'hidden');
    return;
  }
  const controls = animate(
    [node],
    {
      opacity: kind === 'drawer' ? [1, 1] : [opacity, open ? 1 : 0],
      transform: [transform, open ? 'none' : away],
    },
    { duration: surfaceDuration(open, kind), ease: [0.23, 1, 0.32, 1] },
  );
  return retainSurface(node, controls, { open, kind, retained });
}

/** Base UI retains ownership of presence and focus while Motion supplies the element's actual animations. */
export function useSurfaceMotion(open: boolean, kind: SurfaceMotionKind, forwardedRef: Ref<HTMLDivElement> | undefined, instant = false) {
  const element = useRef<HTMLDivElement>(null);
  const visited = useRef(false);
  useImperativeHandle(forwardedRef, () => {
    if (!element.current) throw new Error('Surface ref was read before mounting');
    return element.current;
  }, []);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const initial = !visited.current;
    visited.current = true;
    return surfaceAnimation(node, { open, kind, initial, instant });
  }, [open, kind, instant]);
  return element;
}
