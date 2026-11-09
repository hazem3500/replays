import { type ReactNode, useRef, useState } from 'react';

import type { ReplayMeta, ReplayStep } from '../../../shared/replay.ts';
import { useNarrowerThan } from '../../hooks/use-narrower-than.ts';
import { usePlayer } from '../../player.ts';
import { Empty } from '../Empty.tsx';
import { NotCaptured } from '../NotCaptured.tsx';
import type { NetworkRow } from '../network/model.ts';
import type { PerformanceModel } from '../performance.ts';
import { type RibbonMark, type RibbonRange, type RibbonTone, TimeRibbon } from '../TimeRibbon.tsx';
import { CadenceSummary } from './CadenceSummary.tsx';
import { FpsLane } from './FpsLane.tsx';
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

const SIDE_DETAIL_MIN_WIDTH = 760;

const STRINGS = {
  order: 'Order',
  worst: 'Worst first',
  time: 'In order',
  calmTitle: 'No slow activity captured',
  calm: 'No long tasks or slow interactions were recorded. Available observations depend on browser support.',
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

/** Something was measured: a vital has a value or was watched (`None`), or there is a moment. */
function recorded(vitals: readonly Vital[], moments: number) {
  return moments > 0 || vitals.some((vital) => vital.missing !== 'not-captured');
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
  const [range, setRange] = useState<RibbonRange>();
  const [hovered, setHovered] = useState<string>();
  const moments = buildMoments(model.signals);
  const vitals = buildVitals(model.signals, moments, model.track);
  const marks = ribbonMarks(moments, vitals);
  const shown = orderMoments(range ? moments.filter((item) => item.end >= range.from && item.at <= range.to) : moments, order);
  const open = moments.find((item) => item.id === selected);
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
      {model.track ? <CadenceSummary track={model.track} /> : null}
      {marks.length ? (
        <TimeRibbon
          testId="performance-ribbon"
          duration={duration}
          marks={marks}
          range={range}
          onRange={setRange}
          highlight={hovered ?? selected}
        />
      ) : null}
      {model.frames.length ? <FpsLane bands={model.frames} duration={duration} /> : null}
      <div className="np-body">
        <div className="np-list" hidden={(stacked && open !== undefined) || undefined}>
          <MomentList
            moments={shown}
            steps={steps}
            explain={(item) => causeText(causeOf(item, moments, requests))}
            selected={selected}
            onSelect={setSelected}
            onHover={setHovered}
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
