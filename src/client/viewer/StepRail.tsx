import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { AnimatedIcon, type AnimatedIconName } from '@/components/animated-icon.tsx';
import { AnimatedNumber } from '@/components/animated-number.tsx';
import { HoverGlide, useSlidingHighlight } from '@/components/sliding-highlight.tsx';

import { formatClock } from '../../shared/replay.ts';
import { STEP_KIND_NAMES } from './step-kinds.ts';
import { usePlayer, usePlayerState, usePlayhead } from '../player.ts';
import { useActiveStep } from './active-step.ts';
import { readStorage } from '../storage.ts';
import { usePreviewStepIndex } from './preview-time.ts';
import { useViewer } from './context.ts';
import { Empty } from './Empty.tsx';
import { activeStepIndex } from './Transport.tsx';
import { useFilledAfterTransition } from '../hooks/use-filled-after-transition.ts';
import { queueReveal } from './stagger.ts';
import { useViewerPresenceMotion } from '../hooks/use-viewer-presence-motion.ts';
import { StepNameInput } from './StepNameInput.tsx';
import { useRenamingKey, useStepRenaming } from './step-rename-context.ts';

/** One glyph per step kind; the kind's name is the icon's accessible label. */
const STEP_ICONS: Record<string, { icon: AnimatedIconName; label: string }> = {
  click: { icon: 'mouse-pointer-click', label: STEP_KIND_NAMES.click },
  dblclick: { icon: 'mouse-pointer-click', label: STEP_KIND_NAMES.dblclick },
  hover: { icon: 'mouse-pointer-2', label: STEP_KIND_NAMES.hover },
  type: { icon: 'text-cursor-input', label: STEP_KIND_NAMES.type },
  fill: { icon: 'text-cursor-input', label: STEP_KIND_NAMES.fill },
  press: { icon: 'corner-down-left', label: STEP_KIND_NAMES.press },
  goto: { icon: 'globe', label: STEP_KIND_NAMES.goto },
  open: { icon: 'globe', label: STEP_KIND_NAMES.open },
  navigate: { icon: 'globe', label: STEP_KIND_NAMES.navigate },
  scroll: { icon: 'arrow-down-up', label: STEP_KIND_NAMES.scroll },
  wait: { icon: 'hourglass', label: STEP_KIND_NAMES.wait },
  submit: { icon: 'corner-down-left', label: 'Form request' },
  start: { icon: 'play', label: 'Recording started' },
  stop: { icon: 'pause', label: 'Recording stopped' },
  action: { icon: 'mouse-pointer-click', label: 'App action' },
};

/** The step's kind glyph; it plays its gesture once when its row becomes the current step (never on hover). */
export function StepIcon({ kind, active = false, index }: { kind: string; active?: boolean; index?: number }) {
  const entry = STEP_ICONS[kind] ?? { icon: 'mouse-pointer-click' as const, label: kind };
  return <AnimatedIcon name={entry.icon} className="step-kind" trigger="state" play={active ? (index ?? 0) : false} />;
}

/** Set while a key auto-repeats, so holding ] scrolls the rail instantly instead of easing every step. */
let keyRepeatAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (event.repeat) keyRepeatAt = performance.now();
  });
}

/**
 * One calm line per step: the step's kind as its only leading glyph, the label (the current step's selector
 * trails it in mono), the time right-aligned. Past steps recede, the current one sits on a single highlight
 * that slides between rows, `wait` steps are quieter (muted, 28 px) in the same columns. The selector shows
 * for the current step and on hover; numbers live in the header ("7 of 19") and the accessible names.
 */
/** Rest this long on a step before its target is outlined in the replay. */
const TARGET_INTENT_MS = 250;

export const StepRail = memo(function StepRail() {
  const { steps } = useViewer();
  const active = useActiveStep(steps);
  // While playing, the count steps with the caption on the player (no roll that would lag it).
  const { status } = usePlayerState();
  const filled = useFilledAfterTransition();
  return (
    <aside className="timeline-panel" aria-label="Steps">
      <div className="section-heading">
        <h2>Steps</h2>
        <span className="section-count" data-testid="step-count">
          {/* "Steps" is the heading beside it, so the count is just "7 of 11"; assistive tech hears "Step 7 of 11". */}
          <span aria-hidden="true">
            <AnimatedNumber value={active + 1} instant={status === 'playing'} /> of {steps.length}
          </span>
          <span className="visually-hidden">
            Step {active + 1} of {steps.length}
          </span>
        </span>
      </div>
      {filled ? <StepList /> : <div className="timeline-wrap" />}
    </aside>
  );
});

