import { type ReactNode, useRef, useState } from 'react';

import { formatClock, type ReplayMeta, type ReplayStep } from '../../../shared/replay.ts';
import { useMinContentHeight } from '../dock-grow.ts';
import { useRibbonCollapsed } from '../ribbon-collapse.ts';
import { useNarrowerThan } from '../../hooks/use-narrower-than.ts';
import { usePlayer } from '../../player.ts';
import { Empty } from '../Empty.tsx';
import { NotCaptured } from '../NotCaptured.tsx';
import type { NetworkRow } from '../network/model.ts';
import type { PerformanceModel } from '../performance.ts';
import type { RibbonRange } from '../TimeRibbon.tsx';
import { MomentDetail } from './MomentDetail.tsx';
import { MomentList } from './MomentList.tsx';
import { PerfTimeline } from './PerfTimeline.tsx';
import { TimelineToggle } from './PerfTimelineParts.tsx';
import { cadenceStats } from './stats.ts';
import { buildLanes } from './timeline-model.ts';
import { VerdictLine } from './VerdictLine.tsx';
import { buildVerdict } from './verdict.ts';
import { buildMoments, buildVitals, causeOf, causeText, type MomentOrder, orderMoments, type Vital, vitalDeltas } from './model.ts';
import { type VitalPeer, VitalsBar } from './VitalsBar.tsx';
// oxlint-disable-next-line import/no-unassigned-import -- why: the panel shares the network panel's frame styles, loaded with the lazy inspector.
import '../network/network.css';
// oxlint-disable-next-line import/no-unassigned-import -- why: the panel's styles load with the lazy inspector chunk, not with every page.
import './performance.css';

/** Another recording being compared: its short name, colour (1 to 9) and vitals. */
export interface PerformancePeer {
  id: string;
  name: string;
  colour: number;
  vitals: readonly Vital[];
}

/** A long task counts toward blocking time by what it spent past this. */
const BLOCKING_AFTER_MS = 50;
const SIDE_DETAIL_MIN_WIDTH = 760;

const STRINGS = {
  calmTitle: 'No slow activity captured',
  calm: 'No long tasks or slow interactions were recorded. Available observations depend on browser support.',
  outsideTitle: 'Nothing slow in this stretch',
  outside: 'Clear the time range to see every moment.',
};

/** The panel's rows, in px: what the headline, timeline, stats strip and a table of this many rows need to read as one. */
const LEAD = 40;
const AXIS = 24;
const LANE = 24;
const FPS = 72;
const STRIP = 56;
const TABLE_HEAD = 28;
const ROW = 30;
export const MIN_TABLE_ROWS = 4;

/** Something was measured: a vital has a value or was watched (`None`), or there is a moment. */
function recorded(vitals: readonly Vital[], moments: number) {
  return moments > 0 || vitals.some((vital) => vital.missing !== 'not-captured');
}

/**
 * The Performance tab: verdicts first (the vitals bar), then where the slow moments were on the seek bar's domain,
 * then the moments themselves, worst first, each saying what it was during and what it waited on.
 */
