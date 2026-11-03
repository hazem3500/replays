import { useViewerPresenceMotion } from '../../hooks/use-viewer-presence-motion.ts';
import { use, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef } from 'react';

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
import { defaultNetworkColumns, networkColumns, type NetworkColumn } from './columns.ts';

export const REQUEST_DETAIL_ID = 'request-detail';

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
function useNetworkSurface() {
  usePluginSnapshot();
  const viewer = use(PluginContexts)?.('');
  const context: HostSurfaceContext = viewer ? { replay: viewer.replay, seek: viewer.seek } : {};
  const columns = networkColumns(context);
  const custom = !defaultNetworkColumns(columns);
  const columnStyle: CSSProperties | undefined = custom
    ? cssVars({ '--np-cols': columns.map((column) => column.width).join(' ') })
    : undefined;
  return { context, columns, custom, columnStyle };
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
  rows,
  steps,
  ceiling,
  selected,
  onSelect,
  onHover,
  empty,
}: {
  rows: readonly NetworkRow[];
  steps: readonly ReplayStep[];
  /** The slowest measured request: the top of every duration bar's log scale. */
  ceiling: number;
  selected: string | undefined;
  onSelect: (id?: string) => void;
  /** The request under the pointer or focus, so the time ribbon can light its mark; undefined when it leaves. */
  onHover?: ((id?: string) => void) | undefined;
  empty: ReactNode;
}) {
  const { context, columns, custom, columnStyle } = useNetworkSurface();
  const player = usePlayer();
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useViewerPresenceMotion(body, 'rows', rows.length > 0);
  const ats = rows.map((row) => row.at);
  const reached = usePlayhead((time) => countAtOrBefore(ats, playheadHorizon(time, player.duration)));
  const rowHeight = useRowHeight(body, ROW_SELECTOR, rows.length > 0, FALLBACK_ROW_HEIGHT);
  const { start, end, padTop, padBottom } = useWindowedRows(scroller, { count: rows.length, rowHeight, headerHeight: HEADER_HEIGHT });
  const selectedIndex = selected ? rows.findIndex((row) => row.id === selected) : -1;
  useRevealRow(scroller, selectedIndex, rowHeight, HEADER_HEIGHT);
  const step = (id: string, move: StepMove) => stepRequest(rows, id, move, { selected, onSelect });
  return (
    <TrackList
      testId="network-list"
      reached={reached}
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
          style={columnStyle}
        >
          <ListHead columns={columns} />
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
                position={{ rowIndex: start + offset + 2, future: start + offset >= reached, selected: row.id === selected }}
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

function ListHead({ columns }: { columns: readonly NetworkColumn[] }) {
  return (
    <div className="np-row np-head" role="row" aria-rowindex={1}>
      {columns.map((column) => (
        <span
          role="columnheader"
          key={column.id}
          data-slot-item={column.id}
          className={column.key === 'during' ? 'np-step' : `np-${column.key ?? 'extension'}`}
          title={column.key === 'duration' ? STRINGS.durationHint : undefined}
        >
          {column.label}
        </span>
      ))}
    </div>
  );
}

function RequestRow({
  row,
  position,
  step,
  ceiling,
  onSelect,
  onStep,
  surface,
}: {
  row: NetworkRow;
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
      <button
        type="button"
        id={`request-switch-${row.id}`}
        data-request-id={row.id}
        aria-expanded={selected}
        aria-controls={selected ? REQUEST_DETAIL_ID : undefined}
        onClick={() => onSelect(selected ? undefined : row.id)}
        onKeyDown={onKeyDown}
      >
        <span className="method">{row.entry.method}</span>
        <span className="np-name" title={row.entry.url}>
          <span className="np-path">{row.name.path}</span>
          {row.name.query ? <span className="np-query">{row.name.query}</span> : null}
          {row.name.host ? <span className="np-host">{row.name.host}</span> : null}
        </span>
      </button>
    ),
  };
  return (
    <div
      className="np-row"
      data-row-id={row.id}
      role="row"
      aria-rowindex={rowIndex}
      data-selected={selected || undefined}
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