/** The step list itself: the desktop rail's body, and the Steps tab of the mobile panel. */
export const StepList = memo(function StepList() {
  const { steps, goToStep } = useViewer();
  const renaming = useStepRenaming();
  const editingKey = useRenamingKey(renaming, 'rail');
  const player = usePlayer();
  const active = usePlayhead((time) => activeStepIndex(steps, time, player.duration));
  const list = useRef<HTMLDivElement>(null);
  const presence = useRef<HTMLDivElement>(null);
  useViewerPresenceMotion(presence, 'steps');
  // Hovering (or tabbing to) a step with a selector outlines what it matches in the replay, after a short intent,
  // and only when that step's page is the one on screen (otherwise nothing).
  const targetTimer = useRef(0);
  const showTarget = (selector: string | undefined, at: number) => {
    window.clearTimeout(targetTimer.current);
    if (!selector) return;
    targetTimer.current = window.setTimeout(() => player.highlightTarget(selector, at), TARGET_INTENT_MS);
  };
  const hideTarget = () => {
    window.clearTimeout(targetTimer.current);
    player.clearTarget();
  };
  useEffect(() => () => window.clearTimeout(targetTimer.current), []);
  // The step under the scrubber's pointer (hover or drag): a faint background, and an edge hint when off-screen.
  const stepTimes = useMemo(() => steps.map((step) => step.at), [steps]);
  const preview = usePreviewStepIndex(stepTimes);
  const [edge, setEdge] = useState<'above' | 'below'>();
  useLayoutEffect(() => {
    const container = list.current;
    if (!container || preview < 0) {
      setEdge(undefined);
      return;
    }
    const measure = () => {
      const row = container.querySelector<HTMLElement>(`[data-step-index="${preview}"]`);
      if (!row) return setEdge(undefined);
      setEdge(
        row.offsetTop + row.offsetHeight <= container.scrollTop
          ? 'above'
          : row.offsetTop >= container.scrollTop + container.clientHeight
            ? 'below'
            : undefined,
      );
    };
    measure();
    container.addEventListener('scroll', measure, { passive: true });
    return () => container.removeEventListener('scroll', measure);
  }, [preview]);
  // On mount (the replay opening, or the phone's Steps tab chosen) the visible rows rise in, staggered, on the same
  // clock as the inspector's (stagger.ts revealRows). The list
  // first lands on the active step so the rows that animate are the ones that stay on screen.
  useLayoutEffect(() => {
    const container = list.current;
    if (!container) return;
    const row = container.querySelector<HTMLElement>(`[data-step-index="${active}"]`);
    if (row && container.clientHeight > 0 && row.offsetTop + row.offsetHeight + 8 > container.clientHeight) {
      container.scrollTop = Math.max(0, row.offsetTop + row.offsetHeight + 8 - container.clientHeight);
    }
    queueReveal(container, '.step');
    // Mount only: later rows (playback, scrolling) never animate.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);
  const { highlight, place } = useSlidingHighlight(list, {
    selector: `[data-step-index="${active}"]`,
    index: active,
    instant: () => performance.now() - keyRepeatAt < 150 || player.isScrubbing(),
  });

  // Scroll the list itself, never the page (scrollIntoView would drag a stacked page along), then move the
  // highlight. The layout reads wait for the next frame, so a scrub that changes step on every move measures
  // once per frame, after the replay's DOM work, instead of forcing an extra layout in each commit.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = list.current;
      const row = container?.querySelector<HTMLElement>(`[data-step-index="${active}"]`);
      if (!container || !row || container.clientHeight === 0) return place();
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      const pad = 8;
      let target: number | undefined;
      if (top - pad < container.scrollTop) target = top - pad;
      else if (bottom + pad > container.scrollTop + container.clientHeight) target = bottom + pad - container.clientHeight;
      if (target !== undefined) {
        // Adjacent rows ease into view; far jumps (or a held key) land at once.
        const far = Math.abs(target - container.scrollTop) > container.clientHeight;
        const instant = far || performance.now() - keyRepeatAt < 150 || matchMedia('(prefers-reduced-motion: reduce)').matches;
        container.scrollTo({ top: Math.max(0, target), behavior: instant ? 'auto' : 'smooth' });
      }
      place();
    });
    return () => cancelAnimationFrame(frame);
    // `place` reads refs only.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [active]);

  const previewed = preview >= 0 ? steps[preview] : undefined;
  return (
    <div ref={presence} className="timeline-wrap">
      <div ref={list} className="timeline" data-testid="step-timeline">
        {steps.length === 0 ? (
          <Empty title="No agent steps">This replay contains browser events only.</Empty>
        ) : (
          <>
            <HoverGlide container={list} itemSelector=".step" />
            <div ref={highlight} className="sliding-highlight" aria-hidden="true" />
            {steps.map((step, index) => {
              const state = index === active ? 'active' : index < active ? 'complete' : 'upcoming';
              // Older bundles can omit the kind.
              const kind = STEP_ICONS[step.kind]?.label ?? step.kind ?? '';
              const clock = formatClock(step.at);
              const where = [kind.toLowerCase(), step.selector].filter(Boolean).join(' ') || 'step';
              const key = renaming?.keys[index];
              const canRename = Boolean(renaming?.allowed && key);
              if (renaming && key && key === editingKey)
                return (
                  <div
                    key={`${step.at}-${index}-editing`}
                    data-step-index={index}
                    className={`step editing ${state} ${step.kind === 'wait' ? 'wait' : ''}`}
                  >
                    <StepIcon kind={step.kind} active={index === active} index={index} />
                    <StepNameInput renaming={renaming} renamed={key in renaming.names} onFinish={renaming.finish} />
                    <time>{clock}</time>
                  </div>
                );
              return (
                <button
                  key={`${step.at}-${step.label}`}
                  type="button"
                  data-step-index={index}
                  className={`step ${state} ${step.kind === 'wait' ? 'wait' : ''} ${index === preview && index !== active ? 'previewed' : ''}`}
                  aria-current={index === active ? 'step' : undefined}
                  aria-label={`Step ${index + 1} of ${steps.length}, ${step.label}, ${where}, ${clock}`}
                  onClick={() => goToStep(index)}
                  onDoubleClick={canRename ? () => renaming?.start(index, 'rail', step.label) : undefined}
                  onKeyDown={
                    canRename
                      ? (event) => {
                          if (event.key !== 'F2') return;
                          event.preventDefault();
                          renaming?.start(index, 'rail', step.label);
                        }
                      : undefined
                  }
                  onPointerEnter={(event) => {
                    // A native title for the full label, only when the row cuts it; renaming adds its hint.
                    const label = event.currentTarget.querySelector('strong');
                    const cut = label && label.scrollWidth > label.clientWidth ? step.label : '';
                    event.currentTarget.title = [cut, canRename ? 'Double-click to rename' : ''].filter(Boolean).join('\n');
                    if (event.pointerType === 'mouse') showTarget(step.selector, step.at);
                  }}
                  onPointerLeave={hideTarget}
                  onFocus={(event) => {
                    if (event.currentTarget.matches(':focus-visible')) showTarget(step.selector, step.at);
                  }}
                  onBlur={hideTarget}
                >
                  <StepIcon kind={step.kind} active={index === active} index={index} />
                  <span className="step-copy">
                    <strong>{step.label}</strong>
                    {step.selector && step.kind !== 'wait' ? <small>{step.selector}</small> : null}
                  </span>
                  <time>{clock}</time>
                </button>
              );
            })}
          </>
        )}
      </div>
      {/* Where the scrubber's pointer is, when that step is scrolled out of view. Muted; never scrolls the list. */}
      <div className="step-edge-hint" data-edge={edge} data-testid="step-edge-hint" aria-hidden="true">
        {edge && previewed ? (
          <>
            {edge === 'above' ? <ArrowUpIcon /> : <ArrowDownIcon />}
            <span>Step {preview + 1}</span>
            <span className="step-edge-label">{previewed.label}</span>
          </>
        ) : null}
      </div>
    </div>
  );
});

export const STEPS_WIDTH_KEY = 'replays-steps-width';
export const MIN_STEPS_WIDTH = 220;

export function savedStepsWidth() {
  const saved = Number(readStorage(STEPS_WIDTH_KEY));
  return Number.isFinite(saved) && saved > 0 ? saved : undefined;
}
