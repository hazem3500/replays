import { useEffect, useRef, useState } from 'react';

import type { Fidelity, SharedClock } from '../compare/clock.ts';
import type { ReplayController } from '../player.ts';
import { fitViewport } from '../timeline.ts';

/**
 * Mounts a tile's player into `stage` (its first child is rrweb's host) and keeps the recorded page fitted while
 * the tile glides and resizes. The player mounts once per controller: a layout change only moves the box.
 * The tile reports its fidelity to the clock, and `off` when it goes.
 */
export function useTilePlayer({
  clock,
  id,
  controller,
  fidelity,
}: {
  clock: SharedClock;
  id: string;
  controller: ReplayController;
  fidelity: Fidelity;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    const box = stage.current;
    const root = box?.firstElementChild as HTMLElement | null;
    if (!box || !root) return;
    const cleanups: Array<() => void> = [];
    const fit = () => {
      const viewport = controller.getViewport();
      if (!(viewport.width > 0 && viewport.height > 0)) return;
      const rect = fitViewport({ width: box.clientWidth, height: box.clientHeight }, viewport);
      root.style.width = `${viewport.width}px`;
      root.style.height = `${viewport.height}px`;
      root.style.transform = `translate(${rect.x}px, ${rect.y}px) scale(${rect.scale})`;
      root.style.setProperty('--player-scale', String(rect.scale));
    };
    try {
      cleanups.push(controller.mount(root));
      const observer = new ResizeObserver(fit);
      observer.observe(box);
      cleanups.push(() => observer.disconnect(), controller.subscribeViewport(fit));
      fit();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'The recorded page could not be mounted.');
    }
    return () => {
      controller.endScrub();
      for (const cleanup of cleanups.toReversed()) cleanup();
    };
  }, [controller]);

  useEffect(() => {
    clock.setFidelity(id, failure ? 'off' : fidelity);
    return () => clock.setFidelity(id, 'off');
  }, [clock, failure, fidelity, id]);

  return { stage, failure };
}
