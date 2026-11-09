import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import type { NetworkSort } from './sort.ts';
import { useViewerPresenceMotion } from '../../hooks/use-viewer-presence-motion.ts';
import {
  use,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useRef,
  useState,
} from 'react';

import type { ReplayStep } from '../../../shared/replay.ts';
import { useRevealRow } from '../../hooks/use-reveal-row.ts';
import { useRowHeight } from '../../hooks/use-row-height.ts';
import { usePlayer, usePlayhead } from '../../player.ts';
import { countAtOrBefore } from '../../timeline.ts';
import { useWindowedRows } from '../../windowing.ts';
import { HEADER_HEIGHT, SeekTime, TrackList } from '../TrackList.tsx';
import { durationShare, formatDuration, type NetworkRow, playheadHorizon, stepAt } from './model.ts';
import { KEY_MOVES, moveIndex, rowIdOf, type StepMove } from '../list-keys.ts';
import { ListSpacer } from '../ListSpacer.tsx';
import { cssVars } from '../../lib/css-vars.ts';
import { PluginContexts, PluginMount, usePluginSnapshot } from '../../plugins/PluginUi.tsx';
import type { HostSurfaceContext } from '../../plugins/surface-contracts.ts';
import { COLUMN_LIMITS, type ColumnWidths, columnTemplate, type ResizableColumn, resizeColumn } from './column-widths.ts';
import { defaultNetworkColumns, networkColumns, type NetworkColumn } from './columns.ts';

export const REQUEST_DETAIL_ID = 'request-detail';
const DEFAULT_SORT: NetworkSort = { key: 'time', direction: 'ascending' };
const ignoreSort = () => {};

const STRINGS = {
  durationHint: 'Bars use a log scale: each step along the bar is ten times longer',
  noResponse: 'None',
  noResponseHint: 'No response recorded: a redirect hop, or still in flight when capture stopped',
  error: 'Error',
  unknown: 'Unknown',
};

const ROW_SELECTOR = '.np-row:not(.np-head)';

const FALLBACK_ROW_HEIGHT = 30;

/** The network columns for this viewer, with plugins' columns, and the grid template they need when customised. */
function useNetworkSurface(widths: ColumnWidths) {
  usePluginSnapshot();
  const viewer = use(PluginContexts)?.('');
  const context: HostSurfaceContext = viewer ? { replay: viewer.replay, seek: viewer.seek.bind(viewer) } : {};
  const columns = networkColumns(context);
  const custom = !defaultNetworkColumns(columns);
  const resized = !custom && Object.keys(widths).length > 0;
  let columnStyle: CSSProperties | undefined;
  if (custom) columnStyle = cssVars({ '--np-cols': columns.map((column) => column.width).join(' ') });
  else if (resized) columnStyle = cssVars({ '--np-user-cols': columnTemplate(widths) });
  return { context, columns, custom, resized, columnStyle };
}

/** Moves keyboard focus to the next request, selecting it too when one is already open or the move jumps to an end. */
function stepRequest(
  rows: readonly NetworkRow[],
  id: string,
  move: StepMove,
  { selected, onSelect }: { selected: string | undefined; onSelect: (id?: string) => void },
) {
  const index = rows.findIndex((row) => row.id === id);
  const next = rows[moveIndex(move, index, rows.length)];
  if (!next || next.id === id) return;
  // why: an end may be far outside the rendered window; selecting it scrolls it in (useRevealRow) before focus lands.
  const far = move === 'first' || move === 'last';
  if (selected || far) onSelect(next.id);
  const focus = () => document.getElementById(`request-switch-${next.id}`)?.focus();
  requestAnimationFrame(() => requestAnimationFrame(focus));
}

/** A request button's keys: arrows and Home/End step through requests, Escape closes the open one. */
function requestKey(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  {
    id,
    selected,
    onStep,
    onSelect,
  }: { id: string; selected: boolean; onStep: (id: string, move: StepMove) => void; onSelect: (id?: string) => void },
) {
  if (event.altKey || event.metaKey || event.ctrlKey) return;
  const move = KEY_MOVES[event.key];
  if (move) {
    event.preventDefault();
    event.stopPropagation();
    onStep(id, move);
  } else if (event.key === 'Escape' && selected) {
    event.stopPropagation();
    onSelect();
  } else if (event.key === ' ') event.stopPropagation();
}

/**
 * Every request in start order on the shared list frame (TrackList: the now divider, follow and Back to now). Rows are
 * one line on a panel wide enough, two lines on a phone (CSS container query); the request's step is the "why".
 */
