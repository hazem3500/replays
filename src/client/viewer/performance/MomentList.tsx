import { useViewerPresenceMotion } from '../../hooks/use-viewer-presence-motion.ts';
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useContext, useRef } from 'react';

import type { ReplayStep } from '../../../shared/replay.ts';
import { useRevealRow } from '../../hooks/use-reveal-row.ts';
import { useRowHeight } from '../../hooks/use-row-height.ts';
import { usePlayhead } from '../../player.ts';
import { useWindowedRows } from '../../windowing.ts';
import { formatDuration, stepAt, stepName } from '../network/model.ts';
import { HEADER_HEIGHT, SeekTime } from '../TrackList.tsx';
import { BUDGETS, type Moment, type MomentOrder, VERDICT_WORDS } from './model.ts';
import { KEY_MOVES, moveIndex, rowIdOf, type StepMove } from '../list-keys.ts';
import { ListSpacer } from '../ListSpacer.tsx';
import { ViewerContext } from '../context.ts';
import { FocusMark } from '../FocusMark.tsx';

export const MOMENT_DETAIL_ID = 'performance-detail';

const STRINGS = {
  moment: 'Moment',
  when: 'When',
  took: 'Took',
  budget: 'Against budget',
  why: 'During, and what it waited on',
  orderWorst: 'Worst first',
  orderTime: 'In order',
  sortBy: (column: string) => `Sort by ${column.toLowerCase()}`,
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
  hovered,
  order,
  onOrder,
  onSelect,
  onHover,
  empty,
}: {
  moments: readonly Moment[];
  steps: readonly ReplayStep[];
  explain: (moment: Moment) => string;
  selected: string | undefined;
  /** Moments lit from the timeline: their rows are raised. */
  hovered: readonly string[];
  /** The order the rows are in; the When and Took headers switch it. */
  order: MomentOrder;
  onOrder: (order: MomentOrder) => void;
  onSelect: (id?: string) => void;
  /** The moment under the pointer or focus, so the time ribbon can light its range; undefined when it leaves. */
  onHover?: ((id?: string) => void) | undefined;
  empty: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useViewerPresenceMotion(body, 'rows', moments.length > 0);
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
          <MomentHead count={moments.length} order={order} onOrder={onOrder} />
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: delegated hover and focus only light the row's mark on the time ribbon; every row keeps its own button. */}
          <div
            ref={body}
            role="rowgroup"
            onPointerOver={(event) => onHover?.(rowIdOf(event.target))}
            onPointerLeave={() => onHover?.()}
            onFocus={(event) => onHover?.(rowIdOf(event.target))}
            onBlur={() => onHover?.()}
          >
            <ListSpacer height={padTop} />
            {moments.slice(start, end).map((item, offset) => (
              <MomentRow
                key={item.id}
                moment={item}
                rowIndex={start + offset + 2}
                selected={item.id === selected}
                lit={hovered.includes(item.id)}
                why={[stepName(stepAt(steps, item.at)?.label ?? ''), explain(item)].filter(Boolean).join(' · ')}
                onSelect={onSelect}
                onStep={step}
              />
            ))}
            <ListSpacer height={padBottom} />
          </div>
        </div>
      )}
    </div>
  );
}

function MomentHead({ count, order, onOrder }: { count: number; order: MomentOrder; onOrder: (order: MomentOrder) => void }) {
  return (
    <div className="pp-row pp-head" role="row" aria-rowindex={1}>
      <span role="columnheader">{STRINGS.moment}</span>
      <SortHeader
        label={STRINGS.when}
        active={order === 'time'}
        direction="ascending"
        sortable={count > 1}
        onSort={() => onOrder('time')}
      />
      <SortHeader
        label={STRINGS.took}
        className="pp-took"
        active={order === 'worst'}
        direction="descending"
        sortable={count > 1}
        onSort={() => onOrder('worst')}
      />
      <span role="columnheader" className="pp-budget">
        {STRINGS.budget}
      </span>
      <span role="columnheader" className="pp-why">
        {STRINGS.why}
      </span>
      {count > 1 ? (
        <span role="columnheader" className="pp-sort-phone">
          <button type="button" className="pp-sort" data-active="" onClick={() => onOrder(order === 'worst' ? 'time' : 'worst')}>
            {order === 'worst' ? STRINGS.orderWorst : STRINGS.orderTime}
          </button>
        </span>
      ) : null}
    </div>
  );
}

function MomentRow({
  moment,
  rowIndex,
  selected,
  lit,
  why,
  onSelect,
  onStep,
}: {
  moment: Moment;
  rowIndex: number;
  selected: boolean;
  lit: boolean;
  why: string;
  onSelect: (id?: string) => void;
  onStep: (id: string, move: StepMove) => void;
}) {
  const future = usePlayhead((time) => time < moment.at);
  const focus = useContext(ViewerContext)?.focus;
  const marker = focus?.has.performance ? focus.performance(moment) : undefined;
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
      data-row-id={moment.id}
      data-verdict={moment.verdict}
      data-focus={marker ? '' : undefined}
      data-selected={selected || undefined}
      data-lit={lit || undefined}
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
          {marker ? <FocusMark marker={marker} /> : null}
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

function SortHeader({
  label,
  active,
  direction,
  sortable,
  className,
  onSort,
}: {
  label: string;
  active: boolean;
  direction: 'ascending' | 'descending';
  sortable: boolean;
  className?: string;
  onSort: () => void;
}) {
  return (
    <span role="columnheader" className={className} aria-sort={active ? direction : undefined}>
      {sortable ? (
        <button
          type="button"
          className="pp-sort"
          data-active={active || undefined}
          data-direction={direction}
          aria-label={STRINGS.sortBy(label)}
          onClick={onSort}
        >
          {label}
        </button>
      ) : (
        label
      )}
    </span>
  );
}

/** A bullet graph: the value against the good and poor lines of its budget. */
function BudgetBar({ moment }: { moment: Moment }) {
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
