import { PACING_WAIT_KEPT_MS, PACING_WAIT_LIMIT_MS } from '../shared/capture-pacing.ts';
import type { ReplayBundle } from '../shared/replay.ts';

/** A stretch of a recording to compress, in ms. */
export interface PacingSpan {
  from: number;
  to: number;
}

/** Whether `--compress-waits` compresses this step: a fixed wait over the limit that nobody labelled. A selector wait never is. */
export function isPacingWait(step: { kind: string; label?: string; ms?: number }): boolean {
  return step.kind === 'wait' && !step.label?.trim() && step.ms !== undefined && step.ms > PACING_WAIT_LIMIT_MS;
}

/** The caption for a compressed wait, so a reader knows the time on screen is not real time. */
export function pacingWaitLabel(span: PacingSpan): string {
  return `Waited ${Math.round((span.to - span.from) / 1000)} s, sped up here`;
}

/** Maps a time on the recorded clock to the replay clock. Spans are sorted, disjoint and share `at`'s origin. */
export function pacingClock(spans: readonly PacingSpan[]): (at: number) => number {
  return (at) => {
    let removed = 0;
    for (const { from, to } of spans) {
      if (at <= from) break;
      const kept = Math.min(PACING_WAIT_KEPT_MS, to - from);
      if (at < to) return Math.round(from - removed + ((at - from) * kept) / (to - from));
      removed += to - from - kept;
    }
    return at - removed;
  };
}

/**
 * Moves every track of a bundle onto the replay clock. Every event inside a span is kept, so the page ends the wait in
 * the state it really reached; they just play back faster. Spans are relative to the first event.
 */
export function compressPacingWaits(bundle: ReplayBundle, spans: readonly PacingSpan[]): ReplayBundle {
  const first = bundle.events[0];
  if (spans.length === 0 || !first) return bundle;
  const clock = pacingClock(spans);
  const origin = first.timestamp;
  return {
    ...bundle,
    meta: { ...bundle.meta, duration: clock(bundle.meta.duration) },
    events: bundle.events.map((event) => ({ ...event, timestamp: origin + clock(event.timestamp - origin) })),
    console: bundle.console.map((entry) => ({ ...entry, at: clock(entry.at) })),
    network: bundle.network.map((entry) => ({ ...entry, at: clock(entry.at) })),
    steps: bundle.steps.map((step) => ({ ...step, at: clock(step.at) })),
    ...(bundle.performance
      ? { performance: { ...bundle.performance, entries: bundle.performance.entries.map((entry) => ({ ...entry, at: clock(entry.at) })) } }
      : {}),
  };
}
