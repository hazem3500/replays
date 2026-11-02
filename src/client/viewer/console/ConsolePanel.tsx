import { CircleXIcon, TriangleAlertIcon } from 'lucide-react';
import { useRef } from 'react';

import { EmptyState } from '@/components/ui/empty-state.tsx';
import type { ReplayConsoleEntry } from '../../../shared/replay.ts';
import { domain } from '../../format.ts';
import { useRowHeight } from '../../hooks/use-row-height.ts';
import { useWindowedRows } from '../../windowing.ts';
import { HEADER_HEIGHT, SeekTime, TRACK_GAP, TRAILING_GAP, TrackList } from '../TrackList.tsx';

/**
 * The fixed gap before the first row (TRACK_GAP: none, so rows meet the header) and after the last one
 * (TRAILING_GAP: room for the now divider's grip to rest below the last row, fully visible).
 */
function GapRow({ columns, trailing = false }: { columns: number; trailing?: boolean }) {
  const height = trailing ? TRAILING_GAP : TRACK_GAP;
  if (height <= 0) return null;
  return (
    <tr className="gap-row" aria-hidden="true" style={{ height }}>
      <td colSpan={columns} />
    </tr>
  );
}

function SpacerRow({ height, columns }: { height: number; columns: number }) {
  if (height <= 0) return null;
  return (
    <tr className="spacer-row" aria-hidden="true" style={{ height }}>
      <td colSpan={columns} />
    </tr>
  );
}

const NO_SOURCE = 'No source';

const CONSOLE_EMPTY = {
  humanTitle: 'Console wasn’t recorded',
  humanBody: 'This replay was imported from an rrweb recording, which doesn’t capture console or network activity.',
  noneTitle: 'Nothing was logged in this replay',
  noneBody: 'The page wrote nothing to the console while it was recorded.',
};

/** Shown only when the console has nothing in it at all; entries the playhead has not reached are listed, faded. */
function ConsoleEmpty({ human }: { human: boolean }) {
  return human ? (
    <EmptyState variant="compact" icon="console" title={CONSOLE_EMPTY.humanTitle} body={CONSOLE_EMPTY.humanBody} />
  ) : (
    <EmptyState variant="compact" icon="console" title={CONSOLE_EMPTY.noneTitle} body={CONSOLE_EMPTY.noneBody} />
  );
}

export function ConsolePanel({ entries, reached, human }: { entries: ReplayConsoleEntry[]; reached: number; human: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const total = entries.length;
  const ats = entries.map((entry) => entry.at);
  const rowHeight = useRowHeight(body, 'tr.console-row', total > 0);
  const { start, end, padTop, padBottom } = useWindowedRows(scroller, { count: total, rowHeight, headerHeight: HEADER_HEIGHT + TRACK_GAP });
  return (
    <TrackList testId="console-list" reached={reached} total={total} rowHeight={rowHeight} ats={ats} scroller={scroller}>
      {total === 0 ? (
        <ConsoleEmpty human={human} />
      ) : (
        <table className="diagnostic-table console-table" aria-rowcount={total + 1}>
          <thead>
            <tr aria-rowindex={1}>
              <th>Time</th>
              <th>Message</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody ref={body}>
            <GapRow columns={3} />
            <SpacerRow height={padTop} columns={3} />
            {entries.slice(start, end).map((entry, offset) => {
              const index = start + offset;
              const future = index >= reached;
              return (
                <tr className={`console-row ${entry.level}`} key={index} aria-rowindex={index + 2} data-future={future || undefined}>
                  <td>
                    <SeekTime at={entry.at} future={future} />
                  </td>
                  <td>
                    <span className="console-message">
                      <LevelIcon level={entry.level} />
                      <code title={entry.message}>{entry.message}</code>
                    </span>
                  </td>
                  <td className="source" title={entry.url}>
                    {entry.url ? domain(entry.url) : <span className="visually-hidden">{NO_SOURCE}</span>}
                  </td>
                </tr>
              );
            })}
            <SpacerRow height={padBottom} columns={3} />
            <GapRow columns={3} trailing />
          </tbody>
        </table>
      )}
    </TrackList>
  );
}

/**
 * Only warnings and errors get a small glyph before the message (amber, red: inside the row); log, info and debug
 * get none, so plain rows have no icon gutter. The level is always in the accessible text and the glyph's title.
 */
function LevelIcon({ level }: { level: ReplayConsoleEntry['level'] }) {
  const Icon = level === 'error' ? CircleXIcon : level === 'warn' ? TriangleAlertIcon : undefined;
  const name = level === 'warn' ? 'Warning' : level[0]!.toUpperCase() + level.slice(1);
  return Icon ? (
    <span className={`level-icon ${level}`} role="img" aria-label={name} title={name}>
      <Icon aria-hidden="true" />
    </span>
  ) : (
    <span className="visually-hidden">{name}: </span>
  );
}