export function NetworkList({
  sort = DEFAULT_SORT,
  onSort = ignoreSort,
  rows,
  steps,
  ceiling,
  selected,
  onSelect,
  onHover,
  highlight,
  empty,
}: {
  rows: readonly NetworkRow[];
  sort?: NetworkSort;
  onSort?: (sort: NetworkSort) => void;
  steps: readonly ReplayStep[];
  /** The slowest measured request: the top of every duration bar's log scale. */
  ceiling: number;
  selected: string | undefined;
  onSelect: (id?: string) => void;
  /** The request under the pointer or focus, so the time ribbon can light its mark; undefined when it leaves. */
  onHover?: ((id?: string) => void) | undefined;
  highlight?: string | undefined;
  empty: ReactNode;
}) {
  const [widths, setWidths] = useState<ColumnWidths>({});
  const { context, columns, custom, resized, columnStyle } = useNetworkSurface(widths);
  const player = usePlayer();
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useViewerPresenceMotion(body, 'rows', rows.length > 0);
  const chronological = sort.key === 'time' && sort.direction === 'ascending';
  const horizon = usePlayhead((time) => playheadHorizon(time, player.duration));
  const ats = rows.map((row) => row.at).sort((a, b) => a - b);
  const reached = countAtOrBefore(ats, horizon);
  const latestAt = reached > 0 ? ats[reached - 1] : undefined;
  const followIndex = latestAt === undefined ? 0 : rows.findIndex((row) => row.at === latestAt) + 1;
  const rowHeight = useRowHeight(body, ROW_SELECTOR, rows.length > 0, FALLBACK_ROW_HEIGHT);
  const { start, end, padTop, padBottom } = useWindowedRows(scroller, { count: rows.length, rowHeight, headerHeight: HEADER_HEIGHT });
  const selectedIndex = selected ? rows.findIndex((row) => row.id === selected) : -1;
  useRevealRow(scroller, selectedIndex, rowHeight, HEADER_HEIGHT);
  const step = (id: string, move: StepMove) => stepRequest(rows, id, move, { selected, onSelect });
  return (
    <TrackList
      testId="network-list"
      reached={chronological ? reached : followIndex}
      chronological={chronological}
      total={rows.length}
      rowHeight={rowHeight}
      extraIndex={selectedIndex}
      ats={ats}
      scroller={scroller}
    >
      {rows.length === 0 ? (
        empty
      ) : (
        <div
          className="np-table"
          role="table"
          aria-rowcount={rows.length + 1}
          data-slot="inspector.network.columns"
          data-custom-columns={custom || undefined}
          data-resized={resized || undefined}
          style={columnStyle}
        >
          <ListHead
            columns={columns}
            sort={sort}
            onSort={onSort}
            widths={widths}
            onResize={custom ? undefined : (key, delta) => setWidths((current) => resizeColumn(current, key, delta))}
          />
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
            {rows.slice(start, end).map((row, offset) => (
              <RequestRow
                key={row.id}
                row={row}
                highlighted={row.id === highlight}
                position={{ rowIndex: start + offset + 2, future: row.at > horizon, selected: row.id === selected }}
                step={stepAt(steps, row.at)}
                ceiling={ceiling}
                onSelect={onSelect}
                onStep={step}
                surface={{ columns, context }}
              />
            ))}
            <ListSpacer height={padBottom} />
          </div>
        </div>
      )}
    </TrackList>
  );
}

function ListHead({
  columns,
  sort,
  onSort,
  widths,
  onResize,
}: {
  columns: readonly NetworkColumn[];
  sort: NetworkSort;
  onSort: (sort: NetworkSort) => void;
  widths: ColumnWidths;
  onResize: ((key: ResizableColumn, delta: number) => void) | undefined;
}) {
  return (
    <div className="np-row np-head" role="row" aria-rowindex={1}>
      {columns.map((column) => (
        <span
          role="columnheader"
          aria-sort={column.key === sort.key ? sort.direction : undefined}
          key={column.id}
          data-slot-item={column.id}
          className={column.key === 'during' ? 'np-step' : `np-${column.key ?? 'extension'}`}
          title={column.key === 'duration' ? STRINGS.durationHint : undefined}
        >
          {column.key ? (
            <button
              type="button"
              className="np-sort"
              onClick={() => {
                if (!column.key) return;
                onSort({
                  key: column.key,
                  direction: column.key === sort.key && sort.direction === 'ascending' ? 'descending' : 'ascending',
                });
              }}
            >
              {column.label}
              {column.key === sort.key ? <AnimatedIcon name={sort.direction === 'ascending' ? 'chevron-up' : 'chevron-down'} /> : null}
            </button>
          ) : (
            column.label
          )}
          {onResize && column.key && column.key !== 'request' ? <ColumnGrip column={column.key} widths={widths} onResize={onResize} /> : null}
        </span>
      ))}
    </div>
  );
}

