import { useEffect, useEffectEvent, useRef } from 'react';

import type { ReplayBundle } from '../../shared/replay.ts';
import type { Fidelity, MeetingClock } from '../comparison/meeting/clock.ts';
import { ReplayController } from '../player.ts';
import { fitViewport } from '../timeline.ts';

/**
 * Mounts one rrweb player into `stage` (its first child is the host), fits it to the stage, and attaches it to the
 * shared clock. `visibility` reports the tile's fidelity: `off` while it is outside the scroller, so it costs nothing.
 * A new `attempt` remounts after a failure; offset changes after mount go through the clock, not a remount.
 */
export function useReplayTile({
  id,
  bundle,
  clock,
  offset,
  fidelity,
  attempt,
  onFailure,
}: {
  id: string;
  bundle: ReplayBundle;
  clock: MeetingClock;
  offset: number;
  fidelity: Fidelity;
  attempt: number;
  onFailure(message: string): void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const visibility = useRef<HTMLDivElement>(null);
  const mountOffset = useEffectEvent(() => offset);
  const fail = useEffectEvent(onFailure);

  useEffect(() => {
    const box = stage.current;
    const root = box?.firstElementChild as HTMLElement | null;
    if (!box || !root) return;
    let player: ReplayController | undefined;
    const cleanups: Array<() => void> = [];
    try {
      player = new ReplayController(bundle);
      const mounted = player;
      cleanups.push(player.mount(root));
      const fit = () => {
        const viewport = mounted.getViewport();
        if (!(viewport.width > 0 && viewport.height > 0)) return;
        const rect = fitViewport({ width: box.clientWidth, height: box.clientHeight }, viewport, 0);
        root.style.width = `${viewport.width}px`;
        root.style.height = `${viewport.height}px`;
        root.style.transform = `translate(${rect.x}px, ${rect.y}px) scale(${rect.scale})`;
      };
      const observer = new ResizeObserver(fit);
      observer.observe(box);
      cleanups.push(() => observer.disconnect(), player.subscribeViewport(fit));
      fit();
      cleanups.push(clock.attach(id, player, mountOffset()));
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'The recorded page could not be mounted.');
    }
    return () => {
      player?.endScrub();
      for (const cleanup of cleanups.toReversed()) cleanup();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- why: a new attempt remounts the same recording after a failure
  }, [attempt, bundle, clock, id]);

  useEffect(() => {
    const element = visibility.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => clock.setFidelity(id, entry?.isIntersecting ? fidelity : 'off'), {
      root: element.closest<HTMLElement>('[data-meeting-scroller]'),
      threshold: 0.05,
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clock.setFidelity(id, 'off');
    };
  }, [clock, fidelity, id]);

  return { stage, visibility };
}
