import { createSortedRowModel, rowSortingFeature, sortFn_basic, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

import { BUDGET_FOR_KIND, DEFAULT_BUDGETS, severity } from '../../../shared/diagnostics/budgets.ts';
import { ms } from '../../../shared/diagnostics/detect.ts';
import { formatClock } from '../../../shared/replay.ts';
import type { InspectorPerformanceRow } from '../../data/inspector.ts';
import { useRevealIndex } from '../../hooks/use-reveal-index.ts';
import { useVirtualRows } from '../../hooks/use-virtual-rows.ts';
import { usePlayer, usePlayhead } from '../../player.ts';
import { countAtOrBefore } from '../../timeline.ts';
import { BudgetBar } from './BudgetBar.tsx';
import { VERDICT_WORD } from './VitalsStrip.tsx';

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { basic: sortFn_basic } });

export type PerformanceOrder = 'worst' | 'time';

const STRINGS = {
  table: 'Performance events',
  verdict: 'Verdict',
  event: 'Event',
  when: 'When',
  value: 'Value',
  budget: 'Budget',
  order: 'Order',
  worst: 'Worst first',
  time: 'Timeline',
  upcoming: 'Upcoming',
  seek: (at: number) => `Jump to ${formatClock(at)}`,
  names: {
    'long-task': 'Long task',
    'slow-interaction': 'Slow interaction',
    'largest-contentful-paint': 'Largest contentful paint',
    'first-contentful-paint': 'First contentful paint',
  },
  unknown: 'Unknown',
};

const RANK = { poor: 0, 'needs-improvement': 1, good: 2 } as const;

export function eventName(row: InspectorPerformanceRow) {
  return `${STRINGS.names[row.performanceKind]}${row.entry.eventType ? ` · ${row.entry.eventType}` : ''}`;
}

/** Worst first sorts by verdict, then by how far toward Poor; a missing verdict sinks to the end. */
const worstKey = (row: InspectorPerformanceRow) =>
  (row.verdict ? RANK[row.verdict] : 3) * 10 - severity(row.entry.value, DEFAULT_BUDGETS[BUDGET_FOR_KIND[row.performanceKind]]);

const definitions: ColumnDef<typeof features, InspectorPerformanceRow>[] = [
  { id: 'worst', accessorFn: worstKey, sortFn: 'basic' },
  { id: 'time', accessorFn: (row) => row.at, sortFn: 'basic' },
];

/** Events as a virtualised list; TanStack Table owns the two orders (worst first, timeline). */
export function PerformanceTable({
  rows,
  order,
  onOrder,
  rowHeight,
  selected,
  onSelect,
  onClose,
  empty,
}: {
  rows: readonly InspectorPerformanceRow[];
  order: PerformanceOrder;
  onOrder: (order: PerformanceOrder) => void;
  rowHeight: number;
  selected: string | undefined;
  onSelect: (row: InspectorPerformanceRow) => void;
  onClose: () => void;
  empty?: ReactNode;
}) {
  const player = usePlayer();
  const table = useTable({
    features,
    columns: definitions,
    data: rows as InspectorPerformanceRow[],
    state: { sorting: [{ id: order, desc: false }] },
    getRowId: (row) => row.id,
  });
  const ordered = table.getRowModel().rows.map((row) => row.original);
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualRows(
    scroller,
    ordered.map((row) => row.id),
    rowHeight,
  );
  const ats = rows.map((row) => row.at).toSorted((a, b) => a - b);
  const reached = usePlayhead((time) => countAtOrBefore(ats, time >= player.duration ? Infinity : time <= 0 ? -1 : time));
  const horizon = reached > 0 ? ats[reached - 1]! : -Infinity;
  const selectedIndex = selected ? ordered.findIndex((row) => row.id === selected) : -1;
  useRevealIndex(selectedIndex, virtual.scrollToIndex);

  const onKey = (index: number, event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && selected) {
      event.stopPropagation();
      onClose();
      return;
    }
    const target =
      event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'ArrowUp'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? ordered.length - 1
              : event.key === 'Enter' || event.key === ' '
                ? index
                : undefined;
    const next = target === undefined ? undefined : ordered[Math.max(0, Math.min(ordered.length - 1, target))];
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(next);
    requestAnimationFrame(() =>
      scroller.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(next.id)}"]`)?.focus({ preventScroll: true }),
    );
  };

  return (
    <div
      className="perf-grid"
      role="grid"
      aria-label={STRINGS.table}
      aria-rowcount={ordered.length + 1}
      style={{ '--row-height': `${rowHeight}px` } as CSSProperties}
    >
      <div className="perf-row perf-head" role="row" aria-rowindex={1}>
        <span role="columnheader">
          <span className="visually-hidden">{STRINGS.verdict}</span>
        </span>
        <span role="columnheader">{STRINGS.event}</span>
        <span role="columnheader">{STRINGS.when}</span>
        <span role="columnheader" data-align="end">
          {STRINGS.value}
        </span>
        <span role="columnheader" className="perf-head-budget">
          {STRINGS.budget}
          <span className="perf-order" role="group" aria-label={STRINGS.order}>
            {(['worst', 'time'] as const).map((id) => (
              <button key={id} type="button" aria-pressed={order === id} onClick={() => onOrder(id)}>
                {STRINGS[id]}
              </button>
            ))}
          </span>
        </span>
      </div>
      <div ref={scroller} className="perf-scroller" role="rowgroup" data-testid="performance-events">
        {ordered.length === 0 ? (
          empty
        ) : (
          <div className="perf-body" style={{ height: virtual.totalSize }}>
            {virtual.items.map((item) => {
              const row = ordered[item.index]!;
              const future = row.at > horizon;
              const budget = DEFAULT_BUDGETS[BUDGET_FOR_KIND[row.performanceKind]];
              return (
                <div
                  key={item.key}
                  className="perf-row"
                  role="row"
                  aria-rowindex={item.index + 2}
                  aria-selected={row.id === selected}
                  tabIndex={item.index === Math.max(0, selectedIndex) ? 0 : -1}
                  data-row-id={row.id}
                  data-future={future || undefined}
                  style={{ '--row-offset': `${item.start}px` } as CSSProperties}
                  onClick={() => onSelect(row)}
                  onKeyDown={(event) => onKey(item.index, event)}
                >
                  <span role="gridcell">
                    <span
                      className="perf-dot"
                      data-verdict={row.verdict}
                      role="img"
                      aria-label={row.verdict ? VERDICT_WORD[row.verdict] : STRINGS.unknown}
                    />
                  </span>
                  <span role="gridcell" className="perf-name">
                    {eventName(row)}
                    {future ? <span className="visually-hidden"> · {STRINGS.upcoming}</span> : null}
                  </span>
                  <span role="gridcell">
                    <button
                      type="button"
                      className="perf-when"
                      aria-label={STRINGS.seek(row.at)}
                      onClick={(event) => (event.stopPropagation(), player.seek(row.at))}
                    >
                      {formatClock(row.at)}
                    </button>
                  </span>
                  <span role="gridcell" className="perf-value" data-align="end">
                    {ms(row.entry.value)}
                  </span>
                  <span role="gridcell">
                    {row.verdict ? <BudgetBar value={row.entry.value} budget={budget} verdict={row.verdict} /> : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
