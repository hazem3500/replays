import { formatClock, type ReplayCaptured, type ReplayStep } from '../../../shared/replay.ts';
import { copyText } from '../../clipboard.ts';
import { CopyButton } from '@/components/copy-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import { entrySize, formatBytes } from '../../format.ts';
import { useViewer } from '../context.ts';
import { LocalTimeline } from '../LocalTimeline.tsx';
import { curlCommand, formatDuration, matchRequest, medianMeasured, neighbours, type NetworkRow, stepAt } from './model.ts';
import { REQUEST_DETAIL_ID, StatusText } from './NetworkList.tsx';
import { DetailHead } from './DetailHead.tsx';
import { BodySection } from './BodySection.tsx';
import { HeaderList } from './HeaderList.tsx';

/** Another recording being compared (compare mode): its short name, colour (1 to 9), title and requests. */
export interface NetworkPeer {
  id: string;
  name: string;
  colour: number;
  label: string;
  rows: readonly NetworkRow[];
}

const STRINGS = {
  region: (method: string, path: string) => `Request ${method} ${path}`,
  close: 'Close request',
  copyUrl: 'Copy URL',
  copyCurl: 'Copy as cURL',
  copiedCurl: 'Copied as cURL',
  copyFailed: 'Could not copy to the clipboard',
  took: 'Took',
  unknown: 'Unknown: no response was recorded',
  versusMedian: (ratio: string, median: number) => `${ratio} the median request (${formatDuration(median)})`,
  started: 'Started',
  sourceStart: (at: number) => `${formatClock(at)} in the original recording`,
  during: 'During',
  after: (ms: number) => `${formatDuration(ms)} after it began`,
  before: (ms: number) => `${formatDuration(ms)} before it began`,
  type: 'Type',
  size: 'Size',
  notRecorded: 'Not recorded',
  around: 'Around this request',
  more: (count: number) => `${count} more in flight`,
  peers: 'In the other recordings',
  peerMissing: 'Not requested',
  peerTook: (ms: number) => `in ${formatDuration(ms)}`,
};

