import { useLayoutEffect, useRef } from 'react';

import type { Playback } from '../playback/index.ts';
import { fitViewport } from '../timeline.ts';

const mounted = new WeakSet<Playback>();

/** Mounts one stage for a playback and removes its renderer, subscriptions and resize observer on cleanup. */
export function useComposedStage(playback: Playback, padding: number) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    const target = host.current;
    if (!element || !target) return;
    if (mounted.has(playback)) throw new Error('A playback supports one ReplayStage; use separate providers for multiple pictures');
    const unmount = playback.mount(target);
    mounted.add(playback);
    return () => {
      unmount();
      mounted.delete(playback);
    };
  }, [playback]);
  useLayoutEffect(() => {
    const element = box.current;
    const target = host.current;
    if (!element || !target) return;
    const fit = () => {
      const viewport = playback.getViewport();
      const frame = fitViewport({ width: element.clientWidth, height: element.clientHeight }, viewport, padding);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      target.style.transform = `translate(${frame.x}px, ${frame.y}px) scale(${frame.scale})`;
      target.style.setProperty('--player-scale', String(frame.scale));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    const unsubscribe = playback.subscribeViewport(fit);
    fit();
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [padding, playback]);
  return { box, host };
}
