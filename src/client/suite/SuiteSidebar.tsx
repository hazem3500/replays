import { useQueryClient } from '@tanstack/react-query';
import { PanelLeftCloseIcon, PanelLeftOpenIcon, PinIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef } from 'react';

import { Hint, IconButton, SwitchIconButton } from '@/components/icon-button.tsx';
import { HoverGlide, useSlidingHighlight } from '@/components/sliding-highlight.tsx';

import { formatClock } from '../../shared/replay.ts';
import { suiteOverallStatus } from '../../shared/review-suite.ts';
import { plural } from '../plural.ts';
import { prefetchReplay, type SuiteWithRuns } from '../queries.ts';
import { shortcutLabel } from '../shortcuts.ts';
import type { useKeepSuite } from '../viewer/keep.ts';
import {
  expiredRuns,
  expiryNotice,
  isHttps,
  runErrors,
  sequenceLabel,
  statusTone,
  subjectLink,
  SUITE_STRINGS,
  type WorkspaceRun,
} from './run-rows.ts';
import { isExpired, neighbourReplayId, playableReplayId } from './runs.ts';
import './suite-layout.css';

export function SuiteSidebar({
  suite,
  runs,
  detailed,
  selected,
  collapsed,
  onSelect,
  onSwitch,
  keep,
  layoutSwitch,
}: {
  suite: SuiteWithRuns;
  runs: WorkspaceRun[];
  detailed: boolean;
  selected: string | undefined;
  collapsed: boolean;
  onSelect: (replayId: string | undefined) => void;
  onSwitch: () => void;
  keep: ReturnType<typeof useKeepSuite>;
  /** Single · Grid · Spotlight, under the head (a suite with two or more recordings). */
  layoutSwitch?: ReactNode;
}) {
  const overall = suiteOverallStatus(runs);
  const duration = runs.reduce((total, run) => total + (run.duration ?? 0), 0);
  const list = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const subject = subjectLink(suite);
  const expiredCount = expiredRuns(runs, detailed);
  const selectedIndex = runs.findIndex((run) => playableReplayId(run, detailed) === selected);
  const { highlight, place } = useSlidingHighlight(list, { selector: '[aria-current="page"]', index: selectedIndex });
  // why: one highlight slides to the current run whenever it changes or the rail collapses.
  useLayoutEffect(() => {
    place();
    // oxlint-disable-next-line react/exhaustive-deps -- why: `place` reads refs only
  }, [selectedIndex, collapsed]);

  // why: the neighbours J / Shift+J reach, so their tooltips can show the key.
  const nextRunId = neighbourReplayId(runs, selected, 1, detailed);
  const previousRunId = neighbourReplayId(runs, selected, -1, detailed);
  // why: ↑/↓ and J/K move between runs while the run list is active.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowDown' || event.key === 'j' ? 1 : event.key === 'ArrowUp' || event.key === 'k' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const next = neighbourReplayId(runs, selected, step, detailed);
    onSelect(next);
    if (next) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-replay-id="${CSS.escape(next)}"]`)?.focus());
  };

  return (
    <aside className="suite-sidebar" aria-label="Review suite">
      <div className="suite-sidebar-head">
        {collapsed ? null : (
          <div className="suite-sidebar-title">
            <h2 title={suite.title}>{suite.title}</h2>
            <p className="suite-sidebar-meta">
              <span className={`status-dot tone-${overall.toLowerCase()}`} aria-hidden="true" />
              <span>{overall}</span>
              <span>{formatClock(duration)}</span>
            </p>
            {subject ? (
              <p className="suite-sidebar-meta">
                {isHttps(subject.url) ? (
                  <a href={subject.url} target="_blank" rel="noopener noreferrer">
                    {subject.label ? `${subject.provider} · ${subject.label}` : subject.provider} ↗
                  </a>
                ) : (
                  <span>{subject.label ? `${subject.provider} · ${subject.label}` : subject.provider}</span>
                )}
              </p>
            ) : null}
            {expiredCount > 0 && expiredCount < runs.length ? (
              <p className="suite-sidebar-meta suite-expired-notice">{SUITE_STRINGS.someExpired(expiredCount, runs.length)}</p>
            ) : null}
          </div>
        )}
        {collapsed ? null : (
          <SwitchIconButton
            label={keep.kept ? `Kept by ${keep.retention?.kept?.by ?? 'someone'} · release` : 'Keep suite and its runs'}
            tooltipSide="bottom"
            pressed={keep.kept}
            onPressedChange={keep.flip}
            disabled={keep.pending}
            data-testid="keep-suite"
          >
            <PinIcon aria-hidden="true" />
          </SwitchIconButton>
        )}
        <IconButton
          label={collapsed ? 'Expand runs sidebar' : 'Collapse runs sidebar'}
          tooltipSide="right"
          size="icon-sm"
          className="suite-rail-switch"
          onClick={onSwitch}
        >
          {collapsed ? <PanelLeftOpenIcon aria-hidden="true" /> : <PanelLeftCloseIcon aria-hidden="true" />}
        </IconButton>
      </div>
      {layoutSwitch ? <div className="suite-layout">{layoutSwitch}</div> : null}
      <div ref={list} className="suite-run-list" role="list" aria-label="Runs">
        <HoverGlide container={list} itemSelector=".suite-run-item" />
        <div ref={highlight} className="sliding-highlight" aria-hidden="true" />
        {runs.map((run) => {
          const errors = runErrors(run);
          const playable = playableReplayId(run, detailed);
          const expired = isExpired(run, detailed);
          const expiry = playable ? expiryNotice(run) : undefined;
          const tone = statusTone(run, detailed);
          const current = playable !== undefined && playable === selected;
          // why: the label gets the full line; status, duration and errors share one muted meta line below it.
          const content = collapsed ? (
            <>
              <span className="run-seq">{sequenceLabel(run)}</span>
              <span className={`status-dot tone-${tone}`} aria-hidden="true" />
            </>
          ) : (
            <>
              <span className="run-seq">{sequenceLabel(run)}</span>
              <span className="run-copy">
                <span className="run-label">{run.label}</span>
                <span className="run-meta">
                  <span className={`status-dot tone-${tone}`} aria-hidden="true" />
                  <span className="run-status">{playable ? tone : expired ? SUITE_STRINGS.expired : SUITE_STRINGS.noRecording}</span>
                  {run.duration !== undefined ? <span className="run-duration">{formatClock(run.duration)}</span> : null}
                  {errors > 0 ? <span className="run-errors">{plural(errors, 'error')}</span> : null}
                  {expiry ? (
                    <span className="run-expiry" title={expiry.date}>
                      {expiry.label}
                    </span>
                  ) : null}
                </span>
              </span>
            </>
          );
          const label = `Run ${sequenceLabel(run)}: ${run.label}, ${tone}${errors ? `, ${plural(errors, 'error')}` : ''}${playable ? '' : expired ? ', recording expired' : ', no recording'}`;
          return (
            <div role="listitem" key={run.id}>
              {playable ? (
                <Hint
                  label={label}
                  side="right"
                  {...(playable && playable === nextRunId
                    ? { shortcut: shortcutLabel('next-run') }
                    : playable && playable === previousRunId
                      ? { shortcut: shortcutLabel('previous-run') }
                      : {})}
                >
                  <button
                    type="button"
                    className="suite-run-item"
                    data-replay-id={playable}
                    aria-current={current ? 'page' : undefined}
                    aria-label={label}
                    tabIndex={current || (!selected && run === runs[0]) ? 0 : -1}
                    onPointerEnter={() => void prefetchReplay(queryClient, playable)}
                    onFocus={() => void prefetchReplay(queryClient, playable)}
                    onClick={() => onSelect(playable)}
                    onKeyDown={onKeyDown}
                  >
                    {content}
                  </button>
                </Hint>
              ) : (
                <div className="suite-run-item" aria-disabled="true" aria-label={label}>
                  {content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/**
 * The runs sidebar before its suite loads: the same markup with stand-in text (`.redact`, src/client/loading.css), no
 * links and no keyboard navigation. Skeletons render this instead of drawing their own.
 */
export function SuiteSidebarPending({ rows = 4, collapsed = false }: { rows?: number; collapsed?: boolean }) {
  return (
    <aside className="suite-sidebar pending" aria-hidden="true">
      <div className="suite-sidebar-head">
        {collapsed ? null : (
          <div className="suite-sidebar-title">
            <h2 className="redact">Review suite title</h2>
            <p className="suite-sidebar-meta">
              <span className="redact">Passed · 0:00</span>
            </p>
          </div>
        )}
      </div>
      <div className="suite-run-list">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="suite-run-item">
            <span className="run-seq">{String(index + 1).padStart(2, '0')}</span>
            {collapsed ? null : (
              <span className="run-copy">
                <span className="run-label redact">Run label stand-in</span>
                <span className="run-meta">
                  <span className="redact">Passed · 0:00</span>
                </span>
              </span>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
