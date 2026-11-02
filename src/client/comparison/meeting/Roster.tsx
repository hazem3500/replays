import { EyeOffIcon } from 'lucide-react';
import { type CSSProperties, useRef } from 'react';

import { useClockChange, useClockState } from '../../hooks/use-clock.ts';
import type { MeetingClock, MeetingSnapshot } from './clock.ts';
import type { TileSource } from './tiles.ts';

export const ROSTER_STRINGS = {
  label: 'Recordings in this comparison',
  show: (label: string) => `Show ${label}`,
  hide: (label: string) => `Hide ${label}`,
  go: (label: string) => `Go to ${label}`,
  started: (letter: string, label: string) => `${letter}, ${label}: started`,
  ended: (letter: string, label: string) => `${letter}, ${label}: ended, holding its last frame`,
  waiting: (letter: string, label: string) => `${letter}, ${label}: waiting to start`,
} as const;

/**
 * The colour key for the timeline's markers. On desktop each chip shows or hides its tile, and a hidden tile's chip
 * spells out its name so it is easy to bring back; on phones the chips are the carousel's dots and go to their tile.
 */
export function Roster({
  sources,
  labels,
  hidden,
  mobile,
  clock,
  onToggle,
  onGo,
}: {
  sources: TileSource[];
  labels: Readonly<Record<string, string>>;
  hidden: readonly string[];
  mobile: boolean;
  clock: MeetingClock;
  onToggle(id: string): void;
  onGo(id: string): void;
}) {
  const statuses = useClockState(clock, (snapshot) => statusKey(snapshot, sources));
  return (
    <div className="mt-roster" role="group" aria-label={ROSTER_STRINGS.label} data-statuses={statuses}>
      {sources.map((source) => {
        const label = labels[source.id] ?? source.id;
        const shown = !hidden.includes(source.id);
        return (
          <button
            key={source.id}
            type="button"
            className="mt-chip"
            style={{ '--tile': `var(--tile-${source.colour + 1})` } as CSSProperties}
            data-state={clock.getSnapshot().tiles[source.id]?.status ?? 'loading'}
            {...(mobile ? {} : { 'aria-pressed': shown })}
            aria-label={mobile ? ROSTER_STRINGS.go(label) : shown ? ROSTER_STRINGS.hide(label) : ROSTER_STRINGS.show(label)}
            title={label}
            onClick={() => (mobile ? onGo(source.id) : onToggle(source.id))}
          >
            <span className="mt-letter">{source.letter}</span>
            {shown || mobile ? null : (
              <>
                <EyeOffIcon aria-hidden="true" />
                <span className="mt-chip-label" aria-hidden="true">
                  {label}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

const statusKey = (snapshot: MeetingSnapshot, sources: TileSource[]) =>
  sources.map((source) => snapshot.tiles[source.id]?.status ?? '-').join(',');

/** A polite live region announcing tiles as they start, wait or end; muted tiles stay quiet. */
export function Announcer({
  clock,
  sources,
  labels,
  muted,
}: {
  clock: MeetingClock;
  sources: TileSource[];
  labels: Readonly<Record<string, string>>;
  muted: readonly string[];
}) {
  const region = useRef<HTMLParagraphElement>(null);
  const previous = useRef(clock.getSnapshot().tiles);
  useClockChange(clock, ({ tiles }) => {
    const lines = sources.flatMap((source) => {
      const before = previous.current[source.id]?.status;
      const now = tiles[source.id]?.status;
      if (!before || !now || before === now || muted.includes(source.id)) return [];
      const label = labels[source.id] ?? source.id;
      return [
        now === 'ended'
          ? ROSTER_STRINGS.ended(source.letter, label)
          : now === 'waiting'
            ? ROSTER_STRINGS.waiting(source.letter, label)
            : ROSTER_STRINGS.started(source.letter, label),
      ];
    });
    previous.current = tiles;
    if (lines.length && region.current) region.current.textContent = lines.join('. ');
  });
  return <p ref={region} className="sr-only" role="status" aria-live="polite" />;
}
