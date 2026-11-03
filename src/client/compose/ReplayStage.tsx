import type { ComponentPropsWithoutRef } from 'react';

import { useComposedStage } from '../hooks/use-composed-stage.ts';
import { useReplay, useReplayViewport } from './context.ts';

export interface ReplayStageProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Space around the fitted recorded viewport in CSS pixels. */
  padding?: number;
}

/** One inert replay picture per provider; put playback controls and accessible steps beside it. */
export function ReplayStage({ padding = 0, className, style, ...props }: ReplayStageProps) {
  const { playback } = useReplay();
  const viewport = useReplayViewport();
  const { box, host } = useComposedStage(playback, padding);
  return (
    <div
      {...props}
      ref={box}
      className={`replays-stage${className ? ` ${className}` : ''}`}
      style={{ aspectRatio: `${viewport.width} / ${viewport.height}`, ...style }}
    >
      <div ref={host} className="replays-stage-host" inert aria-hidden="true" />
    </div>
  );
}
