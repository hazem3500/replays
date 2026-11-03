import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { activeStepIndex } from '../timeline.ts';
import { useReplay, useReplayTime } from './context.ts';

export interface ReplayStepsModel {
  steps: readonly ReplayStep[];
  activeIndex: number;
  select: (index: number) => void;
}

/** Headless step navigation shared by a custom list, rail, timeline or native ReplaySteps list. */
export function useReplaySteps(): ReplayStepsModel {
  const { bundle, playback } = useReplay();
  const activeIndex = useReplayTime((time) => activeStepIndex(bundle.steps, time, playback.duration));
  return {
    steps: bundle.steps,
    activeIndex,
    select: (index) => {
      const step = bundle.steps[index];
      if (step) playback.seek(step.at);
    },
  };
}

export interface ReplayStepsProps extends Omit<ComponentPropsWithoutRef<'ol'>, 'children'> {
  children?: (model: ReplayStepsModel) => ReactNode;
}

/** An independently placed accessible steps list; a render prop replaces all of its markup. */
export function ReplaySteps({ children, ...props }: ReplayStepsProps) {
  const model = useReplaySteps();
  if (children) return children(model);
  const occurrences = new Map<string, number>();
  return (
    <ol aria-label="Replay steps" {...props}>
      {model.steps.map((step, index) => {
        const identity = `${step.at}:${step.kind}:${step.label}`;
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        return (
          <li key={`${identity}:${occurrence}`}>
            <button type="button" aria-current={index === model.activeIndex ? 'step' : undefined} onClick={() => model.select(index)}>
              {step.label} <span>{formatClock(step.at)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
