import { useRef, type CSSProperties, type ReactNode } from 'react';

import type { EvidenceRef } from '../../../shared/diagnostics/types.ts';
import { formatClock } from '../../../shared/replay.ts';
import { usePlayheadProperty } from '../../hooks/use-playhead-property.ts';
import { resolveSlot } from '../../plugins/registry.ts';
import type { SlotDescriptor } from '../../plugins/slots.ts';
import { spanPercent, timeScale, type TimeDomain, type TimeScale } from '../time-axis.ts';
import type { LaneData } from './evidence.ts';

export const ISSUE_LANES_SLOT = 'inspector.issues.lanes';

export interface LaneContext {
  /** Rows that belong to what is being explained, drawn emphasised. */
  isLinked: (ref: EvidenceRef) => boolean;
  data: LaneData;
  scale: TimeScale;
  onOpen: (ref: EvidenceRef) => void;
}

export interface Lane {
  label: string;
  content: ReactNode;
}

export type LaneDescriptor = SlotDescriptor<LaneContext, Lane>;

const STRINGS = {
  region: 'What was happening, one second either side',
  steps: 'Steps',
  network: 'Network',
  console: 'Console',
  main: 'Main thread',
  noMain: 'Not captured',
  task: (value: number) => `Long task · ${Math.round(value)} ms`,
  interaction: (type: string | undefined, value: number) => `Interaction ${type ?? ''} · ${Math.round(value)} ms`,
  request: (method: string, url: string, status: number) => `${method} ${url} · ${status || 'ERR'}`,
};
/** Requests stack into at most this many rows so concurrency shows without the lane growing. */
const NETWORK_ROWS = 3;

const visible = (scale: TimeScale, from: number, to = from) => to >= scale.domain.from && from <= scale.domain.to;
const at = (scale: TimeScale, ms: number) =>
  ({ '--lane-x': `${Math.max(0, Math.min(100, (scale.x(ms) / scale.width) * 100))}%` }) as CSSProperties;
const span = (scale: TimeScale, from: number, to: number, extra: Record<string, string> = {}) => {
  const { left, width } = spanPercent(scale, from, to);
  return { '--lane-x': `${left}%`, '--lane-width': `${width}%`, ...extra } as CSSProperties;
};

