import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef } from 'react';

import type { ReplayStep } from '../../../shared/replay.ts';
import { useNarrowerThan } from '../../hooks/use-narrower-than.ts';
import { useRevealRow } from '../../hooks/use-reveal-row.ts';
import { useRowHeight } from '../../hooks/use-row-height.ts';
import { usePlayer, usePlayhead } from '../../player.ts';
import { countAtOrBefore } from '../../timeline.ts';
import { useWindowedRows } from '../../windowing.ts';
import { HEADER_HEIGHT, SeekTime, TrackList } from '../TrackList.tsx';
import { durationShare, formatDuration, type NetworkRow, playheadHorizon, stepAt } from './model.ts';
import { KEY_MOVES, moveIndex, rowIdOf, type StepMove } from '../list-keys.ts';

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
/** Narrower than this (network.css's phone query), rows are two lines and the list has no column header. */
const COMPACT_WIDTH = 560;

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
  const player = usePlayer();
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const ats = rows.map((row) => row.at);
  const reached = usePlayhead((time) => countAtOrBefore(ats, playheadHorizon(time, player.duration)));
  // why: a phone-width list has no column header; the rows say what they are, and the header's 28 px go to rows.
  const compact = useNarrowerThan(scroller, COMPACT_WIDTH);
  const header = compact ? 0 : HEADER_HEIGHT;
  const rowHeight = useRowHeight(body, ROW_SELECTOR, rows.length > 0, FALLBACK_ROW_HEIGHT);
  const { start, end, padTop, padBottom } = useWindowedRows(scroller, { count: rows.length, rowHeight, headerHeight: header });
  const selectedIndex = selected ? rows.findIndex((row) => row.id === selected) : -1;
  useRevealRow(scroller, selectedIndex, rowHeight, header);
  const step = (id: string, move: StepMove) => {
    const index = rows.findIndex((row) => row.id === id);
    const next = rows[moveIndex(move, index, rows.length)];
    if (!next || next.id === id) return;
    // why: an end may be far outside the rendered window; selecting it scrolls it in (useRevealRow) before focus lands.
    const far = move === 'first' || move === 'last';
    const selecting = Boolean(selected) || far;
    if (selecting) onSelect(next.id);
    // why: a selection glides into view (useRevealRow); focus's own instant scroll would cut that glide short.
    const focus = () => document.getElementById(`request-switch-${next.id}`)?.focus({ preventScroll: selecting });
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
      headerHeight={header}
    >
      {rows.length === 0 ? (
        empty
      ) : (
        <div className="np-table" role="table" aria-rowcount={rows.length + 1}>
          {compact ? null : <ListHead />}
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: delegated hover and focus only light the row's mark on the time ribbon; every row keeps its own button. */}
          <div
            ref={body}
            role="rowgroup"
            onPointerOver={(event) => onHover?.(rowIdOf(event.target))}
            onPointerLeave={() => onHover?.()}
            onFocus={(event) => onHover?.(rowIdOf(event.target))}
            onBlur={() => onHover?.()}
          >
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
  onSelect: (id?: string) => void;
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
      onSelect();
    } else if (event.key === ' ') event.stopPropagation();
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
      data-slow={row.slow || undefined}
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
          {row.entry.method === 'GET' ? (
            <span className="visually-hidden">GET </span>
          ) : (
            <span className="np-method">{row.entry.method}</span>
          )}
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

/**
 * The status as one signal: a failure is a red pill (the code, or Error for a network error), no response a muted
 * word, and a success only a quiet code (hidden on phones), because success is what a request is expected to do.
 */
export function StatusText({ row }: { row: NetworkRow }) {
  if (row.pending)
    return (
      <span className="np-code" data-tone="none" title={STRINGS.noResponseHint}>
        {STRINGS.noResponse}
      </span>
    );
  return (
    <span className="np-code" data-tone={row.failed ? 'bad' : 'ok'} title={row.entry.statusText || undefined}>
      {row.entry.status || STRINGS.error}
    </span>
  );
}

function durationTone(row: NetworkRow) {
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
