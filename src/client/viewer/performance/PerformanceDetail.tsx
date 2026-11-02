import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import { BUDGET_FOR_KIND, DEFAULT_BUDGETS } from '../../../shared/diagnostics/budgets.ts';
import { ms } from '../../../shared/diagnostics/detect.ts';
import type { EvidenceRef } from '../../../shared/diagnostics/types.ts';
import { formatClock, type ReplayPerformanceKind } from '../../../shared/replay.ts';
import type { InspectorPerformanceRow } from '../../data/inspector.ts';
import { resolveSlot } from '../../plugins/registry.ts';
import type { SlotDescriptor } from '../../plugins/slots.ts';
import { EvidenceLanes } from '../issues/EvidenceLanes.tsx';
import type { LaneData } from '../issues/evidence.ts';
import { relatedPerformanceActivity, type PerformanceModel } from '../performance.ts';
import type { WaterfallRow } from '../waterfall.ts';
import { BudgetBar } from './BudgetBar.tsx';
import { eventName } from './PerformanceTable.tsx';
import { VERDICT_WORD } from './VitalsStrip.tsx';

export const PERFORMANCE_SECTIONS_SLOT = 'performance.detail.sections';

export interface PerformanceDetailContext {
  row: InspectorPerformanceRow;
  model: PerformanceModel;
  lanes: LaneData;
  duration: number;
  onSeek: (at: number) => void;
  onOpen: (ref: EvidenceRef) => void;
}

export interface PerformanceSection {
  title?: string;
  content: ReactNode;
}

export type PerformanceSectionDescriptor = SlotDescriptor<PerformanceDetailContext, PerformanceSection>;

const STRINGS = {
  region: 'Selected performance event',
  close: 'Close event details',
  meaning: {
    'long-task': 'A long task blocks the main thread for more than 50 ms; input and rendering wait.',
    'slow-interaction': 'Time from the input to the next paint. Over 200 ms feels sluggish.',
    'largest-contentful-paint': 'When the largest element in view painted: the main content showed up.',
    'first-contentful-paint': 'When the first text or image painted: the page stopped being blank.',
  } satisfies Record<ReplayPerformanceKind, string>,
  budget: (good: number, poor: number) => `Good at ${good} ms or less · poor over ${poor} ms`,
  happening: 'What was happening',
  window: '±1 s',
  overlapping: 'Requests at the same time',
  nearby: 'Actions within 0.5 s',
  none: 'Nothing else was captured around it.',
  jump: (at: number) => `Jump to ${formatClock(at)}`,
  attribution: {
    'long-task': 'Script attribution was not recorded.',
    'slow-interaction': 'The element and the phase breakdown were not recorded.',
    'largest-contentful-paint': 'The painted element was not recorded. This is the latest candidate, not a final Web Vitals score.',
    'first-contentful-paint': 'A paint milestone since navigation, not a task duration.',
  } satisfies Record<ReplayPerformanceKind, string>,
};

const indexOf = (id: string) => Number(id.slice(id.lastIndexOf('-') + 1));

function RelatedList({
  title,
  rows,
  onOpen,
  onSeek,
}: {
  title: string;
  rows: readonly WaterfallRow[];
  onOpen: (ref: EvidenceRef) => void;
  onSeek: (at: number) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="perf-related">
      <h4>{title}</h4>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="perf-related-row"
              data-mono={row.kind === 'network' || undefined}
              onClick={() => (row.kind === 'network' ? onOpen({ kind: 'request', id: row.entry.id }) : onSeek(row.at))}
            >
              <span>{row.label}</span>
              <span className="perf-related-time">{formatClock(row.at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const BUILTIN_SECTIONS: readonly PerformanceSectionDescriptor[] = [
  {
    id: 'core:meaning',
    order: 100,
    render: ({ row }) => {
      const budget = DEFAULT_BUDGETS[BUDGET_FOR_KIND[row.performanceKind]];
      return {
        content: (
          <>
            <p className="perf-meaning">{STRINGS.meaning[row.performanceKind]}</p>
            {row.verdict ? (
              <div className="perf-against">
                <span className="perf-against-value" data-verdict={row.verdict}>
                  {ms(row.entry.value)} · {VERDICT_WORD[row.verdict]}
                </span>
                <BudgetBar value={row.entry.value} budget={budget} verdict={row.verdict} size="large" />
                <span className="perf-against-budget">{STRINGS.budget(budget[0], budget[1])}</span>
              </div>
            ) : null}
          </>
        ),
      };
    },
  },
  {
    id: 'core:happening',
    order: 200,
    render: ({ row, model, lanes, duration, onSeek, onOpen }) => {
      const end = row.segments.at(-1)?.to ?? row.at;
      const window = { from: Math.max(0, row.at - 1000), to: Math.min(Math.max(duration, end), end + 1000) };
      const activity = relatedPerformanceActivity(row, model.rows);
      const requests = activity.overlapping.filter((other) => other.kind === 'network');
      const index = indexOf(row.id);
      return {
        title: STRINGS.happening,
        content: (
          <>
            <EvidenceLanes
              data={lanes}
              window={window}
              focus={{ from: row.at, to: end }}
              isLinked={(ref) => ref.kind === 'performance' && ref.index === index}
              onOpen={onOpen}
            />
            <RelatedList title={STRINGS.overlapping} rows={requests} onOpen={onOpen} onSeek={onSeek} />
            <RelatedList title={STRINGS.nearby} rows={activity.nearbyActions} onOpen={onOpen} onSeek={onSeek} />
            {!requests.length && !activity.nearbyActions.length ? <p className="perf-quiet">{STRINGS.none}</p> : null}
          </>
        ),
      };
    },
  },
  {
    id: 'core:attribution',
    order: 300,
    render: ({ row }) => ({ content: <p className="perf-quiet">{STRINGS.attribution[row.performanceKind]}</p> }),
  },
];

export function PerformanceDetail({ context, onClose }: { context: PerformanceDetailContext; onClose: () => void }) {
  const sections = resolveSlot<PerformanceDetailContext, PerformanceSection>(PERFORMANCE_SECTIONS_SLOT, BUILTIN_SECTIONS, context);
  const { row } = context;
  return (
    <section className="perf-detail" aria-label={STRINGS.region} data-slot={PERFORMANCE_SECTIONS_SLOT} data-testid="performance-detail">
      <div className="perf-detail-bar">
        <h3>
          <span className="perf-dot" data-verdict={row.verdict} aria-hidden="true" />
          {eventName(row)}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => context.onSeek(row.at)}>
          {STRINGS.jump(row.at)}
        </Button>
        <IconButton size="icon-sm" label={STRINGS.close} onClick={onClose}>
          <XIcon aria-hidden="true" />
        </IconButton>
      </div>
      <div className="perf-detail-body">
        {sections.map((descriptor) => {
          const section = descriptor.render(context);
          return (
            <div key={descriptor.id} className="perf-section" data-slot-item={descriptor.id}>
              {section.title ? (
                <h4 className="perf-section-title">
                  {section.title} {descriptor.id === 'core:happening' ? <span>{STRINGS.window}</span> : null}
                </h4>
              ) : null}
              {section.content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
