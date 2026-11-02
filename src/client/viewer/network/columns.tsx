import type { ReactNode } from 'react';

import { resolveSlot } from '../../plugins/registry.ts';
import type { SlotDescriptor } from '../../plugins/slots.ts';
import type { TimeDomain, TimeScale } from '../time-axis.ts';
import { formatDuration, hasMeasuredDuration, type NetworkRow, type RequestType } from './model.ts';
import { TimingCell, TimingRuler } from './timing.tsx';

export const NETWORK_COLUMNS_SLOT = 'inspector.network.columns';

/** What every column sees when the table resolves its columns. */
export interface NetworkTableContext {
  showTiming: boolean;
  /** Phones: the table stacks into two-line rows; columns may opt out. */
  compact: boolean;
  /** The Timing column's axis, in percent (width 100), on the (possibly zoomed) domain. */
  scale: TimeScale;
  bounds: TimeDomain;
  onZoom: (domain: TimeDomain | undefined) => void;
}

/** One column. A host adds one (e.g. "Trace id") by registering a descriptor whose `render` returns this. */
export interface NetworkColumnSpec {
  label: string;
  /** A CSS grid track, ideally a custom property (`var(--net-col-type)`). */
  width: string;
  align?: 'start' | 'end';
  /** Sortable when present. */
  sortValue?: (row: NetworkRow) => number | string;
  /** Replaces the plain label in the header. */
  header?: () => ReactNode;
  cell: (row: NetworkRow) => ReactNode;
}

export type NetworkColumnDescriptor = SlotDescriptor<NetworkTableContext, NetworkColumnSpec>;

const STRINGS = {
  state: 'State',
  method: 'Method',
  name: 'Name',
  status: 'Status',
  type: 'Type',
  duration: 'Duration',
  timing: 'Timing',
  noResponse: 'No response recorded: a redirect hop, or still in flight when capture stopped',
  error: 'ERR',
  noResponseShort: 'No response',
  unknown: 'Unknown',
  types: {
    document: 'document',
    fetch: 'fetch',
    xhr: 'xhr',
    script: 'script',
    stylesheet: 'stylesheet',
    image: 'image',
    font: 'font',
    other: 'other',
  } satisfies Record<RequestType, string>,
  statusWord: {
    ok: 'OK',
    redirect: 'Redirect',
    'client-error': 'Client error',
    'server-error': 'Server error',
    failed: 'Failed',
    pending: 'No response',
  },
};

function NameCell({ row }: { row: NetworkRow }) {
  const { host, head, tail, query } = row.name;
  return (
    <span className="net-name" title={row.entry.url}>
      {host ? <span className="net-name-host">{host}</span> : null}
      <span className="net-name-head">{head}</span>
      <span className="net-name-tail">{tail}</span>
      {query ? <span className="net-name-query">{query}</span> : null}
    </span>
  );
}

function StatusCell({ row }: { row: NetworkRow }) {
  if (row.unanswered)
    return (
      <span className="net-status" data-status="pending" title={STRINGS.noResponse}>
        <span className="visually-hidden">{STRINGS.noResponseShort}</span>
      </span>
    );
  return (
    <span className="net-status" data-status={row.status} title={row.entry.statusText || undefined}>
      {row.entry.status || STRINGS.error}
    </span>
  );
}

export const BUILTIN_NETWORK_COLUMNS: readonly NetworkColumnDescriptor[] = [
  {
    id: 'core:state',
    order: 100,
    render: () => ({
      label: STRINGS.state,
      width: 'var(--net-col-dot)',
      header: () => <span className="visually-hidden">{STRINGS.state}</span>,
      cell: (row) => <span className="net-dot" data-status={row.status} role="img" aria-label={STRINGS.statusWord[row.status]} />,
    }),
  },
  {
    id: 'core:method',
    order: 200,
    render: () => ({
      label: STRINGS.method,
      width: 'var(--net-col-method)',
      sortValue: (row) => row.entry.method,
      cell: (row) => <span className="net-method">{row.entry.method}</span>,
    }),
  },
  {
    id: 'core:name',
    order: 300,
    render: () => ({
      label: STRINGS.name,
      width: 'var(--net-col-name)',
      sortValue: (row) => `${row.name.head}${row.name.tail}`,
      cell: (row) => <NameCell row={row} />,
    }),
  },
  {
    id: 'core:status',
    order: 400,
    render: () => ({
      label: STRINGS.status,
      width: 'var(--net-col-status)',
      sortValue: (row) => (row.unanswered ? -1 : row.entry.status),
      cell: (row) => <StatusCell row={row} />,
    }),
  },
  {
    id: 'core:type',
    order: 500,
    when: (context) => !context.compact,
    render: () => ({
      label: STRINGS.type,
      width: 'var(--net-col-type)',
      sortValue: (row) => row.type,
      cell: (row) => <span className="net-type">{STRINGS.types[row.type]}</span>,
    }),
  },
  {
    id: 'core:duration',
    order: 600,
    render: () => ({
      label: STRINGS.duration,
      width: 'var(--net-col-duration)',
      align: 'end',
      sortValue: (row) => (hasMeasuredDuration(row) ? row.entry.duration : -1),
      cell: (row) => (
        <span className="net-duration">
          {hasMeasuredDuration(row) ? formatDuration(row.entry.duration) : <span className="net-muted">{STRINGS.unknown}</span>}
        </span>
      ),
    }),
  },
  {
    id: 'core:timing',
    order: 700,
    when: (context) => context.showTiming && !context.compact,
    render: (context) => ({
      label: STRINGS.timing,
      width: 'var(--net-col-timing)',
      header: () => <TimingRuler domain={context.scale.domain} bounds={context.bounds} onZoom={context.onZoom} />,
      cell: (row) => <TimingCell row={row} scale={context.scale} />,
    }),
  },
];

/** Built-ins merged with host/plugin columns, honouring hide/order configuration. */
export function resolveNetworkColumns(context: NetworkTableContext) {
  return resolveSlot<NetworkTableContext, NetworkColumnSpec>(NETWORK_COLUMNS_SLOT, BUILTIN_NETWORK_COLUMNS, context).map((descriptor) => ({
    id: descriptor.id,
    spec: descriptor.render(context),
  }));
}
