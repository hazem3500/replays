import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { usePlayer } from '../player.ts';
import { useTimelineScale } from './timeline-drag.ts';
import { placeStepDots, stepDotLabel } from './timeline-marks.ts';

/** The dot a roving key moves to from `position`, or undefined for any other key. */
function rovingTarget(key: string, position: number, count: number) {
  if (key === 'ArrowLeft') return Math.max(0, position - 1);
  if (key === 'ArrowRight') return Math.min(count - 1, position + 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return;
}

/** Arrows, Home and End move focus along the dots; the one reached becomes the group's tab stop. */
function moveFocus(event: ReactKeyboardEvent<HTMLButtonElement>, position: number, count: number, onMove: (next: number) => void) {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  const next = rovingTarget(event.key, position, count);
  if (next === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  onMove(next);
  const dots = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.tl-step');
  dots?.[next]?.focus();
}

/**
 * The recording's steps as small dots on the ruler. Hovering or focusing one names its step; a click, Enter or Space
 * seeks there. The dots are one tab stop: arrows, Home and End move along them. Steps the trim or a cut removes dim.
 */
export function TimelineStepDots({ steps, isRemoved }: { steps: readonly ReplayStep[]; isRemoved: (time: number) => boolean }) {
  const scale = useTimelineScale();
  const player = usePlayer();
  const [current, setCurrent] = useState(0);
  const dots = placeStepDots(steps, scale.duration, scale.width);
  if (!dots.length) return null;
  const stop = Math.min(current, dots.length - 1);
  return (
    <div className="tl-steps" role="group" aria-label="Steps" data-testid="ruler-steps">
      {dots.map((dot, position) => {
        const label = stepDotLabel(dot);
        return (
          <Hint key={`${dot.index}-${dot.at}`} label={label}>
            <button
              type="button"
              className="tl-step"
              data-kind={dot.kind}
              data-removed={isRemoved(dot.at) || undefined}
              data-testid="ruler-step"
              tabIndex={position === stop ? 0 : -1}
              aria-label={`${label}, ${formatClock(dot.at)}`}
              style={{ transform: `translateX(${scale.x(dot.at)}px)` }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                setCurrent(position);
                player.seek(dot.at);
              }}
              onKeyDown={(event) => moveFocus(event, position, dots.length, setCurrent)}
            >
              <AnimatedIcon
                name="dot"
                size={12}
                strokeWidth={dot.kind === 'wait' ? 2.5 : 0}
                fill={dot.kind === 'wait' ? 'none' : 'currentColor'}
              />
            </button>
          </Hint>
        );
      })}
    </div>
  );
}
