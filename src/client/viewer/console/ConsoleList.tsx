import { CircleXIcon, TriangleAlertIcon } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef } from 'react';

import type { ConsoleLevel } from '../../../shared/replay.ts';
import { domain } from '../../format.ts';
import { useRevealRow } from '../../hooks/use-reveal-row.ts';
import { useRowHeight } from '../../hooks/use-row-height.ts';
import { usePlayer, usePlayhead } from '../../player.ts';
import { countAtOrBefore } from '../../timeline.ts';
import { useWindowedRows } from '../../windowing.ts';
import { KEY_MOVES, moveIndex, type StepMove } from '../list-keys.ts';
import { playheadHorizon } from '../network/model.ts';
import { HEADER_HEIGHT, SeekTime, TrackList } from '../TrackList.tsx';
import { type ConsoleRow, LEVEL_NAMES, stackFrames } from './model.ts';

export const CONSOLE_DETAIL_ID = 'console-detail';

const STRINGS = {
  time: 'Time',
  message: 'Message',
  page: 'Page',
  more: (lines: number) => `+${lines} lines`,
  stack: 'Stack',
  repeated: (count: number) => `Logged ${count} times`,
};

const FALLBACK_ROW_HEIGHT = 44;
/** Lines a row shows before "+N lines" (console.css clamps to the same). */
const CLAMP_LINES = 2;

/**
 * Every message in time order on the shared list frame (TrackList: the now divider, follow and Back to now). A row
 * shows two lines of the message; longer ones say how many lines more, and the whole message opens in the detail.
 */
export function ConsoleList({
  rows,
  selected,
  onSelect,
  empty,
}: {
  rows: readonly ConsoleRow[];
  selected: string | undefined;
  onSelect: (id?: string) => void;
  empty: ReactNode;
}) {
  const player = usePlayer();
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const ats = rows.map((row) => row.at);
  const reached = usePlayhead((time) => countAtOrBefore(ats, playheadHorizon(time, player.duration)));
  const rowHeight = useRowHeight(body, '.cp-row:not(.cp-head)', rows.length > 0, FALLBACK_ROW_HEIGHT);
  const { start, end, padTop, padBottom } = useWindowedRows(scroller, { count: rows.length, rowHeight, headerHeight: HEADER_HEIGHT });
  const selectedIndex = selected ? rows.findIndex((row) => row.id === selected) : -1;
  useRevealRow(scroller, selectedIndex, rowHeight, HEADER_HEIGHT);
  const step = (id: string, move: StepMove) => {
    const next =
      rows[
        moveIndex(
          move,
          rows.findIndex((row) => row.id === id),
          rows.length,
        )
      ];
    if (!next || next.id === id) return;
    // why: an end may be far outside the rendered window; selecting it scrolls it in (useRevealRow) before focus lands.
    if (selected || move === 'first' || move === 'last') onSelect(next.id);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`console-switch-${next.id}`)?.focus()));
  };
  return (
    <TrackList
      testId="console-list"
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
        <div className="cp-table" role="table" aria-rowcount={rows.length + 1}>
          <div className="cp-row cp-head" role="row" aria-rowindex={1}>
            <span role="columnheader">{STRINGS.time}</span>
            <span role="columnheader">{STRINGS.message}</span>
            <span role="columnheader" className="cp-page">
              {STRINGS.page}
            </span>
          </div>
          <div ref={body} role="rowgroup">
            <div aria-hidden="true" style={{ height: padTop }} />
            {rows.slice(start, end).map((row, offset) => (
              <MessageRow
                key={row.id}
                row={row}
                rowIndex={start + offset + 2}
                future={start + offset >= reached}
                selected={row.id === selected}
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

function MessageRow({
  row,
  rowIndex,
  future,
  selected,
  onSelect,
  onStep,
}: {
  row: ConsoleRow;
  rowIndex: number;
  future: boolean;
  selected: boolean;
  onSelect: (id?: string) => void;
  onStep: (id: string, move: StepMove) => void;
}) {
  const level = row.entry.level;
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
      className="cp-row"
      role="row"
      aria-rowindex={rowIndex}
      data-level={level}
      data-selected={selected || undefined}
      data-future={future || undefined}
    >
      <span role="cell" className="cp-time">
        <SeekTime at={row.at} future={future} />
      </span>
      <span role="cell" className="cp-message">
        <button
          type="button"
          id={`console-switch-${row.id}`}
          data-console-id={row.id}
          aria-expanded={selected}
          aria-controls={selected ? CONSOLE_DETAIL_ID : undefined}
          onClick={() => onSelect(selected ? undefined : row.id)}
          onKeyDown={onKeyDown}
        >
          <LevelIcon level={level} />
          <code className="cp-text">{row.entry.message}</code>
          <RowBadges row={row} />
        </button>
      </span>
      <span role="cell" className="cp-page" title={row.entry.url}>
        {row.entry.url ? domain(row.entry.url) : null}
      </span>
    </div>
  );
}

function RowBadges({ row }: { row: ConsoleRow }) {
  const frames = stackFrames(row.entry.message).length;
  const extra = row.lines - frames - CLAMP_LINES;
  if (!frames && extra <= 0 && row.count === 1) return null;
  return (
    <span className="cp-badges">
      {frames ? <span className="cp-badge">{STRINGS.stack}</span> : null}
      {extra > 0 ? <span className="cp-badge">{STRINGS.more(extra)}</span> : null}
      {row.count > 1 ? (
        <span className="cp-badge cp-count" title={STRINGS.repeated(row.count)}>
          ×{row.count}
        </span>
      ) : null}
    </span>
  );
}

/** Errors and warnings get a glyph; every level is in the accessible text. */
export function LevelIcon({ level }: { level: ConsoleLevel }) {
  const name = LEVEL_NAMES[level];
  if (level !== 'error' && level !== 'warn') return <span className="visually-hidden">{name}: </span>;
  const Icon = level === 'error' ? CircleXIcon : TriangleAlertIcon;
  return (
    <span className="cp-level-icon" data-level={level} role="img" aria-label={name} title={name}>
      <Icon aria-hidden="true" />
    </span>
  );
}
