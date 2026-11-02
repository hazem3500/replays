import { useState } from 'react';

import { EmptyState } from '@/components/ui/empty-state.tsx';
import type { VitalId } from '../../../shared/diagnostics/budgets.ts';
import type { EvidenceRef } from '../../../shared/diagnostics/types.ts';
import type { EditTimeline } from '../../../shared/edits.ts';
import type { ReplayBundle, ReplayPerformanceKind } from '../../../shared/replay.ts';
import { useInspectorRows, type InspectorPerformanceRow } from '../../data/inspector.ts';
import { useMediaQuery } from '../../media.ts';
import { usePlayer } from '../../player.ts';
import { laneData } from '../issues/evidence.ts';
import { buildPerformance } from '../performance.ts';
import { buildVitals, type Vital } from './budgets.ts';
import { PerformanceDetail } from './PerformanceDetail.tsx';
import { PerformanceTable, type PerformanceOrder } from './PerformanceTable.tsx';
import { VitalsStrip } from './VitalsStrip.tsx';
import './performance-panel.css';

const PHONE_QUERY = '(max-width: 600px)';
const TOUCH_QUERY = '(pointer: coarse)';
const ROW_HEIGHT = { desktop: 30, touch: 44 };
/** The observer types the panel relies on, by the name a person knows them by. */
const OBSERVED: ReadonlyArray<[string, string]> = [
  ['longtask', 'long tasks'],
  ['event', 'interactions'],
  ['paint', 'first paint'],
  ['largest-contentful-paint', 'the largest paint'],
];

export const performanceEmptyStrings = {
  notRecordedTitle: 'Performance wasn’t captured',
  notRecordedBody: 'This replay has no browser timing data. Imported rrweb recordings and older captures don’t include it.',
  unsupportedTitle: 'Not captured by this browser',
  unsupportedBody:
    'The recording browser doesn’t support the performance APIs the recorder uses, so nothing was measured. That says nothing about whether the page was slow.',
  outsideTitle: 'No signals in the kept part of this replay',
  outsideBody: 'Signals were captured, but they fall outside the trimmed recording or have unusable timestamps.',
  quietTitle: 'Nothing slow happened',
  quietBody: 'The browser was measuring, and no long tasks or slow interactions crossed their thresholds.',
  partial: (list: string) => ` It couldn’t measure ${list}.`,
  filteredTitle: 'No events of this kind',
  showAll: 'Show all events',
  filterLabel: 'Showing',
} as const;

const STRINGS = {
  region: 'Performance',
  kinds: (vital: Vital) => (vital.kind === 'long-task' ? 'Long tasks' : vital.kind === 'slow-interaction' ? 'Slow interactions' : 'Paints'),
};

function missing(supported: readonly string[]) {
  const names = OBSERVED.filter(([type]) => !supported.includes(type)).map(([, name]) => name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? '');
}

export interface PerformancePanelProps {
  sourceBundle: ReplayBundle;
  timeline?: EditTimeline | undefined;
  /** The selected event's row id (`performance-<index>`), controlled so Issues can open one. */
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  /** Select a request in the Network drill-down. */
  onOpen: (ref: EvidenceRef) => void;
}

/** The performance drill-down: vitals judged against budgets, the events worst first, and what was happening around one. */
export function PerformancePanel({ sourceBundle, timeline, selected, onSelect, onOpen }: PerformancePanelProps) {
  const player = usePlayer();
  const phone = useMediaQuery(PHONE_QUERY);
  const touch = useMediaQuery(TOUCH_QUERY);
  const [activeVital, setActiveVital] = useState<VitalId | undefined>(undefined);
  const [order, setOrder] = useState<PerformanceOrder>('worst');
  const model = buildPerformance(sourceBundle, timeline);
  const vitals = buildVitals(model.signals, model.track);
  const vital = vitals.find((item) => item.id === activeVital);
  const kinds: ReplayPerformanceKind[] | undefined = vital
    ? vital.kind === 'largest-contentful-paint' || vital.kind === 'first-contentful-paint'
      ? ['largest-contentful-paint', 'first-contentful-paint']
      : [vital.kind]
    : undefined;
  const { rows: all } = useInspectorRows(sourceBundle, 'performance', {}, timeline);
  const { rows } = useInspectorRows(sourceBundle, 'performance', { kinds }, timeline);
  const selectedRow = selected ? all.find((row) => row.id === selected) : undefined;
  const S = performanceEmptyStrings;

  const select = (row: InspectorPerformanceRow) => {
    onSelect(row.id);
    player.seek(row.at);
  };
  const pick = (picked: Vital) => {
    if (activeVital === picked.id) {
      setActiveVital(undefined);
      return;
    }
    setActiveVital(picked.id);
    const worst = picked.worst ? all.find((row) => row.id === picked.worst?.id) : undefined;
    if (worst) select(worst);
  };
  const close = () => {
    const id = selected;
    onSelect(undefined);
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.perf-panel [data-row-id="${CSS.escape(id)}"]`)?.focus());
  };

  if (!model.track) return <EmptyState variant="compact" icon="performance" title={S.notRecordedTitle} body={S.notRecordedBody} />;
  if (!all.length) {
    const { supported, entries } = model.track;
    if (supported.length === 0)
      return (
        <EmptyState variant="compact" icon="performance" title={S.unsupportedTitle} body={S.unsupportedBody} testId="perf-unsupported" />
      );
    if (entries.length) return <EmptyState variant="compact" icon="performance" title={S.outsideTitle} body={S.outsideBody} />;
    const gaps = missing(supported);
    return (
      <EmptyState
        variant="compact"
        icon="performance"
        title={S.quietTitle}
        body={S.quietBody + (gaps ? S.partial(gaps) : '')}
        testId="perf-quiet"
      />
    );
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions -- why: Escape anywhere in the panel closes the open event; its row keeps the keyboard.
    <section
      className="perf-panel"
      aria-label={STRINGS.region}
      data-slot="inspector.performance"
      data-phone={phone || undefined}
      data-testid="performance-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selected) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <VitalsStrip vitals={vitals} active={activeVital} onPick={pick} />
      <div className="perf-split" data-detail-open={selectedRow ? '' : undefined}>
        <PerformanceTable
          rows={rows}
          order={order}
          onOrder={setOrder}
          rowHeight={touch || phone ? ROW_HEIGHT.touch : ROW_HEIGHT.desktop}
          selected={selected}
          onSelect={select}
          onClose={close}
          empty={
            <EmptyState
              variant="compact"
              icon="filter"
              title={S.filteredTitle}
              actions={[{ id: 'all', label: S.showAll, primary: true, onSelect: () => setActiveVital(undefined) }]}
              chipsLabel={S.filterLabel}
              {...(vital ? { chips: [STRINGS.kinds(vital)] } : {})}
            />
          }
        />
        {selectedRow ? (
          <PerformanceDetail
            key={selectedRow.id}
            context={{
              row: selectedRow,
              model,
              lanes: laneData(sourceBundle, timeline),
              duration: player.duration,
              onSeek: player.seek,
              onOpen,
            }}
            onClose={close}
          />
        ) : null}
      </div>
    </section>
  );
}
