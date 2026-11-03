import { type Ref, type RefObject, useEffect, useImperativeHandle, useRef } from 'react';

import type { AnimatedIconDefinition } from '../components/animated-icon-data.ts';
import type { AnimatedIconHandle } from '../components/animated-icon.tsx';
import { animateIcon } from '../components/animated-icon-motion.ts';
import { createIconPlayer, createKeyWatcher, type IconPlayer } from '../components/animated-icon-player.ts';

export const ICON_HOST_SELECTOR =
  '[data-icon-host], button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"], label';

interface Activation {
  trigger: 'hover' | 'state' | 'none';
  play: unknown;
  hover: boolean;
  ref: Ref<AnimatedIconHandle> | undefined;
}

function listenForActivation(svg: SVGSVGElement, player: RefObject<IconPlayer | null>) {
  const host = svg.parentElement?.closest(ICON_HOST_SELECTOR) ?? svg;
  const onPointerEnter = (event: Event) => {
    if (event instanceof PointerEvent && event.pointerType !== 'touch') player.current?.play();
  };
  const onPointerUp = (event: Event) => {
    if (event instanceof PointerEvent && event.pointerType === 'touch') player.current?.play();
  };
  const onFocusIn = (event: Event) => {
    if (event.target === host && host.matches(':focus-visible')) player.current?.play();
  };
  let highlighted = host.hasAttribute('data-highlighted');
  const onHighlight = () => {
    const next = host.hasAttribute('data-highlighted');
    if (next && !highlighted && !host.matches(':disabled, [aria-disabled="true"], [data-disabled]')) player.current?.play();
    highlighted = next;
  };
  const observer = new MutationObserver(onHighlight);
  observer.observe(host, { attributes: true, attributeFilter: ['data-highlighted'] });
  if (highlighted && !host.matches(':disabled, [aria-disabled="true"], [data-disabled]')) player.current?.play();
  host.addEventListener('pointerenter', onPointerEnter);
  host.addEventListener('pointerup', onPointerUp);
  host.addEventListener('focusin', onFocusIn);
  return () => {
    observer.disconnect();
    host.removeEventListener('pointerenter', onPointerEnter);
    host.removeEventListener('pointerup', onPointerUp);
    host.removeEventListener('focusin', onFocusIn);
  };
}

/** State coalescing and input activation share one cancellable Motion gesture for each mounted SVG. */
export function useAnimatedIcon(definition: AnimatedIconDefinition, { trigger, play, hover, ref }: Activation) {
  const svgRef = useRef<SVGSVGElement>(null);
  const playerRef = useRef<IconPlayer | null>(null);
  const keyWatcher = useRef<((next: unknown) => boolean) | null>(null);
  keyWatcher.current ??= createKeyWatcher(play);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const player = createIconPlayer(
      {
        setAttribute: (name, value) => svg.setAttribute(name, value),
        removeAttribute: (name) => svg.removeAttribute(name),
        startMotion: () => animateIcon(svg, definition),
      },
      definition.ms,
    );
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = () => {
      if (reduced.matches) player.cancel();
    };
    reduced.addEventListener('change', onMotionChange);
    playerRef.current = player;
    return () => {
      player.cancel();
      reduced.removeEventListener('change', onMotionChange);
      playerRef.current = null;
    };
  }, [definition]);
  useImperativeHandle(ref, () => ({ play: () => playerRef.current?.play() ?? false }), []);
  useEffect(() => {
    if (trigger === 'state' && keyWatcher.current?.(play)) playerRef.current?.play({ coalesce: true });
  }, [trigger, play]);
  useEffect(() => {
    if ((trigger !== 'hover' && !(trigger === 'state' && hover)) || !svgRef.current) return;
    return listenForActivation(svgRef.current, playerRef);
  }, [hover, trigger]);
  return svgRef;
}
