import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { formatClock, type ReplayBundle, type ReplayNetworkEntry, type ReplayPerformanceKind } from '../../shared/replay.ts';
import { buildPerformance, missingPerformanceLabel } from '../viewer/performance.ts';
import { performanceHasDuration } from '../viewer/waterfall.ts';
import type { ComparisonCoordinator, ComparisonSide } from './coordinator.ts';
import { type ComparisonError, sharedEventTime, SIDE_LABELS } from './model.ts';
import type { ComparisonPanel } from './preferences.ts';

type Bundles = Partial<Record<ComparisonSide, ReplayBundle>>;
export interface EvidenceProps {
  bundles: Bundles;
  offsetB: number;
  offsetA?: number;
  coordinator: ComparisonCoordinator;
  errors: ComparisonError[];
  selectedError: string | undefined;
  onError(error: ComparisonError): void;
  reveal(side: ComparisonSide): void;
}

function Jump({
  side,
  at,
  offsetB,
  offsetA = 0,
  coordinator,
  reveal,
}: Pick<EvidenceProps, 'offsetB' | 'offsetA' | 'coordinator' | 'reveal'> & {
  side: ComparisonSide;
  at: number;
}) {
  const horizon = useSyncExternalStore(coordinator.subscribe, () => coordinator.getSnapshot().duration);
  const shared = sharedEventTime(side, at, offsetB, offsetA);
  const outside = !Number.isFinite(shared) || shared < 0 || shared > horizon;
  return (
    <button
      className="cmp-jump"
      type="button"
      disabled={outside}
      onClick={() => {
        coordinator.seek(shared);
        reveal(side);
      }}
      title={
        outside
          ? 'Outside the shared timeline with this offset; adjust B offset to reach this event.'
          : `Seek both to ${formatClock(shared)}`
      }
    >
      {side.toUpperCase()} {formatClock(at)} local <span>{shared < 0 ? 'Before shared start' : `${formatClock(shared)} shared`}</span>
    </button>
  );
}

/** Paginate lists rather than creating thousands of diagnostic rows for two captures. */
function EvidenceList<T>({ items, children, empty }: { items: readonly T[]; children(item: T, index: number): ReactNode; empty: string }) {
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(items.length / 30) - 1);
  const current = Math.min(page, last);
  const start = current * 30;
  return (
    <>
      {items.length ? (
        <ol className="cmp-evidence-list" start={start + 1}>
          {items.slice(start, start + 30).map((item, index) => (
            <li key={start + index}>{children(item, start + index)}</li>
          ))}
        </ol>
      ) : (
        <p className="cmp-empty">{empty}</p>
      )}
      {last > 0 ? (
        <nav className="cmp-pagination" aria-label="Evidence pages">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span>
            {start + 1}–{Math.min(start + 30, items.length)} of {items.length}
          </span>
          <button type="button" disabled={current === last} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </nav>
      ) : null}
    </>
  );
}

function Sides({ bundles, children }: { bundles: Bundles; children(bundle: ReplayBundle, side: ComparisonSide): ReactNode }) {
  return (
    <div className="cmp-evidence-pair">
      {(['a', 'b'] as const).map((side) => (
        <section key={side} aria-label={`${SIDE_LABELS[side]} evidence`}>
          <h3>{SIDE_LABELS[side]}</h3>
          {bundles[side] ? children(bundles[side]!, side) : <p className="cmp-empty">Recording not available yet.</p>}
        </section>
      ))}
    </div>
  );
}