export const BUILTIN_LANES: readonly LaneDescriptor[] = [
  {
    id: 'core:steps',
    order: 100,
    render: ({ isLinked, data, scale, onOpen }) => {
      const shown = data.steps.filter((row) => visible(scale, row.at));
      // why: only the first linked step (the action that led to it) is named; a second label would collide with it.
      const named = shown.find((row) => isLinked({ kind: 'step', index: Number(row.id.slice(7)) }))?.id;
      return {
        label: STRINGS.steps,
        content: shown.map((row) => {
          const ref: EvidenceRef = { kind: 'step', index: Number(row.id.slice(7)) };
          const mine = isLinked(ref);
          return (
            <button
              key={row.id}
              type="button"
              className="lane-step"
              data-linked={mine || undefined}
              style={at(scale, row.at)}
              title={row.entry.label}
              onClick={() => onOpen(ref)}
            >
              {row.id === named ? <span>{row.entry.label}</span> : null}
            </button>
          );
        }),
      };
    },
  },
  {
    id: 'core:network',
    order: 200,
    render: ({ isLinked, data, scale, onOpen }) => {
      const rows: number[] = [];
      return {
        label: STRINGS.network,
        content: data.requests
          .filter((row) => visible(scale, row.at, row.end))
          .map((row) => {
            let lane = rows.findIndex((end) => end <= row.at);
            if (lane < 0) lane = rows.length < NETWORK_ROWS ? rows.push(0) - 1 : NETWORK_ROWS - 1;
            rows[lane] = row.end;
            const ref: EvidenceRef = { kind: 'request', id: row.entry.id };
            return (
              <button
                key={row.id}
                type="button"
                className="lane-bar"
                data-failed={row.failed || undefined}
                data-linked={isLinked(ref) || undefined}
                style={span(scale, row.at, row.end, { '--lane-row': String(lane) })}
                title={STRINGS.request(row.entry.method, row.entry.url, row.entry.status)}
                onClick={() => onOpen(ref)}
              />
            );
          }),
      };
    },
  },
  {
    id: 'core:console',
    order: 300,
    render: ({ isLinked, data, scale, onOpen }) => ({
      label: STRINGS.console,
      content: data.console
        .filter((row) => visible(scale, row.at))
        .map((row) => {
          const ref: EvidenceRef = { kind: 'console', index: row.index };
          return (
            <button
              key={row.index}
              type="button"
              className="lane-dot"
              data-level={row.level}
              data-linked={isLinked(ref) || undefined}
              style={at(scale, row.at)}
              title={row.message}
              onClick={() => onOpen(ref)}
            />
          );
        }),
    }),
  },
  {
    id: 'core:main',
    order: 400,
    render: ({ isLinked, data, scale, onOpen }) => {
      const rows = data.main.filter(
        (row) => (row.entry.kind === 'long-task' || row.entry.kind === 'slow-interaction') && visible(scale, row.at, row.end),
      );
      return {
        label: STRINGS.main,
        content: rows.length ? (
          rows.map((row) => {
            const ref: EvidenceRef = { kind: 'performance', index: row.index };
            return (
              <button
                key={row.id}
                type="button"
                className="lane-bar"
                data-kind={row.entry.kind}
                data-verdict={row.verdict}
                data-linked={isLinked(ref) || undefined}
                style={span(scale, row.at, row.end)}
                title={
                  row.entry.kind === 'long-task' ? STRINGS.task(row.entry.value) : STRINGS.interaction(row.entry.eventType, row.entry.value)
                }
                onClick={() => onOpen(ref)}
              />
            );
          })
        ) : data.main.length === 0 ? (
          <span className="lane-none">{STRINGS.noMain}</span>
        ) : null,
      };
    },
  },
];

/** Steps, network, console and main thread on one axis, cut to a moment's neighbourhood (`window`), `focus` highlighted. */
export function EvidenceLanes({
  data,
  window,
  focus,
  isLinked,
  onOpen,
}: {
  data: LaneData;
  window: TimeDomain;
  focus: TimeDomain;
  isLinked: (ref: EvidenceRef) => boolean;
  onOpen: (ref: EvidenceRef) => void;
}) {
  const scale = timeScale(window, 100);
  const context: LaneContext = { isLinked, data, scale, onOpen };
  const lanes = resolveSlot<LaneContext, Lane>(ISSUE_LANES_SLOT, BUILTIN_LANES, context);
  const element = useRef<HTMLDivElement>(null);
  const toPercent = (time: number) => `${Math.max(-1, Math.min(101, scale.x(time)))}%`;
  usePlayheadProperty(element, '--lane-playhead', toPercent);
  const ticks = scale.ticks(4);
  const band = spanPercent(scale, focus.from, Math.max(focus.to, focus.from));
  return (
    <div ref={element} className="lanes" role="group" aria-label={STRINGS.region} data-slot={ISSUE_LANES_SLOT}>
      <div className="lane lane-axis" aria-hidden="true">
        <span className="lane-label" />
        <div className="lane-plot">
          {ticks.map((tick) => (
            <span key={tick.ms} className="lane-tick" style={{ '--lane-x': `${tick.x}%` } as CSSProperties}>
              {tick.label}
            </span>
          ))}
          <span
            className="lane-focus"
            style={{ '--lane-x': `${band.left}%`, '--lane-width': `${band.width}%` } as CSSProperties}
            title={formatClock(focus.from)}
          />
        </div>
      </div>
      {lanes.map((descriptor) => {
        const lane = descriptor.render(context);
        return (
          <div key={descriptor.id} className="lane" data-slot-item={descriptor.id}>
            <span className="lane-label">{lane.label}</span>
            <div className="lane-plot">{lane.content}</div>
          </div>
        );
      })}
    </div>
  );
}
