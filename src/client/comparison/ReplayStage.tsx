import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import type { ReplayBundle } from '../../shared/replay.ts';
import { formatClock } from '../../shared/replay.ts';
import { ReplayController } from '../player.ts';
import { captionAt } from '../step-caption.ts';
import { fitViewport } from '../timeline.ts';
import { ComparisonCoordinator, type ComparisonSide } from './coordinator.ts';
import { SIDE_LABELS } from './model.ts';

export interface ReplayStageProps {
  bundle: ReplayBundle;
  side: ComparisonSide;
  coordinator: ComparisonCoordinator;
  captions: boolean;
  register(side: ComparisonSide, player: ReplayController | undefined): void;
}

/** Two roots, two controllers. No Viewer context, independent transport, or transition ownership. */
export function ReplayStage({ bundle, side, coordinator, captions, register }: ReplayStageProps) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const registerPlayer = useEffectEvent(register);
  useEffect(() => {
    const root = host.current;
    const stage = box.current;
    if (!root || !stage) return;
    let unmount: (() => void) | undefined;
    let detach: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    let player: ReplayController | undefined;
    try {
      player = new ReplayController(bundle);
      unmount = player.mount(root);
      const mounted = player;
      const fit = () => {
        const viewport = mounted.getViewport();
        if (!(viewport.width > 0 && viewport.height > 0)) return;
        const rect = fitViewport({ width: stage.clientWidth, height: stage.clientHeight }, viewport, 12);
        root.style.width = `${viewport.width}px`;
        root.style.height = `${viewport.height}px`;
        root.style.transform = `translate(${rect.x}px, ${rect.y}px) scale(${rect.scale})`;
        root.style.setProperty('--player-scale', String(rect.scale));
      };
      observer = new ResizeObserver(fit);
      observer.observe(stage);
      unsubscribe = player.subscribeViewport(fit);
      fit();
      detach = coordinator.attach(side, player);
      registerPlayer(side, player);
      // oxlint-disable-next-line react/set-state-in-effect -- The imperative player mount succeeded; clear a previous retry error.
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The recorded page could not be mounted.');
      detach?.();
      unmount?.();
      unmount = undefined;
      observer?.disconnect();
      unsubscribe?.();
      root.replaceChildren();
    }
    return () => {
      registerPlayer(side, undefined);
      player?.endScrub();
      detach?.();
      observer?.disconnect();
      unsubscribe?.();
      unmount?.();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- An explicit retry must remount the same recording after a mount failure.
  }, [attempt, bundle, coordinator, side]);

  return (
    <>
      <div ref={box} className="cmp-stage" role="img" aria-label={`${SIDE_LABELS[side]} recorded page at the shared playhead`}>
        <div ref={host} className="cmp-player-host" inert />
      </div>
      {error ? (
        <div className="cmp-side-error" role="alert">
          <p>Recorded page unavailable: {error}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry {side.toUpperCase()} player
          </button>
        </div>
      ) : null}
      {captions && !error ? <StageCaption bundle={bundle} side={side} coordinator={coordinator} /> : null}
    </>
  );
}

function StageCaption({ bundle, side, coordinator }: Omit<ReplayStageProps, 'register' | 'captions'>) {
  // A primitive selector prevents the page and evidence panels from rerendering on every clock tick.
  const label = useSyncExternalStore(coordinator.subscribe, () => {
    const local = coordinator.getSnapshot()[side];
    return local.status === 'waiting'
      ? 'Waiting at the first frame'
      : (captionAt(bundle.steps, local.time, local.duration)?.label ?? 'No recorded step captions');
  });
  return (
    <p className="cmp-caption" aria-label={`${side.toUpperCase()} step caption`}>
      {label}
    </p>
  );
}

export function SideClock({ side, coordinator }: { side: ComparisonSide; coordinator: ComparisonCoordinator }) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
  const local = state[side];
  const status =
    local.status === 'waiting'
      ? 'Waiting at first frame'
      : local.status === 'ended'
        ? 'Ended · holding last frame'
        : local.status === 'unavailable'
          ? 'Not ready'
          : state.status === 'playing'
            ? 'Playing'
            : 'Paused';
  return (
    <div className="cmp-side-clock" data-state={local.status}>
      <span>
        <time>{formatClock(local.time)}</time>
        <span className="cmp-side-duration"> / {formatClock(local.duration)}</span>
      </span>
      <span title={status}>{local.status === 'ended' ? 'At end' : local.status === 'waiting' ? 'Waiting' : status}</span>
    </div>
  );
}
