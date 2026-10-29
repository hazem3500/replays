import { useRef, useState } from 'react';

import type { ReplayCaptured, ReplayStep } from '../../../shared/replay.ts';
import { useNarrowerThan } from '../../hooks/use-narrower-than.ts';
import { Button } from '@/components/ui/button.tsx';
import { Empty } from '../Empty.tsx';
import { type RibbonMark, TimeRibbon } from '../TimeRibbon.tsx';
import {
  filterRows,
  NO_FILTER,
  type NetworkFilter,
  type NetworkRow,
  slowestMeasured,
  startDensity,
  statusCounts,
  typeCounts,
} from './model.ts';
import { NetworkList } from './NetworkList.tsx';
import { NetworkToolbar } from './NetworkToolbar.tsx';
import { type NetworkPeer, RequestDetail } from './RequestDetail.tsx';
// oxlint-disable-next-line import/no-unassigned-import -- why: the panel's styles load with the lazy inspector chunk, not with every page.
import './network.css';

export type { NetworkPeer } from './RequestDetail.tsx';

/** Above this many requests the ribbon draws their density; at or below it, one tick per request. */
const DENSE_ROWS = 12;
/** Narrower than this, the detail takes the list's place instead of sitting beside it. */
const SIDE_DETAIL_MIN_WIDTH = 760;
const DENSITY_BINS = 160;
const NO_PEERS: readonly NetworkPeer[] = [];
const PENDING_ROWS = ['a', 'b', 'c', 'd', 'e', 'f'];

const STRINGS = {
  humanTitle: 'Network wasn’t recorded',
  human: 'This recording was imported from rrweb, so console and network weren’t captured.',
  noneTitle: 'No requests were recorded',
  none: 'No network requests were captured during this session.',
  noMatchTitle: 'No matching requests',
  noMatch: 'Nothing matches these filters.',
  clear: 'Show every request',
};

function emptyCopy(total: number, human: boolean) {
  if (total) return { title: STRINGS.noMatchTitle, body: STRINGS.noMatch };
  return human ? { title: STRINGS.humanTitle, body: STRINGS.human } : { title: STRINGS.noneTitle, body: STRINGS.none };
}

function ribbonMarks(rows: readonly NetworkRow[], ticks: boolean): RibbonMark[] {
  return rows.flatMap((row): RibbonMark[] => {
    if (row.failed) return [{ id: row.id, at: row.at, end: row.at, tone: 'danger', lane: 'full' }];
    if (row.pending) return [{ id: row.id, at: row.at, end: row.at, tone: 'neutral', lane: 'full' }];
    if (row.slow) return [{ id: row.id, at: row.at, end: row.end, tone: 'warning', lane: 'cap' }];
    return ticks ? [{ id: row.id, at: row.at, end: row.end, tone: 'neutral', lane: 'tick' }] : [];
  });
}

/**
 * The Network tab: what failed or was slow, and when. Status chips (the filters and the summary), a ribbon on the
 * seek bar's domain for "when" (hidden when the list already fits), the list for "how long", and the selected
 * request's detail beside it or, on a narrow panel, in its place.
 */
export function NetworkPanel({
  rows,
  steps,
  duration,
  human,
  selected,
  onSelect,
  peers,
  captured,
}: {
  rows: readonly NetworkRow[];
  steps: readonly ReplayStep[];
  duration: number;
  human: boolean;
  selected: string | undefined;
  onSelect: (id?: string) => void;
  peers?: readonly NetworkPeer[] | undefined;
  /** What the recording kept (`meta.captured`), for the detail's body sections. */
  captured?: ReplayCaptured | undefined;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const stacked = useNarrowerThan(panel, SIDE_DETAIL_MIN_WIDTH);
  const [filter, setFilter] = useState<NetworkFilter>(NO_FILTER);
  const [hovered, setHovered] = useState<string>();
  const dense = rows.length > DENSE_ROWS;
  const unranged = filterRows(rows, { ...filter, range: undefined });
  const shown = filter.range ? filterRows(unranged, { ...NO_FILTER, range: filter.range }) : unranged;
  const open = selected ? rows.find((row) => row.id === selected) : undefined;
  const copy = emptyCopy(rows.length, human);
  const empty = (
    <Empty
      title={copy.title}
      action={
        rows.length ? (
          <Button variant="outline" size="sm" onClick={() => setFilter(NO_FILTER)}>
            {STRINGS.clear}
          </Button>
        ) : undefined
      }
    >
      {copy.body}
    </Empty>
  );
  return (
    <div ref={panel} className="np" data-stacked={stacked || undefined} data-open={open ? '' : undefined}>
      <NetworkToolbar counts={statusCounts(rows)} types={typeCounts(rows)} filter={filter} shown={shown.length} onFilter={setFilter} />
      {rows.length ? (
        <TimeRibbon
          testId="network-ribbon"
          duration={duration}
          density={dense ? startDensity(unranged, duration, DENSITY_BINS) : undefined}
          marks={ribbonMarks(unranged, !dense)}
          range={filter.range}
          onRange={(range) => setFilter({ ...filter, range })}
          highlight={hovered ?? selected}
        />
      ) : null}
      <div className="np-body">
        <div className="np-list" hidden={(stacked && open !== undefined) || undefined}>
          <NetworkList
            rows={shown}
            steps={steps}
            ceiling={slowestMeasured(rows)}
            selected={selected}
            onSelect={onSelect}
            onHover={setHovered}
            empty={empty}
          />
        </div>
        {open ? (
          <RequestDetail
            row={open}
            rows={rows}
            steps={steps}
            peers={peers ?? NO_PEERS}
            stacked={stacked}
            captured={captured}
            onSelect={onSelect}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The panel's shape while the replay loads: the toolbar row, the header and a few rows, at their real heights. */
export const NetworkPending = (
  <div className="np np-pending" aria-hidden="true">
    <div className="np-toolbar">
      <span className="skeleton np-pending-chips" />
    </div>
    <div className="np-row np-head" />
    {PENDING_ROWS.map((row) => (
      <div key={row} className="np-row">
        <span className="skeleton skeleton-thin" />
        <span className="skeleton skeleton-thin" />
        <span className="skeleton skeleton-thin" />
        <span className="skeleton skeleton-thin" />
      </div>
    ))}
  </div>
);
