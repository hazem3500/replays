import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { useCanHover } from '@/components/ui/tooltip.tsx';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { usePlayer } from '../player.ts';
import { stepKindName } from '../viewer/StepRail.tsx';
import { useTimelineScale } from './timeline-drag.ts';
import { MIN_DOT_GAP_PX, placeStepDots, type StepDot, stepDotDetail, stepDotLabel, stepMarks } from './timeline-marks.ts';

/** How long a touch screen keeps a pressed dot's label up after the finger lifts. */
const PRESSED_LABEL_MS = 2_400;
/** Half the pressed label's widest (phone-editor.css .tl-step-bubble), so a label under an end dot stays on the track. */
const BUBBLE_HALF_PX = 150;

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

/** A dot's name and the line under it, from its step's words, kind and time. */
function labelOf(dot: StepDot) {
  return {
    label: stepDotLabel(dot),
    spoken: stepDotLabel(dot, { spoken: true }),
    detail: stepDotDetail(dot, stepKindName(dot.kind), formatClock),
  };
}

/** A dot's name, its kind and time or pause, then what its shape means, beside a small copy of the dot. */
function DotLabel({ label, detail, wait }: { label: string; detail: { visible: string; meaning: string }; wait: boolean }) {
  return (
    <span className="tl-step-tip">
      {label}
      <span className="tl-step-tip-detail">{detail.visible}</span>
      <span className="tl-step-tip-meaning">
        <AnimatedIcon name="dot" size={12} strokeWidth={wait ? 3 : 0} fill={wait ? 'none' : 'currentColor'} aria-hidden="true" />
        {detail.meaning}
      </span>
    </span>
  );
}

/**
 * The pressed dot's label on a touch screen, under its dot and kept on the track `width` px wide; decorative, as the
 * dot's own name says the same.
 */
function PressedLabel({ x, width, dot }: { x: number; width: number; dot: StepDot }) {
  const { label, detail } = labelOf(dot);
  const half = Math.min(BUBBLE_HALF_PX, width / 2);
  return (
    <span
      className="tl-step-bubble"
      aria-hidden="true"
      data-testid="step-bubble"
      style={{ transform: `translateX(${Math.min(Math.max(x, half), width - half)}px)` }}
    >
      <DotLabel label={label} detail={detail} wait={dot.kind === 'wait'} />
    </span>
  );
}

/**
 * Where a touch screen shows the pressed dot's label, since it has no hover: on press, and for a moment after the
 * finger lifts (or turns the press into a scroll).
 */
function usePressedLabel(canHover: boolean) {
  const [shown, setShown] = useState<number>();
  const hide = useRef<number>(undefined);
  return {
    shown: canHover ? undefined : shown,
    press: (position: number) => {
      window.clearTimeout(hide.current);
      setShown(position);
    },
    release: () => {
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(() => setShown(undefined), PRESSED_LABEL_MS);
    },
  };
}

/** One step's dot: filled for an action, hollow for a wait, named by its tooltip (or its pressed label on a touch screen). */
function StepDotButton({
  dot,
  x,
  removed,
  pressed,
  tabStop,
  onRelease,
  ...handlers
}: {
  dot: StepDot;
  x: number;
  removed: boolean;
  pressed: boolean;
  tabStop: boolean;
  onRelease: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { label, spoken, detail } = labelOf(dot);
  const wait = dot.kind === 'wait';
  return (
    <Hint label={<DotLabel label={label} detail={detail} wait={wait} />}>
      <button
        type="button"
        className="tl-step"
        data-kind={dot.kind}
        data-removed={removed || undefined}
        data-pressed={pressed || undefined}
        data-testid="ruler-step"
        tabIndex={tabStop ? 0 : -1}
        aria-label={`${spoken}, ${detail.spoken}`}
        style={{ transform: `translateX(${x}px)` }}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        {...handlers}
      >
        <AnimatedIcon name="dot" size={20} strokeWidth={wait ? 2.5 : 0} fill={wait ? 'none' : 'currentColor'} />
      </button>
    </Hint>
  );
}

/**
 * The recording's steps as dots on the ruler, filled for an action and hollow for a wait. Hovering or focusing one
 * names its step, its kind and time or its pause, and what its shape means; on a touch screen a press shows the same
 * label. A click, tap, Enter or Space seeks there. The dots are one tab stop: arrows, Home and End move
 * along them. Steps the trim or a cut removes dim.
 */
export function TimelineStepDots({
  steps,
  isRemoved,
  target = MIN_DOT_GAP_PX,
}: {
  steps: readonly ReplayStep[];
  isRemoved: (time: number) => boolean;
  /** Each dot's target in px (the phone's is larger, for a finger); closer dots merge, so no two targets overlap. */
  target?: number;
}) {
  const scale = useTimelineScale();
  const player = usePlayer();
  const canHover = useCanHover();
  const pressed = usePressedLabel(canHover);
  const [current, setCurrent] = useState(0);
  const dots = placeStepDots(stepMarks(steps, scale.duration), scale.duration, scale.width, target);
  if (!dots.length) return null;
  const stop = Math.min(current, dots.length - 1);
  const bubble = pressed.shown === undefined ? undefined : dots[pressed.shown];
  return (
    <div className="tl-steps" role="group" aria-label="Steps" data-testid="ruler-steps">
      {dots.map((dot, position) => (
        <StepDotButton
          key={`${dot.index}-${dot.at}`}
          dot={dot}
          x={scale.x(dot.at)}
          removed={isRemoved(dot.seek)}
          pressed={pressed.shown === position}
          tabStop={position === stop}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (event.pointerType === 'touch') pressed.press(position);
          }}
          onRelease={pressed.release}
          onClick={() => {
            setCurrent(position);
            player.seek(dot.seek);
          }}
          onKeyDown={(event) => moveFocus(event, position, dots.length, setCurrent)}
        />
      ))}
      {bubble ? <PressedLabel x={scale.x(bubble.at)} width={scale.width} dot={bubble} /> : null}
    </div>
  );
}
