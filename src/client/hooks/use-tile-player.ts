import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { Fidelity } from '../compare/clock.ts';
import type { CompareSession } from '../compare/session.ts';
import type { ReplayController } from '../player.ts';
import { exportCaptionScale } from '../step-caption.ts';
import { fitViewport } from '../timeline.ts';

/**
 * Mounts a tile's player into `stage` (its first child is rrweb's host) and keeps the recorded page fitted while
 * the tile glides and resizes. The player mounts once per controller: a layout change only moves the box. The
 * fitted frame's box is published on `stage` the way PlayerStage publishes it, so a caption anchors to the frame.
 * The tile reports its fidelity to the clock, and `off` when it goes; a mount failure is kept by the session.
 */
export function useTilePlayer({
  session,
  id,
  controller,
  fidelity,
}: {
  session: CompareSession;
  id: string;
  controller: ReplayController;
  fidelity: Fidelity;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const failure = useSyncExternalStore(session.subscribeFailures, () => session.failure(id));

  useEffect(() => {
    const box = stage.current;
    const root = box?.firstElementChild;
    if (!box || !(root instanceof HTMLElement)) return;
    const cleanups: Array<() => void> = [];
    const fit = () => {
      const viewport = controller.getViewport();
      if (!(viewport.width > 0 && viewport.height > 0)) return;
      const rect = fitViewport({ width: box.clientWidth, height: box.clientHeight }, viewport);
      root.style.width = `${viewport.width}px`;
      root.style.height = `${viewport.height}px`;
      root.style.transform = `translate(${rect.x}px, ${rect.y}px) scale(${rect.scale})`;
      root.style.setProperty('--player-scale', String(rect.scale));
      const width = viewport.width * rect.scale;
      const height = viewport.height * rect.scale;
      box.style.setProperty('--frame-x', `${rect.x}px`);
      box.style.setProperty('--frame-y', `${rect.y}px`);
      box.style.setProperty('--frame-w', `${width}px`);
      box.style.setProperty('--frame-h', `${height}px`);
      box.style.setProperty('--frame-right', `${box.clientWidth - rect.x - width}px`);
      box.style.setProperty('--frame-bottom', `${box.clientHeight - rect.y - height}px`);
      box.style.setProperty('--caption-scale', String(exportCaptionScale(viewport.width) * rect.scale));
    };
    try {
      cleanups.push(controller.mount(root));
      const observer = new ResizeObserver(fit);
      observer.observe(box);
      cleanups.push(() => observer.disconnect(), controller.subscribeViewport(fit));
      fit();
    } catch (cause) {
      session.fail(id, cause instanceof Error ? cause.message : 'The recorded page could not be mounted.');
    }
    return () => {
      controller.endScrub();
      for (const cleanup of cleanups.toReversed()) cleanup();
    };
  }, [controller, id, session]);

  useEffect(() => {
    session.clock.setFidelity(id, failure ? 'off' : fidelity);
    return () => session.clock.setFidelity(id, 'off');
  }, [failure, fidelity, id, session]);

  return { stage, failure };
}