const GRIP_STEP = 8;

/**
 * A drag handle on the edge of a fixed column that faces Request, which absorbs the change: Time's right edge, the
 * others' left. Dragging toward Request widens the column; arrow keys move it by GRIP_STEP.
 */
function ColumnGrip({
  column,
  widths,
  onResize,
}: {
  column: ResizableColumn;
  widths: ColumnWidths;
  onResize: (key: ResizableColumn, delta: number) => void;
}) {
  const sign = column === 'time' ? 1 : -1;
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const width = widths[column] ?? COLUMN_LIMITS[column].initial;
  const move = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    onResize(column, drag.current.width - width + sign * (event.clientX - drag.current.x));
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- why: a focusable separator is the WAI-ARIA window splitter pattern.
    <span
      className="np-grip"
      data-side={sign > 0 ? 'end' : 'start'}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${column} column`}
      aria-valuenow={width}
      aria-valuemin={COLUMN_LIMITS[column].min}
      aria-valuemax={COLUMN_LIMITS[column].max}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = undefined;
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        onResize(column, (event.key === 'ArrowRight' ? 1 : -1) * sign * GRIP_STEP);
      }}
    />
  );
}

function RequestRow({
  row,
  highlighted,
  position,
  step,
  ceiling,
  onSelect,
  onStep,
  surface,
}: {
  row: NetworkRow;
  highlighted: boolean;
  position: { rowIndex: number; future: boolean; selected: boolean };
  step: ReplayStep | undefined;
  ceiling: number;
  onSelect: (id?: string) => void;
  onStep: (id: string, move: StepMove) => void;
  surface: { columns: readonly NetworkColumn[]; context: HostSurfaceContext };
}) {
  const { rowIndex, future, selected } = position;
  const { columns, context } = surface;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => requestKey(event, { id: row.id, selected, onStep, onSelect });
  const cells: Record<string, ReactNode> = {
    time: <SeekTime at={row.at} future={future} />,
    status: <StatusText row={row} />,
    duration: <DurationBar row={row} ceiling={ceiling} />,
    during: step?.label,
    request: (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              id={`request-switch-${row.id}`}
              data-request-id={row.id}
              aria-label={`${row.entry.method} ${row.entry.url}`}
              aria-expanded={selected}
              aria-controls={selected ? REQUEST_DETAIL_ID : undefined}
              onClick={() => onSelect(selected ? undefined : row.id)}
              onKeyDown={onKeyDown}
            />
          }
        >
          <span className="method">{row.entry.method}</span>
          <span className="np-name" title={row.entry.url}>
            <span className="np-path">{row.name.path}</span>
            {row.name.query ? <span className="np-query">{row.name.query}</span> : null}
            {row.name.host ? <span className="np-host">{row.name.host}</span> : null}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-96 break-all">{row.entry.url}</TooltipContent>
      </Tooltip>
    ),
  };
  return (
    <div
      className="np-row"
      data-row-id={row.id}
      role="row"
      aria-rowindex={rowIndex}
      data-selected={selected || undefined}
      data-highlighted={highlighted || undefined}
      data-failed={row.failed || undefined}
      data-pending={row.pending || undefined}
      data-future={future || undefined}
    >
      {columns.map((column) => (
        <span
          role="cell"
          key={column.id}
          data-slot-item={column.id}
          className={column.key === 'during' ? 'np-step' : `np-${column.key ?? 'extension'}`}
          title={column.key === 'during' ? step?.label : undefined}
        >
          {column.key
            ? cells[column.key]
            : column.render && (
                <PluginMount inline render={column.render} context={{ ...context, request: row.entry }} label={column.label} />
              )}
        </span>
      ))}
    </div>
  );
}

export function StatusText({ row }: { row: NetworkRow }) {
  if (row.pending)
    return (
      <span className="np-code" data-tone="none" title={STRINGS.noResponseHint}>
        {STRINGS.noResponse}
      </span>
    );
  return (
    <span className="np-code" data-tone={row.failed ? 'bad' : undefined} title={row.entry.statusText || undefined}>
      {row.entry.status || STRINGS.error}
    </span>
  );
}

function durationTone(row: NetworkRow) {
  if (row.failed) return 'bad';
  return row.slow ? 'slow' : undefined;
}

function DurationBar({ row, ceiling }: { row: NetworkRow; ceiling: number }) {
  const tone = durationTone(row);
  return (
    <>
      <span className="np-ms" data-tone={tone}>
        {row.measured === undefined ? STRINGS.unknown : formatDuration(row.measured)}
      </span>
      <span className="np-bar" aria-hidden="true">
        <span data-tone={tone} style={{ width: `${durationShare(row.measured, ceiling) * 100}%` }} />
      </span>
    </>
  );
}
