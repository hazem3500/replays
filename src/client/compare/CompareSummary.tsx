import { formatClock } from '../../shared/replay.ts';
import { cssVars } from '../lib/css-vars.ts';
import { plural } from '../plural.ts';
import type { LoadedTile } from './tiles.ts';

const STRINGS = {
  list: 'Recordings',
  errors: (count: number) => (count ? plural(count, 'error') : 'no errors'),
  delta: (difference: number) => `${difference > 0 ? '+' : '−'}${(Math.abs(difference) / 1000).toFixed(1)} s`,
  versus: (delta: string, name: string) => `${delta} against ${name}`,
};

/** Durations closer than this read the same. */
const SAME_WITHIN_MS = 100;

/**
 * The Compare view's headline: one segment per recording in a single strip, every segment the same width with its
 * facts in fixed right-hand columns (errors, duration, and how much longer or shorter it ran than the one in focus),
 * so the figures line up down a wrapped strip. A segment moves the focus.
 */
export function CompareSummary({ tiles, focus, onFocus }: { tiles: readonly LoadedTile[]; focus: string; onFocus: (id: string) => void }) {
  const focused = tiles.find((tile) => tile.id === focus) ?? tiles[0];
  const base = focused?.bundle.meta.duration ?? 0;
  const columns = cssVars({ '--segments': tiles.length, '--segments-wrapped': Math.max(2, Math.ceil(tiles.length / 2)) });
  return (
    <ul className="compare-summary" aria-label={STRINGS.list} data-testid="compare-summary" data-segments={tiles.length} style={columns}>
      {tiles.map((tile) => {
        const duration = tile.bundle.meta.duration;
        const difference = duration - base;
        const delta = tile.id !== focused?.id && Math.abs(difference) >= SAME_WITHIN_MS ? STRINGS.delta(difference) : undefined;
        const label = [
          tile.name,
          STRINGS.errors(tile.errors),
          formatClock(duration),
          delta && focused ? STRINGS.versus(delta, focused.name) : '',
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <li key={tile.id}>
            <button
              type="button"
              className="compare-chip"
              data-tile={tile.colour}
              aria-current={tile.id === focused?.id || undefined}
              aria-label={label}
              onClick={() => onFocus(tile.id)}
            >
              <span className="ct-swatch" aria-hidden="true" />
              <span className="compare-chip-name">{tile.name}</span>
              <span className="compare-chip-errors" aria-hidden="true">
                {tile.errors ? tile.errors : null}
              </span>
              <span className="compare-chip-clock" aria-hidden="true">
                {formatClock(duration)}
              </span>
              <span className="compare-chip-delta" aria-hidden="true">
                {delta}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
