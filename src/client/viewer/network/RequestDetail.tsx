import { XIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { CopyButton } from '@/components/copy-button.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { formatClock, type ReplayStep } from '../../../shared/replay.ts';
import { entrySize, formatBytes } from '../../format.ts';
import { resolveSlot } from '../../plugins/registry.ts';
import type { SlotDescriptor } from '../../plugins/slots.ts';
import { formatDuration, hasMeasuredDuration, nearestStep, type NetworkRow } from './model.ts';

export const NETWORK_DETAIL_TABS_SLOT = 'inspector.network.detail.tabs';

export interface NetworkDetailContext {
  row: NetworkRow;
  steps: readonly ReplayStep[];
  /** When the first request started (source clock). */
  firstAt: number;
  onSeek: (at: number) => void;
}

export interface NetworkDetailTab {
  label: string;
  content: ReactNode;
}

export type NetworkDetailTabDescriptor = SlotDescriptor<NetworkDetailContext, NetworkDetailTab>;

const STRINGS = {
  region: 'Request details',
  close: 'Close request details',
  headers: 'Headers',
  timing: 'Timing',
  url: 'URL',
  copyUrl: 'Copy URL',
  request: 'Request headers',
  response: 'Response headers',
  none: 'None retained',
  bodies: 'Request and response bodies are not retained.',
  status: 'Status',
  method: 'Method',
  type: 'Content type',
  size: 'Size',
  noResponse: 'No response recorded',
  started: 'Started',
  duration: 'Duration',
  finished: 'Finished',
  source: 'Source start',
  visible: 'Visible in replay',
  afterFirst: 'After first request',
  step: 'Nearest step',
  unknown: 'Unknown',
  incomplete: 'Unknown: incomplete',
  notRecorded: 'Not recorded',
  firstRequest: 'First request',
  stepRelation: (delta: number, label: string) =>
    delta >= 0 ? `${formatDuration(delta)} after “${label}”` : `${formatDuration(-delta)} before “${label}”`,
  seek: (at: number) => `Jump to ${formatClock(at)}`,
};

function Fact({ label, children, title }: { label: string; children: ReactNode; title?: string | undefined }) {
  return (
    <div className="net-fact">
      <dt>{label}</dt>
      <dd title={title}>{children}</dd>
    </div>
  );
}

function HeaderList({ title, rows }: { title: string; rows: ReadonlyArray<{ name: string; value: string }> }) {
  const text = rows.map((row) => `${row.name}: ${row.value}`).join('\n');
  return (
    <section className="net-headers">
      <div className="net-detail-heading">
        <h3>
          {title}
          {rows.length ? <span className="net-count">{rows.length}</span> : null}
        </h3>
        {rows.length ? <CopyButton value={text} label={`Copy ${title.toLowerCase()}`} /> : null}
      </div>
      {rows.length ? (
        <dl className="net-header-list">
          {rows.map((row, index) => (
            <div key={`${row.name}-${index}`}>
              <dt>{row.name}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="net-muted">{STRINGS.none}</p>
      )}
    </section>
  );
}

function HeadersTab({ row }: { row: NetworkRow }) {
  const { entry } = row;
  const size = entrySize(entry);
  return (
    <div className="net-detail-body">
      <div className="net-detail-heading">
        <h3>{STRINGS.url}</h3>
        <CopyButton value={entry.url} label={STRINGS.copyUrl} />
      </div>
      <code className="net-url">{entry.url}</code>
      <dl className="net-facts">
        <Fact label={STRINGS.status}>{row.unanswered ? STRINGS.noResponse : `${entry.status || 'Error'} ${entry.statusText}`.trim()}</Fact>
        <Fact label={STRINGS.method}>{entry.method}</Fact>
        <Fact label={STRINGS.type}>{entry.mimeType ?? <span className="net-muted">{STRINGS.notRecorded}</span>}</Fact>
        <Fact label={STRINGS.size}>
          {size === undefined ? <span className="net-muted">{STRINGS.notRecorded}</span> : formatBytes(size)}
        </Fact>
      </dl>
      <HeaderList title={STRINGS.request} rows={entry.requestHeaders} />
      <HeaderList title={STRINGS.response} rows={entry.responseHeaders} />
      <p className="net-muted">{STRINGS.bodies}</p>
    </div>
  );
}

function TimingTab({ row, steps, firstAt, onSeek }: NetworkDetailContext) {
  const measured = hasMeasuredDuration(row);
  const step = nearestStep(steps, row.timing.sourceAt);
  return (
    <div className="net-detail-body">
      <dl className="net-facts">
        <Fact label={STRINGS.started}>
          <button type="button" className="net-seek" onClick={() => onSeek(row.at)} aria-label={STRINGS.seek(row.at)}>
            {formatClock(row.at)}
          </button>
        </Fact>
        <Fact label={STRINGS.duration}>
          {measured ? formatDuration(row.entry.duration) : row.unanswered ? STRINGS.incomplete : STRINGS.unknown}
        </Fact>
        <Fact label={STRINGS.finished}>{measured ? formatClock(row.end) : STRINGS.unknown}</Fact>
        <Fact label={STRINGS.afterFirst}>
          {row.timing.sourceAt > firstAt ? (
            `+${formatDuration(row.timing.sourceAt - firstAt)}`
          ) : (
            <span className="net-muted">{STRINGS.firstRequest}</span>
          )}
        </Fact>
        {row.timing.sourceAt !== row.at ? <Fact label={STRINGS.source}>{formatClock(row.timing.sourceAt)}</Fact> : null}
        {row.timing.visible !== undefined && row.timing.visible !== row.timing.measured ? (
          <Fact label={STRINGS.visible}>{formatDuration(row.timing.visible)}</Fact>
        ) : null}
      </dl>
      {step ? (
        <p className="net-step-relation">
          <span className="net-muted">{STRINGS.step}</span> {STRINGS.stepRelation(row.timing.sourceAt - step.at, step.label)}
        </p>
      ) : null}
    </div>
  );
}

export const BUILTIN_DETAIL_TABS: readonly NetworkDetailTabDescriptor[] = [
  { id: 'core:headers', order: 100, render: (context) => ({ label: STRINGS.headers, content: <HeadersTab row={context.row} /> }) },
  { id: 'core:timing', order: 200, render: (context) => ({ label: STRINGS.timing, content: <TimingTab {...context} /> }) },
];

/** The selected request, beside the table. Tabs come from `inspector.network.detail.tabs`. */
export function RequestDetail({ context, onClose }: { context: NetworkDetailContext; onClose: () => void }) {
  const tabs = resolveSlot<NetworkDetailContext, NetworkDetailTab>(NETWORK_DETAIL_TABS_SLOT, BUILTIN_DETAIL_TABS, context);
  const [tab, setTab] = useState(tabs[0]?.id);
  const current = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id;
  const { row } = context;
  return (
    <section className="net-detail" aria-label={STRINGS.region} data-testid="request-detail" data-slot="inspector.network.detail">
      <Tabs value={current} onValueChange={(value) => setTab(String(value))} className="net-detail-tabs gap-0">
        <div className="net-detail-bar">
          <TabsList variant="line" className="net-detail-tablist" data-slot="inspector.network.detail.tabs">
            {tabs.map((item) => (
              <TabsTrigger key={item.id} value={item.id} data-slot-item={item.id} className="net-detail-tab">
                {item.render(context).label}
              </TabsTrigger>
            ))}
          </TabsList>
          <span className="net-detail-title" title={row.entry.url}>
            <span className="net-status" data-status={row.status}>
              {row.unanswered ? STRINGS.noResponse : row.entry.status || 'ERR'}
            </span>
            <span className="net-detail-name">{`${row.name.tail || row.name.head}${row.name.query}`}</span>
          </span>
          <IconButton size="icon-sm" label={STRINGS.close} onClick={onClose} className="net-detail-close">
            <XIcon aria-hidden="true" />
          </IconButton>
        </div>
        {tabs.map((item) => (
          <TabsContent key={item.id} value={item.id} className="net-detail-panel">
            {item.render(context).content}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
