import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef } from 'react';

import type { ReplayStep } from '../../../shared/replay.ts';
import { useRevealRow } from '../../hooks/use-reveal-row.ts';
import { useRowHeight } from '../../hooks/use-row-height.ts';
import { usePlayhead } from '../../player.ts';
import { useWindowedRows } from '../../windowing.ts';
import { formatDuration, stepAt } from '../network/model.ts';
import { HEADER_HEIGHT, SeekTime } from '../TrackList.tsx';
import { BUDGETS, type Moment, VERDICT_WORDS } from './model.ts';
import { KEY_MOVES, moveIndex, type StepMove } from '../list-keys.ts';

export const MOMENT_DETAIL_ID = 'performance-detail';

const STRINGS = {
  moment: 'Moment',
  when: 'When',
  took: 'Took',
  budget: 'Against budget',
  why: 'During, and what it waited on',
  budgetHint: (good: number, poor: number) => `Ticks at ${formatDuration(good)} (good) and ${formatDuration(poor)} (poor)`,
};

/** The budget bar's track runs to this many times the poor line, so a value just past it still has room. */
const TRACK_SPAN = 1.6;
const FALLBACK_ROW_HEIGHT = 30;

/**
 * The slow moments, worst first by default: what, when (seeks), how long, how far over budget, and the step it was
 * during with what it most likely waited on (`explain`). A row selects the moment; its detail opens beside the list.
 */
export function MomentList({
  moments,
  steps,
  explain,
  selected,
  onSelect,
  empty,
}: {
  moments: readonly Moment[];
  steps: readonly ReplayStep[];
  explain: (moment: Moment) => string;
  selected: string | undefined;
  onSelect: (id?: string) => void;
  empty: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const rowHeight = useRowHeight(body, '.pp-row:not(.pp-head)', moments.length > 0, FALLBACK_ROW_HEIGHT);
  const { start, end, padTop, padBottom } = useWindowedRows(scroller, { count: moments.length, rowHeight, headerHeight: HEADER_HEIGHT });
  useRevealRow(scroller, selected ? moments.findIndex((item) => item.id === selected) : -1, rowHeight, HEADER_HEIGHT);
  const step = (id: string, move: StepMove) => {
    const index = moments.findIndex((item) => item.id === id);
    const next = moments[moveIndex(move, index, moments.length)];
    if (!next || next.id === id) return;
    // why: an end may be far outside the rendered window; selecting it scrolls it in (useRevealRow) before focus lands.
    const far = move === 'first' || move === 'last';
    if (selected || far) onSelect(next.id);
    const focus = () => document.getElementById(`moment-switch-${next.id}`)?.focus();
    requestAnimationFrame(() => requestAnimationFrame(focus));
  };
  return (
    <div ref={scroller} className="table-scroll pp-scroll" data-testid="performance-events">
      {moments.length === 0 ? (
        empty
      ) : (
        <div className="pp-table" role="table" aria-rowcount={moments.length + 1}>
          <div className="pp-row pp-head" role="row" aria-rowindex={1}>
            <span role="columnheader">{STRINGS.moment}</span>
            <span role="columnheader">{STRINGS.when}</span>
            <span role="columnheader" className="pp-took">
              {STRINGS.took}
            </span>
            <span role="columnheader" className="pp-budget">
              {STRINGS.budget}
            </span>
            <span role="columnheader" className="pp-why">
              {STRINGS.why}
            </span>
          </div>
          <div ref={body} role="rowgroup">
            <div aria-hidden="true" style={{ height: padTop }} />
            {moments.slice(start, end).map((item, offset) => (
              <MomentRow
                key={item.id}
                moment={item}
                rowIndex={start + offset + 2}
                selected={item.id === selected}
                why={[stepAt(steps, item.at)?.label, explain(item)].filter(Boolean).join(' · ')}
                onSelect={onSelect}
                onStep={step}
              />
            ))}
            <div aria-hidden="true" style={{ height: padBottom }} />
          </div>
        </div>
      )}
    </div>
  );
}

function MomentRow({
  moment,
  rowIndex,
  selected,
  why,
  onSelect,
  onStep,
}: {
  moment: Moment;
  rowIndex: number;
  selected: boolean;
  why: string;
  onSelect: (id?: string) => void;
  onStep: (id: string, move: StepMove) => void;
}) {
  const future = usePlayhead((time) => time < moment.at);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const move = KEY_MOVES[event.key];
    if (move) {
      event.preventDefault();
      event.stopPropagation();
      onStep(moment.id, move);
    } else if (event.key === 'Escape' && selected) {
      event.stopPropagation();
      onSelect();
    } else if (event.key === ' ') event.stopPropagation();
  };
  return (
    <div
      className="pp-row"
      role="row"
      aria-rowindex={rowIndex}
      data-performance-id={moment.id}
      data-verdict={moment.verdict}
      data-selected={selected || undefined}
      data-future={future || undefined}
    >
      <span role="cell" className="pp-moment">
        <button
          type="button"
          id={`moment-switch-${moment.id}`}
          aria-expanded={selected}
          aria-controls={selected ? MOMENT_DETAIL_ID : undefined}
          onClick={() => onSelect(selected ? undefined : moment.id)}
          onKeyDown={onKeyDown}
        >
          <span className="pp-dot" data-verdict={moment.verdict} aria-hidden="true" />
          {moment.label}
          <span className="visually-hidden">, {VERDICT_WORDS[moment.verdict]}</span>
        </button>
      </span>
      <span role="cell" className="pp-when">
        <SeekTime at={moment.at} future={future} />
      </span>
      <span role="cell" className="pp-took">
        {formatDuration(moment.value)}
      </span>
      <span role="cell" className="pp-budget">
        <BudgetBar moment={moment} />
      </span>
      <span role="cell" className="pp-why" title={why}>
        {why}
      </span>
    </div>
  );
}

/** A bullet graph: the value against the good and poor lines of its budget. */
export function BudgetBar({ moment }: { moment: Moment }) {
  const [good, poor] = moment.kind === 'task' ? BUDGETS.task : BUDGETS.interaction;
  const top = poor * TRACK_SPAN;
  return (
    <span className="pp-bar" title={STRINGS.budgetHint(good, poor)} aria-hidden="true">
      <span className="pp-bar-fill" data-verdict={moment.verdict} style={{ width: `${Math.min(100, (moment.value / top) * 100)}%` }} />
      <span className="pp-bar-tick" style={{ left: `${(good / top) * 100}%` }} />
      <span className="pp-bar-tick" style={{ left: `${(poor / top) * 100}%` }} />
    </span>
  );
}