function RequestDetail({ entry }: { entry: ReplayNetworkEntry }) {
  return (
    <div className="cmp-request-detail">
      <p>
        <strong>
          {entry.method} {entry.url}
        </strong>
      </p>
      <dl>
        <dt>Status</dt>
        <dd>
          {entry.status || 'No HTTP response'} {entry.statusText}
        </dd>
        <dt>Captured duration</dt>
        <dd>{Number.isFinite(entry.duration) && entry.duration >= 0 ? `${entry.duration} ms` : 'Unknown'}</dd>
        <dt>Type</dt>
        <dd>{entry.mimeType || 'Not recorded'}</dd>
      </dl>
      {(['requestHeaders', 'responseHeaders'] as const).map((kind) => (
        <details key={kind}>
          <summary>{kind === 'requestHeaders' ? 'Request headers' : 'Response headers'}</summary>
          {entry[kind].length ? (
            <dl>
              {entry[kind].map((header, index) => (
                <div key={index}>
                  <dt>{header.name}</dt>
                  <dd>{header.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>No headers captured.</p>
          )}
        </details>
      ))}
    </div>
  );
}

export function EvidencePanel({ panel, ...props }: EvidenceProps & { panel: ComparisonPanel }) {
  if (panel === 'performance' || panel === 'paints') return <PerformanceEvidence {...props} paintsOnly={panel === 'paints'} />;
  if (panel === 'errors') return <ErrorEvidence {...props} />;
  return (
    <Sides bundles={props.bundles}>
      {(bundle, side) => {
        const jump = (at: number) => <Jump {...props} side={side} at={at} />;
        if (panel === 'journey')
          return (
            <>
              <p className="cmp-help">Captions follow recorded step labels on the original timeline.</p>
              <EvidenceList items={bundle.steps} empty="No steps or step captions recorded.">
                {(step) => (
                  <>
                    {jump(step.at)}
                    <div>
                      <strong>{step.label}</strong>
                      <p>
                        {step.kind}
                        {step.selector ? ` · ${step.selector}` : ''}
                      </p>
                    </div>
                  </>
                )}
              </EvidenceList>
            </>
          );
        if (panel === 'console')
          return (
            <EvidenceList items={bundle.console} empty="No console entries captured.">
              {(entry) => (
                <>
                  {jump(entry.at)}
                  <details>
                    <summary>
                      {entry.level} · {entry.message.slice(0, 160)}
                    </summary>
                    <pre>{entry.message}</pre>
                    {entry.url ? <p>{entry.url}</p> : null}
                  </details>
                </>
              )}
            </EvidenceList>
          );
        return (
          <EvidenceList items={bundle.network} empty="No network requests captured.">
            {(entry) => (
              <>
                {jump(entry.at)}
                <details>
                  <summary>
                    {entry.status || 'No response'} · {entry.method} {entry.url}
                  </summary>
                  <RequestDetail entry={entry} />
                </details>
              </>
            )}
          </EvidenceList>
        );
      }}
    </Sides>
  );
}

function ErrorEvidence({ errors, selectedError, onError, coordinator }: EvidenceProps) {
  const horizon = useSyncExternalStore(coordinator.subscribe, () => coordinator.getSnapshot().duration);
  const selected = errors.find((error) => error.id === selectedError);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (selectedError) heading.current?.focus();
  }, [selectedError]);
  return (
    <>
      <p className="cmp-help">
        Console errors and failed requests (HTTP 4xx/5xx or captured network failures). Times are mapped to the shared ruler.
      </p>
      {selected ? (
        <section className="cmp-selected-error" aria-label="Selected captured error">
          <h3 ref={heading} tabIndex={-1}>
            {selected.side.toUpperCase()} · {selected.label}
          </h3>
          <p>
            {formatClock(selected.at)} local · {selected.sharedAt < 0 ? 'Before shared start' : `${formatClock(selected.sharedAt)} shared`}
          </p>
          {selected.request ? <RequestDetail entry={selected.request} /> : <pre>{selected.consoleEntry?.message ?? selected.label}</pre>}
        </section>
      ) : null}
      <EvidenceList items={errors} empty="No console errors or failed requests captured in the available recordings.">
        {(error) => (
          <>
            <button
              className="cmp-jump"
              type="button"
              disabled={error.sharedAt < 0 || error.sharedAt > horizon}
              onClick={() => onError(error)}
              aria-pressed={error.id === selectedError}
            >
              {error.side.toUpperCase()} {formatClock(error.at)} local{' '}
              <span>{error.sharedAt < 0 ? 'Before shared start' : `${formatClock(error.sharedAt)} shared`}</span>
            </button>
            <span>{error.label}</span>
          </>
        )}
      </EvidenceList>
    </>
  );
}

const SIGNAL_KINDS: readonly { kind: ReplayPerformanceKind; api: string; label: string }[] = [
  { kind: 'first-contentful-paint', api: 'paint', label: 'First contentful paint' },
  { kind: 'largest-contentful-paint', api: 'largest-contentful-paint', label: 'Largest contentful paint candidates' },
  { kind: 'long-task', api: 'longtask', label: 'Long tasks' },
  { kind: 'slow-interaction', api: 'event', label: 'Slow interactions' },
];

function PerformanceEvidence(props: EvidenceProps & { paintsOnly: boolean }) {
  return (
    <>
      <p className="cmp-help">
        Captured observations only. Paint values are measured from navigation start; task and interaction values are captured durations. No
        historical FPS track is available. These observations do not establish causation.
      </p>
      <Sides bundles={props.bundles}>{(bundle, side) => <PerformanceSide {...props} bundle={bundle} side={side} />}</Sides>
    </>
  );
}

function PerformanceSide({
  bundle,
  side,
  paintsOnly,
  offsetB,
  offsetA = 0,
  coordinator,
  reveal,
}: EvidenceProps & {
  bundle: ReplayBundle;
  side: ComparisonSide;
  paintsOnly: boolean;
}) {
  const model = useMemo(() => buildPerformance(bundle), [bundle]);
  const horizon = useSyncExternalStore(coordinator.subscribe, () => coordinator.getSnapshot().duration);
  const kinds = paintsOnly ? SIGNAL_KINDS.slice(0, 2) : SIGNAL_KINDS;
  const rows = model.signals.filter((row) => kinds.some(({ kind }) => kind === row.entry.kind));
  return (
    <>
      <dl className="cmp-observations">
        {kinds.map(({ kind, api, label }) => {
          const signals = model.signals.filter((row) => row.entry.kind === kind);
          return (
            <div key={kind}>
              <dt>{label}</dt>
              <dd>{signals.length ? `${signals.length} captured` : missingPerformanceLabel(model, api, kind)}</dd>
            </div>
          );
        })}
      </dl>
      <div className="cmp-lanes" aria-label={`${side.toUpperCase()} captured observations on shared elapsed ruler`}>
        {kinds.map(({ kind, label }) => {
          const signals = rows.filter((row) => row.entry.kind === kind && row.timing !== 'invalid');
          const visible = signals.filter(
            (row) =>
              sharedEventTime(side, row.at, offsetB, offsetA) <= horizon &&
              sharedEventTime(side, row.segments.at(-1)?.to ?? row.at, offsetB, offsetA) >= 0,
          );
          return (
            <div className="cmp-lane" key={kind}>
              <span>{label}</span>
              <div className="cmp-lane-track" aria-hidden="true">
                {visible.slice(0, 120).map((row) => {
                  const from = Math.max(0, sharedEventTime(side, row.at, offsetB, offsetA));
                  const end = Math.min(horizon, sharedEventTime(side, row.segments.at(-1)?.to ?? row.at, offsetB, offsetA));
                  return (
                    <i
                      key={row.id}
                      data-kind={kind}
                      style={{
                        left: `${(100 * from) / Math.max(1, horizon)}%`,
                        width: `${(100 * Math.max(0, end - from)) / Math.max(1, horizon)}%`,
                      }}
                    />
                  );
                })}
              </div>
              {visible.length > 120 ? <small>{visible.length - 120} bars omitted; all events listed below.</small> : null}
            </div>
          );
        })}
        <p className="cmp-help">0 → {formatClock(horizon)} shared elapsed. B lanes use the visible offset. Use the event list to seek.</p>
      </div>
      <EvidenceList items={rows} empty="No matching performance observations captured.">
        {(row) => (
          <>
            <Jump side={side} at={row.at} offsetB={offsetB} offsetA={offsetA} coordinator={coordinator} reveal={reveal} />
            <span>
              {row.label}
              {row.entry.eventType ? ` · ${row.entry.eventType}` : ''}
              <strong className="cmp-observation-value">
                {row.timing === 'invalid'
                  ? 'Invalid / unknown'
                  : `${row.entry.value} ms ${performanceHasDuration(row.entry.kind) ? 'duration' : 'from navigation start'}`}
              </strong>
            </span>
          </>
        )}
      </EvidenceList>
    </>
  );
}