export function PerformancePanel({
  model,
  requests,
  steps,
  duration,
  peers,
  meta,
  extra,
  onOpenRequest,
}: {
  model: PerformanceModel;
  /** The recording's requests on the player's clock: what was in flight during a moment. */
  requests: readonly NetworkRow[];
  steps: readonly ReplayStep[];
  duration: number;
  peers?: readonly PerformancePeer[] | undefined;
  /** Whose source and page say how to capture performance when this recording has none. */
  meta: Pick<ReplayMeta, 'source' | 'url'>;
  /** Shown under the vitals (compare mode's own summary). */
  extra?: ReactNode;
  onOpenRequest: (id: string) => void;
}) {
  const player = usePlayer();
  const panel = useRef<HTMLDivElement>(null);
  const stacked = useNarrowerThan(panel, SIDE_DETAIL_MIN_WIDTH);
  const [selected, setSelected] = useState<string>();
  const [order, setOrder] = useState<MomentOrder>('worst');
  const [blocking, setBlocking] = useState(false);
  const [range, setRange] = useState<RibbonRange>();
  const [hovered, setHovered] = useState<readonly string[]>([]);
  // why: the verdict's jump lights its marks until the person picks something else.
  const [pinned, setPinned] = useState<readonly string[]>([]);
  const moments = buildMoments(model.signals);
  const vitals = buildVitals(model.signals, moments, model.track);
  const inRange = (at: number, end = at) => !range || (end >= range.from && at <= range.to);
  const scopedMoments = moments.filter((item) => inRange(item.at, item.end));
  const scopedVitals = range
    ? buildVitals(
        model.signals.filter((signal) => inRange(signal.at)),
        scopedMoments,
        model.track,
      )
    : vitals;
  const lanes = buildLanes(moments, requests, model.shifts);
  const verdict = buildVerdict({ moments, vitals, frames: model.frames, shifts: model.shifts, requests });
  const rows = blocking ? scopedMoments.filter((item) => item.kind === 'task' && item.value > BLOCKING_AFTER_MS) : scopedMoments;
  const shown = orderMoments(rows, order);
  const open = moments.find((item) => item.id === selected);
  const timelineCollapsed = useRibbonCollapsed();
  const timelineHeight =
    lanes.length || model.frames.length
      ? (timelineCollapsed ? 0 : AXIS + lanes.length * LANE + (model.frames.length ? FPS : 0)) + (timelineCollapsed ? 0 : 8)
      : 0;
  useMinContentHeight(LEAD + timelineHeight + STRIP + TABLE_HEAD + MIN_TABLE_ROWS * ROW);
  const vitalPeers: VitalPeer[] = (peers ?? []).map((peer) => ({
    id: peer.id,
    name: peer.name,
    colour: peer.colour,
    deltas: vitalDeltas(vitals, peer.vitals),
  }));
  // why: when no observer reported anything, five "Not captured" cells and "Nothing was slow" would claim a result.
  if (!model.track?.supported.length && !recorded(vitals, moments.length))
    return (
      <NotCaptured
        track="performance"
        meta={meta}
        peers={(peers ?? []).filter((peer) => recorded(peer.vitals, 0)).map((peer) => peer.name)}
        testId="performance-not-captured"
      />
    );
  const empty = range ? (
    <Empty title={STRINGS.outsideTitle}>{STRINGS.outside}</Empty>
  ) : (
    <Empty title={STRINGS.calmTitle}>{STRINGS.calm}</Empty>
  );
  const lit = [hovered, pinned, selected ? [selected] : []].find((ids) => ids.length) ?? [];
  const select = (id?: string) => {
    setPinned([]);
    setSelected(id);
  };
  const verdictLine = (
    <VerdictLine
      verdict={verdict}
      onJump={(jump) => {
        player.seek(jump.at);
        setSelected(undefined);
        setPinned(jump.ids);
      }}
    >
      {lanes.length || model.frames.length ? <TimelineToggle /> : null}
    </VerdictLine>
  );
  return (
    <div ref={panel} className="np pp" data-testid="performance-diagnostics" data-stacked={stacked || undefined}>
      {verdictLine}
      {lanes.length || model.frames.length ? (
        <PerfTimeline
          duration={duration}
          lanes={lanes}
          frames={model.frames}
          range={range}
          onRange={setRange}
          lit={lit}
          onLight={setHovered}
          onPick={(mark) => {
            const id = mark.items.find((item) => item.momentId)?.momentId;
            if (id) select(id);
          }}
        />
      ) : null}
      <VitalsBar
        vitals={scopedVitals}
        peers={range ? [] : vitalPeers}
        cadence={cadenceStats(model.track, model.shifts, model.frames, range)}
        ranged={range !== undefined}
        blocking={blocking}
        onBlocking={() => setBlocking(!blocking)}
        scopes={[
          ...(range
            ? [{ text: `in ${formatClock(range.from)} to ${formatClock(range.to)}`, label: 'Clear the time range', onClear: () => setRange(undefined) }]
            : []),
          ...(blocking ? [{ text: 'Blocking tasks', label: 'Show all moments', onClear: () => setBlocking(false) }] : []),
        ]}
        onSeek={(at) => player.seek(at)}
        onPick={(vital) => {
          if (vital.moment) {
            player.seek(vital.moment.at);
            select(vital.moment.id);
          } else player.seek(vital.at ?? 0);
        }}
      />
      {extra}
      <div className="np-body">
        <div className="np-list" hidden={(stacked && open !== undefined) || undefined}>
          <MomentList
            moments={shown}
            steps={steps}
            explain={(item) => causeText(causeOf(item, moments, requests))}
            selected={selected}
            hovered={lit}
            order={order}
            onOrder={setOrder}
            onSelect={select}
            onHover={(id) => setHovered(id ? [id] : [])}
            empty={empty}
          />
        </div>
        {open ? (
          <MomentDetail
            moment={open}
            moments={moments}
            requests={requests}
            steps={steps}
            stacked={stacked}
            onSelect={select}
            onOpenRequest={onOpenRequest}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The panel's shape while the replay loads: the vitals bar, the header and a few rows, at their real heights. */
export const PerformancePending = (
  <div className="np pp pp-pending" aria-hidden="true">
    <div className="pp-vitals">
      <span className="skeleton pp-pending-vitals" />
    </div>
    <div className="pp-row pp-head" />
    {['a', 'b', 'c', 'd'].map((row) => (
      <div key={row} className="pp-row">
        <span className="skeleton skeleton-thin" />
        <span className="skeleton skeleton-thin" />
        <span className="skeleton skeleton-thin" />
      </div>
    ))}
  </div>
);
