import { type ReactNode, useRef, useState } from 'react';

import type { ReplayStep } from '../../../shared/replay.ts';
import { useNarrowerThan } from '../../hooks/use-narrower-than.ts';
import { usePlayer } from '../../player.ts';
import { Empty } from '../Empty.tsx';
import type { NetworkRow } from '../network/model.ts';
import type { PerformanceModel } from '../performance.ts';
import { type RibbonMark, type RibbonRange, type RibbonTone, TimeRibbon } from '../TimeRibbon.tsx';
import { MomentDetail } from './MomentDetail.tsx';
import { MomentList } from './MomentList.tsx';
import {
  buildMoments,
  buildVitals,
  causeOf,
  causeText,
  type Moment,
  type MomentOrder,
  orderMoments,
  type Verdict,
  type Vital,
  vitalDeltas,
} from './model.ts';
import { type VitalPeer, VitalsBar } from './VitalsBar.tsx';
import '../network/network.css';
import './performance.css';

/** Another recording being compared: its letter and vitals. */
export interface PerformancePeer {
  id: string;
  letter: string;
  vitals: readonly Vital[];
}

/** Below this many moments the list says it all; the ribbon would be a mostly empty strip. */
const RIBBON_MIN_MOMENTS = 4;
const SIDE_DETAIL_MIN_WIDTH = 760;

const STRINGS = {
  order: 'Order',
  worst: 'Worst first',
  time: 'In order',
  noneTitle: 'Performance wasn’t captured',
  none: 'This recording has no paint, long task or interaction timings.',
  calmTitle: 'Nothing was slow',
  calm: 'No long tasks or slow interactions were captured.',
  outsideTitle: 'Nothing slow in this stretch',
  outside: 'Clear the time range to see every moment.',
};

const TONES: Readonly<Record<Verdict, RibbonTone>> = { poor: 'danger', 'needs-work': 'warning', good: 'neutral' };

function ribbonMarks(moments: readonly Moment[], vitals: readonly Vital[]): RibbonMark[] {
  const spans = moments.map((item): RibbonMark => ({
    id: item.id,
    at: item.at,
    end: item.end,
    tone: TONES[item.verdict],
    lane: item.kind === 'task' ? 'top' : 'bottom',
  }));
  const paints = vitals.flatMap((vital): RibbonMark[] =>
    vital.at === undefined ? [] : [{ id: vital.id, at: vital.at, end: vital.at, tone: 'success', lane: 'cap' }],
  );
  return [...spans, ...paints];
}

const otherOrder = (order: MomentOrder): MomentOrder => (order === 'worst' ? 'time' : 'worst');

function OrderSwitch({ order, onOrder }: { order: MomentOrder; onOrder: (order: MomentOrder) => void }) {
  return (
    <div className="pp-order" role="group" aria-label={STRINGS.order}>
      {(['worst', 'time'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={order === value}
          // why: on a phone only the current order shows, so pressing it switches to the other one.
          onClick={() => onOrder(order === value ? otherOrder(value) : value)}
        >
          {value === 'worst' ? STRINGS.worst : STRINGS.time}
        </button>
      ))}
    </div>
  );
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
  extra,
  onOpenRequest,
}: {
  model: PerformanceModel;
  /** The recording's requests on the player's clock: what was in flight during a moment. */
  requests: readonly NetworkRow[];
  steps: readonly ReplayStep[];
  duration: number;
  peers?: readonly PerformancePeer[] | undefined;
  /** Shown under the vitals (compare mode's own summary). */
  extra?: ReactNode;
  onOpenRequest: (id: string) => void;
}) {
  const player = usePlayer();
  const panel = useRef<HTMLDivElement>(null);
  const stacked = useNarrowerThan(panel, SIDE_DETAIL_MIN_WIDTH);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [order, setOrder] = useState<MomentOrder>('worst');
  const [range, setRange] = useState<RibbonRange | undefined>(undefined);
  const moments = buildMoments(model.signals);
  const vitals = buildVitals(model.signals, moments, model.track);
  const shown = orderMoments(range ? moments.filter((item) => item.end >= range.from && item.at <= range.to) : moments, order);
  const open = moments.find((item) => item.id === selected);
  const vitalPeers: VitalPeer[] = (peers ?? []).map((peer) => ({
    id: peer.id,
    letter: peer.letter,
    deltas: vitalDeltas(vitals, peer.vitals),
  }));
  if (!model.track) return <Empty title={STRINGS.noneTitle}>{STRINGS.none}</Empty>;
  const empty = range ? (
    <Empty title={STRINGS.outsideTitle}>{STRINGS.outside}</Empty>
  ) : (
    <Empty title={STRINGS.calmTitle}>{STRINGS.calm}</Empty>
  );
  return (
    <div ref={panel} className="np pp" data-testid="performance-diagnostics" data-stacked={stacked || undefined}>
      <VitalsBar
        vitals={vitals}
        peers={vitalPeers}
        onPick={(vital) => (vital.moment ? setSelected(vital.moment.id) : player.seek(vital.at ?? 0))}
      >
        {moments.length > 1 ? <OrderSwitch order={order} onOrder={setOrder} /> : null}
      </VitalsBar>
      {extra}
      {moments.length >= RIBBON_MIN_MOMENTS ? (
        <TimeRibbon testId="performance-ribbon" duration={duration} marks={ribbonMarks(moments, vitals)} range={range} onRange={setRange} />
      ) : null}
      <div className="np-body">
        <div className="np-list" hidden={(stacked && open !== undefined) || undefined}>
          <MomentList
            moments={shown}
            steps={steps}
            explain={(item) => causeText(causeOf(item, moments, requests))}
            selected={selected}
            onSelect={setSelected}
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
            onSelect={setSelected}
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
