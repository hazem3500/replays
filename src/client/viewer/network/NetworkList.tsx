import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef } from 'react';

import type { ReplayStep } from '../../../shared/replay.ts';
import { useRevealRow } from '../../hooks/use-reveal-row.ts';
import { useRowHeight } from '../../hooks/use-row-height.ts';
import { usePlayer, usePlayhead } from '../../player.ts';
import { countAtOrBefore } from '../../timeline.ts';
import { useWindowedRows } from '../../windowing.ts';
import { HEADER_HEIGHT, SeekTime, TrackList } from '../TrackList.tsx';
import { durationShare, formatDuration, type NetworkRow, playheadHorizon, stepAt } from './model.ts';
import { KEY_MOVES, moveIndex, type StepMove } from '../list-keys.ts';

export const REQUEST_DETAIL_ID = 'request-detail';

const STRINGS = {
  time: 'Time',
  request: 'Request',
  status: 'Status',
  duration: 'Duration',
  during: 'During',
  durationHint: 'Bars use a log scale: each step along the bar is ten times longer',
  noResponse: 'None',
  noResponseHint: 'No response recorded: a redirect hop, or still in flight when capture stopped',
  error: 'Error',
  unknown: 'Unknown',
};

const ROW_SELECTOR = '.np-row:not(.np-head)';

const FALLBACK_ROW_HEIGHT = 30;

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
  empty,
}: {
  rows: readonly NetworkRow[];
  steps: readonly ReplayStep[];
  /** The slowest measured request: the top of every duration bar's log scale. */
  ceiling: number;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  empty: ReactNode;
}) {
  const player = usePlayer();
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const ats = rows.map((row) => row.at);
  const reached = usePlayhead((time) => countAtOrBefore(ats, playheadHorizon(time, player.duration)));
  const rowHeight = useRowHeight(body, ROW_SELECTOR, rows.length > 0, FALLBACK_ROW_HEIGHT);
  const { start, end, padTop, padBottom } = useWindowedRows(scroller, { count: rows.length, rowHeight, headerHeight: HEADER_HEIGHT });
  const selectedIndex = selected ? rows.findIndex((row) => row.id === selected) : -1;
  useRevealRow(scroller, selectedIndex, rowHeight, HEADER_HEIGHT);
  const step = (id: string, move: StepMove) => {
    const index = rows.findIndex((row) => row.id === id);
    const next = rows[moveIndex(move, index, rows.length)];
    if (!next || next.id === id) return;
    // why: an end may be far outside the rendered window; selecting it scrolls it in (useRevealRow) before focus lands.
    const far = move === 'first' || move === 'last';
    if (selected || far) onSelect(next.id);
    const focus = () => document.getElementById(`request-switch-${next.id}`)?.focus();
    requestAnimationFrame(() => requestAnimationFrame(focus));
  };
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
        <div className="np-table" role="table" aria-rowcount={rows.length + 1}>
          <ListHead />
          <div ref={body} role="rowgroup">
            <div aria-hidden="true" style={{ height: padTop }} />
            {rows.slice(start, end).map((row, offset) => (
              <RequestRow
                key={row.id}
                row={row}
                rowIndex={start + offset + 2}
                future={start + offset >= reached}
                selected={row.id === selected}
                step={stepAt(steps, row.at)}
                ceiling={ceiling}
                onSelect={onSelect}
                onStep={step}
              />
            ))}
            <div aria-hidden="true" style={{ height: padBottom }} />
          </div>
        </div>
      )}
    </TrackList>
  );
}

function ListHead() {
  return (
    <div className="np-row np-head" role="row" aria-rowindex={1}>
      <span role="columnheader">{STRINGS.time}</span>
      <span role="columnheader">{STRINGS.request}</span>
      <span role="columnheader">{STRINGS.status}</span>
      <span role="columnheader" className="np-duration" title={STRINGS.durationHint}>
        {STRINGS.duration}
      </span>
      <span role="columnheader" className="np-step">
        {STRINGS.during}
      </span>
    </div>
  );
}

function RequestRow({
  row,
  rowIndex,
  future,
  selected,
  step,
  ceiling,
  onSelect,
  onStep,
}: {
  row: NetworkRow;
  rowIndex: number;
  future: boolean;
  selected: boolean;
  step: ReplayStep | undefined;
  ceiling: number;
  onSelect: (id: string | undefined) => void;
  onStep: (id: string, move: StepMove) => void;
}) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const move = KEY_MOVES[event.key];
    if (move) {
      event.preventDefault();
      event.stopPropagation();
      onStep(row.id, move);
    } else if (event.key === 'Escape' && selected) {
      event.stopPropagation();
      onSelect(undefined);
    } else if (event.key === ' ') event.stopPropagation();
  };
  return (
    <div
      className="np-row"
      role="row"
      aria-rowindex={rowIndex}
      data-selected={selected || undefined}
      data-failed={row.failed || undefined}
      data-pending={row.pending || undefined}
      data-future={future || undefined}
    >
      <span role="cell" className="np-time">
        <SeekTime at={row.at} future={future} />
      </span>
      <span role="cell" className="np-request">
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
      </span>
      <span role="cell" className="np-status">
        <StatusText row={row} />
      </span>
      <span role="cell" className="np-duration">
        <DurationBar row={row} ceiling={ceiling} />
      </span>
      <span role="cell" className="np-step" title={step?.label}>
        {step?.label}
      </span>
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

function DurationBar({ row, ceiling }: { row: NetworkRow; ceiling: number }) {
  const tone = row.failed ? 'bad' : row.slow ? 'slow' : undefined;
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
