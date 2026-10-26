import { usePlayhead } from '../player.ts';
import { formatClock } from '../../shared/replay.ts';
import { durationLabel, type WaterfallRow } from './waterfall.ts';

/** Captured spans mapped to the shared replay clock, retaining cuts and unknown durations. */
export function TimingBar({ row, duration }: { row: WaterfallRow; duration: number }) {
  const time = usePlayhead((playhead) => playhead);
  const extent = Math.max(1, duration);
  const title = `${formatClock(row.at)} replay time · ${row.measured === undefined ? (row.timing === 'point' ? 'Milestone' : 'Duration unknown') : `${durationLabel(row.measured)} measured`}${row.visible !== undefined ? ` · ${durationLabel(row.visible)} visible in replay` : ''}`;
  return (
    <span
      className="diagnostic-timing"
      role="img"
      data-kind={row.kind === 'performance' ? row.entry.kind : row.kind}
      title={title}
      aria-label={title}
    >
      <span className="diagnostic-timing-clock" style={{ left: `${Math.min(100, Math.max(0, (time / extent) * 100))}%` }} />
      {row.segments.length ? (
        row.segments.map((segment, index) => (
          <span
            key={index}
            className="diagnostic-timing-span"
            style={{
              left: `${Math.min(100, (segment.from / extent) * 100)}%`,
              width: `${(Math.max(0, Math.min(extent, segment.to) - segment.from) / extent) * 100}%`,
            }}
          />
        ))
      ) : (
        <span
          className="diagnostic-timing-point"
          data-unknown={row.timing !== 'point' || undefined}
          style={{ left: `${Math.min(100, (row.at / extent) * 100)}%` }}
        />
      )}
    </span>
  );
}
