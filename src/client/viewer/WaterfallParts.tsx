import type { ReactNode, RefObject } from 'react';
import { formatClock, type ReplayNetworkEntry } from '../../shared/replay.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { durationLabel, performanceHasDuration, rowDuration, validDuration, type WaterfallRow } from './waterfall.ts';

export function WaterfallDetails({
  selected,
  detailRef,
  id,
  close,
  renderRequestDetail,
}: {
  selected: WaterfallRow | undefined;
  detailRef: RefObject<HTMLElement | null>;
  id: string;
  close: () => void;
  renderRequestDetail: (entry: ReplayNetworkEntry) => ReactNode;
}) {
  let content: ReactNode = null;
  if (selected)
    content = (
      <>
        <div className="wf-detail-heading">
          <h2 title={selected.label}>{selected.label}</h2>
          <button type="button" className="wf-clear" onClick={close}>
            Close details
          </button>
        </div>
        <p className="wf-note">
          Replay position {formatClock(selected.at)} · Source start {formatClock(selected.sourceAt)} · {rowDuration(selected)}
          {selected.visible !== undefined ? ` · ${durationLabel(selected.visible)} visible in replay` : ''}
          {selected.segments.length > 1 ? ` · ${selected.segments.length} pieces across edits` : ''}
        </p>
        {selected.kind === 'network' ? renderRequestDetail(selected.entry) : <WaterfallFacts row={selected} />}
      </>
    );
  return (
    <section
      ref={detailRef}
      id={id}
      className="wf-detail"
      aria-label="Selected waterfall event"
      // The independent scroll region must be reachable for native keyboard scrolling.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      hidden={!selected}
    >
      {content}
    </section>
  );
}

function WaterfallFacts({ row }: { row: Exclude<WaterfallRow, { kind: 'network' }> }) {
  return (
    <dl className="wf-facts">
      <dt>Kind</dt>
      <dd>{row.entry.kind}</dd>
      {row.kind === 'action' ? (
        <>
          <dt>Action</dt>
          <dd>{row.entry.label}</dd>
          {row.entry.selector ? (
            <>
              <dt>Target</dt>
              <dd>
                <code>{row.entry.selector}</code>
              </dd>
            </>
          ) : null}
          {row.entry.url ? (
            <>
              <dt>URL</dt>
              <dd>{row.entry.url}</dd>
            </>
          ) : null}
        </>
      ) : (
        <>
          <dt>{performanceHasDuration(row.entry.kind) ? 'Measured duration' : 'Metric timestamp from navigation'}</dt>
          <dd>{validDuration(row.entry.value) ? durationLabel(row.entry.value) : 'Invalid value'}</dd>
          {row.entry.eventType ? (
            <>
              <dt>Event</dt>
              <dd>{row.entry.eventType}</dd>
            </>
          ) : null}
        </>
      )}
    </dl>
  );
}

export function WaterfallSeek() {
  const player = usePlayer();
  const time = usePlayhead();
  return (
    <input
      className="wf-seek"
      aria-label="Waterfall replay position"
      type="range"
      min={0}
      max={player.duration}
      step={1}
      value={time}
      aria-valuetext={formatClock(time)}
      onChange={(event) => player.seek(Number(event.target.value))}
    />
  );
}

export function WaterfallPlayhead() {
  const player = usePlayer();
  const time = usePlayhead();
  return (
    <div className="wf-playhead-lane" aria-hidden="true">
      <span
        className="wf-playhead"
        data-testid="waterfall-playhead"
        style={{ left: `${Math.max(0, Math.min(100, (time / player.duration) * 100))}%` }}
      />
    </div>
  );
}