function ratioLabel(ratio: number) {
  if (ratio >= 1.5) return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}× slower than`;
  if (ratio <= 0.67) return `${(1 / ratio).toFixed(1)}× faster than`;
  return 'About';
}

/**
 * The selected request: what it was and how it went, the step it belongs to, what else was in flight on its own scale,
 * how the same call went in compared recordings, then the retained headers. Beside the list, or in its place when
 * the panel is narrow (`stacked`).
 */
export function RequestDetail({
  row,
  rows,
  steps,
  peers,
  stacked,
  captured,
  onSelect,
}: {
  row: NetworkRow;
  /** Every request in the recording, unfiltered: the neighbourhood and the median come from all of them. */
  rows: readonly NetworkRow[];
  steps: readonly ReplayStep[];
  peers: readonly NetworkPeer[];
  stacked: boolean;
  /** What the recording kept (`meta.captured`): a body section says "Not captured" rather than drawing nothing. */
  captured: ReplayCaptured | undefined;
  onSelect: (id?: string) => void;
}) {
  const close = () => {
    onSelect();
    requestAnimationFrame(() => document.getElementById(`request-switch-${row.id}`)?.focus());
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: Escape anywhere in the open detail closes it and returns focus to its row.
    <section
      id={REQUEST_DETAIL_ID}
      className="np-detail"
      data-testid="request-detail"
      aria-label={STRINGS.region(row.entry.method, row.name.path)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
      }}
    >
      <DetailHead at={row.at} stacked={stacked} closeLabel={STRINGS.close} onClose={close}>
        <StatusText row={row} />
        {row.entry.statusText ? <span>{row.entry.statusText}</span> : null}
      </DetailHead>
      <RequestUrl row={row} />
      <Facts row={row} rows={rows} steps={steps} />
      {peers.length ? <PeerResults row={row} peers={peers} /> : null}
      <BodySection title="Request body" body={row.entry.requestBody} mimeType={headerType(row.entry.requestHeaders)} captured={captured} />
      <BodySection title="Response body" body={row.entry.responseBody} mimeType={row.entry.mimeType} captured={captured} />
      <Around row={row} rows={rows} onSelect={onSelect} />
      <div className="np-headers">
        <HeaderList title="Request headers" rows={row.entry.requestHeaders} />
        <HeaderList title="Response headers" rows={row.entry.responseHeaders} />
      </div>
    </section>
  );
}

/** The request's own content type, from its retained headers. */
function headerType(headers: ReadonlyArray<{ name: string; value: string }>) {
  return headers.find((header) => header.name.toLowerCase() === 'content-type')?.value;
}

function RequestUrl({ row }: { row: NetworkRow }) {
  const { notify } = useViewer();
  return (
    <div className="np-url">
      <code>
        <span className="method">{row.entry.method}</span> {row.name.host ? <span className="np-host">{row.name.host}</span> : null}
        {row.name.path}
        {row.name.query ? <span className="np-query">{row.name.query}</span> : null}
      </code>
      <span className="np-url-actions">
        <CopyButton value={row.entry.url} label={STRINGS.copyUrl} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copyText(curlCommand(row.entry)).then((ok) => notify(ok ? STRINGS.copiedCurl : STRINGS.copyFailed))}
        >
          {STRINGS.copyCurl}
        </Button>
      </span>
    </div>
  );
}

function Facts({ row, rows, steps }: { row: NetworkRow; rows: readonly NetworkRow[]; steps: readonly ReplayStep[] }) {
  const median = medianMeasured(rows);
  const step = stepAt(steps, row.at);
  const size = entrySize(row.entry);
  const edited = Math.abs(row.entry.at - row.at) >= 1;
  return (
    <dl className="np-facts">
      <dt>{STRINGS.took}</dt>
      <dd>
        {row.measured === undefined ? STRINGS.unknown : <strong>{formatDuration(row.measured)}</strong>}
        {row.measured !== undefined && median && rows.length > 2 ? (
          <span className="np-aside">{STRINGS.versusMedian(ratioLabel(row.measured / median), median)}</span>
        ) : null}
      </dd>
      <dt>{STRINGS.started}</dt>
      <dd>
        {formatClock(row.at)}
        {edited ? <span className="np-aside">{STRINGS.sourceStart(row.entry.at)}</span> : null}
      </dd>
      {step ? (
        <>
          <dt>{STRINGS.during}</dt>
          <dd>
            {step.label}
            <span className="np-aside">{row.at >= step.at ? STRINGS.after(row.at - step.at) : STRINGS.before(step.at - row.at)}</span>
          </dd>
        </>
      ) : null}
      <dt>{STRINGS.type}</dt>
      <dd>{row.entry.mimeType ?? STRINGS.notRecorded}</dd>
      <dt>{STRINGS.size}</dt>
      <dd>{size === undefined ? STRINGS.notRecorded : formatBytes(size)}</dd>
    </dl>
  );
}

function PeerResults({ row, peers }: { row: NetworkRow; peers: readonly NetworkPeer[] }) {
  return (
    <section className="np-section" aria-label={STRINGS.peers}>
      <h3>{STRINGS.peers}</h3>
      <ul className="np-peers">
        {peers.map((peer) => {
          const match = matchRequest(row, peer.rows);
          return (
            <li key={peer.id} data-changed={match && match.failed !== row.failed ? '' : undefined}>
              <span className="np-peer-label" data-tile={peer.colour} title={peer.label}>
                <span className="ct-swatch" aria-hidden="true" />
                {peer.name}
              </span>
              <span className="np-peer-result">
                {match ? (
                  <>
                    <StatusText row={match} /> {match.measured === undefined ? STRINGS.unknown : STRINGS.peerTook(match.measured)}
                  </>
                ) : (
                  STRINGS.peerMissing
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Around({ row, rows, onSelect }: { row: NetworkRow; rows: readonly NetworkRow[]; onSelect: (id: string) => void }) {
  const near = neighbours(row, rows);
  if (near.rows.length < 2) return null;
  const items = near.rows.map((other) => ({
    id: other.id,
    label: `${other.entry.method} ${other.name.path}`,
    at: other.at,
    end: Math.max(other.end, other.at),
    tone: other.failed ? ('danger' as const) : undefined,
    current: other.id === row.id,
    value: other.measured === undefined ? '?' : formatDuration(other.measured),
  }));
  return (
    <section className="np-section">
      <h3>
        {STRINGS.around}
        {near.more > 0 ? <span className="np-aside">{STRINGS.more(near.more)}</span> : null}
      </h3>
      <LocalTimeline from={near.from} to={near.to} origin={row.at} items={items} label={STRINGS.around} onPick={onSelect} />
    </section>
  );
}
