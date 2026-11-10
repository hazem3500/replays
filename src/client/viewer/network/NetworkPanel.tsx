import { GlobeIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { Splitter } from '@/components/ui/splitter.tsx';
import { useElementWidth } from '../../hooks/use-element-width.ts';
import { cssVars } from '../../lib/css-vars.ts';

import type { ReplayCaptured, ReplayStep } from '../../../shared/replay.ts';
import { useNarrowerThan } from '../../hooks/use-narrower-than.ts';
import { Button } from '@/components/ui/button.tsx';
import { Empty } from '../Empty.tsx';
import { filterRows, NO_FILTER, type NetworkFilter, type NetworkRow, slowestMeasured, statusCounts, typeCounts } from './model.ts';
import { NetworkList } from './NetworkList.tsx';
import { NetworkTimeline } from './NetworkTimeline.tsx';
import { sortNetworkRows, type NetworkSort } from './sort.ts';
import { NetworkToolbar } from './NetworkToolbar.tsx';
import { type NetworkPeer, RequestDetail } from './RequestDetail.tsx';
// oxlint-disable-next-line import/no-unassigned-import -- why: the panel's styles load with the lazy inspector chunk, not with every page.
import './network.css';

export type { NetworkPeer } from './RequestDetail.tsx';

/** Narrower than this, the detail takes the list's place instead of sitting beside it. */
const SIDE_DETAIL_MIN_WIDTH = 760;
const NO_PEERS: readonly NetworkPeer[] = [];

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

/**
 * The Network tab: what failed or was slow, and when. Status chips (the filters and the summary), a timeline for "when" (collapsible), the list for "how long", and the selected
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
  const panelWidth = useElementWidth(panel, SIDE_DETAIL_MIN_WIDTH);
  const [detailWidth, setDetailWidth] = useState(400);
  const [filter, setFilter] = useState<NetworkFilter>(NO_FILTER);
  const [hovered, setHovered] = useState<string>();
  const [sort, setSort] = useState<NetworkSort>({ key: 'time', direction: 'ascending' });
  const unranged = filterRows(rows, { ...filter, range: undefined });
  const shown = filter.range ? filterRows(unranged, { ...NO_FILTER, range: filter.range }) : unranged;
  const litId = hovered ?? selected;
  const lit = litId ? [litId] : [];
  const open = selected ? rows.find((row) => row.id === selected) : undefined;
  const copy = emptyCopy(rows.length, human);
  const empty = (
    <Empty
      icon={GlobeIcon}
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
    <div
      ref={panel}
      className="np"
      style={cssVars({ '--np-detail-width': `${Math.min(detailWidth, Math.max(280, panelWidth - 320))}px` })}
      data-stacked={stacked || undefined}
      data-open={open ? '' : undefined}
    >
      <NetworkToolbar counts={statusCounts(rows)} types={typeCounts(rows)} filter={filter} shown={shown.length} onFilter={setFilter} />
      {rows.length ? (
        <NetworkTimeline
          rows={unranged}
          duration={duration}
          range={filter.range}
          onRange={(range) => setFilter({ ...filter, range })}
          lit={lit}
          onLight={(ids) => setHovered(ids[0])}
        />
      ) : null}
      <div className="np-body">
        <div className="np-list" hidden={(stacked && open !== undefined) || undefined}>
          <NetworkList
            rows={sortNetworkRows(shown, sort, steps)}
            sort={sort}
            onSort={setSort}
            steps={steps}
            ceiling={slowestMeasured(rows)}
            selected={selected}
            onSelect={onSelect}
            onHover={setHovered}
            highlight={hovered}
            empty={empty}
          />
        </div>
        {open && !stacked ? (
          <Splitter
            orientation="vertical"
            side="end"
            value={detailWidth}
            min={280}
            max={Math.max(280, panelWidth - 320)}
            defaultValue={400}
            onChange={setDetailWidth}
            onPreview={(size) => panel.current?.style.setProperty('--np-detail-width', `${size}px`)}
            label="Request details width"
          />
        ) : null}
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
