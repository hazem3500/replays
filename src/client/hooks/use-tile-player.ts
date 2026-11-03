import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { Fidelity } from '../compare/clock.ts';
import type { CompareSession } from '../compare/session.ts';
import type { ReplayController } from '../player.ts';
import { exportCaptionScale } from '../step-caption.ts';
import { fitViewport } from '../timeline.ts';
import { waitForReplayPaint } from './replay-first-paint.ts';
import { afterPageTransition, pageTransitionRunning } from '../transitions/state.ts';

function fitTile(box: HTMLElement, root: HTMLElement, controller: ReplayController) {
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
}

/** Fits before capture; expensive rrweb mounts wait for an active route morph to finish. */
export function useTilePlayer({
  session,
  id,
  controller,
  fidelity,
  size,
}: {
  session: CompareSession;
  id: string;
  controller: ReplayController;
  fidelity: Fidelity;
  size?: { width: number; height: number } | undefined;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [paintedFor, setPaintedFor] = useState<ReplayController>();
  const painted = paintedFor === controller;
  const failure = useSyncExternalStore(session.subscribeFailures, () => session.failure(id));
  const width = size?.width;
  const height = size?.height;

  useLayoutEffect(() => {
    const box = stage.current;
    const root = box?.firstElementChild;
    if (!box || !(root instanceof HTMLElement)) return;
    // why: comparison tiles need an 18 px cursor rather than the standalone player's 32 px glyph.
    root.style.setProperty('--player-cursor-size', '0.5625');
    const fit = () => fitTile(box, root, controller);
    // why: placement commits must fit synchronously; a native snapshot can defer ResizeObserver delivery.
    if (width === undefined || height === undefined || (width > 0 && height > 0)) fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    const unsubscribe = controller.subscribeViewport(fit);
    return () => {
      observer.disconnect();
      unsubscribe();
      root.style.removeProperty('--player-cursor-size');
    };
  }, [controller, width, height]);

  useEffect(() => {
    const root = stage.current?.firstElementChild;
    if (!(root instanceof HTMLElement)) return;
    let live = true;
    let unmount: (() => void) | undefined;
    const abort = new AbortController();
    const mount = () => {
      if (!live) return;
      try {
        unmount = controller.mount(root);
        void waitForReplayPaint(root, abort.signal).then(
          () => {
            if (live) setPaintedFor(controller);
          },
          (cause: unknown) => {
            if (live) session.fail(id, cause instanceof Error ? cause.message : 'The recorded page could not be painted.');
          },
        );
      } catch (cause) {
        session.fail(id, cause instanceof Error ? cause.message : 'The recorded page could not be mounted.');
      }
    };
    if (pageTransitionRunning()) void afterPageTransition().then(mount);
    else mount();
    return () => {
      live = false;
      abort.abort();
      controller.endScrub();
      unmount?.();
    };
  }, [controller, id, session]);

  useEffect(() => {
    session.clock.setFidelity(id, failure ? 'off' : fidelity);
    return () => session.clock.setFidelity(id, 'off');
  }, [failure, fidelity, id, session]);

  return { stage, failure, painted };
}
