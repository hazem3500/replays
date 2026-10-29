import { formatClock } from '../../shared/replay.ts';
import { plural } from '../plural.ts';
import type { LoadedTile } from './tiles.ts';

const STRINGS = {
  list: 'Recordings',
  errors: (count: number) => (count ? plural(count, 'error') : 'No errors'),
  delta: (difference: number) => `${difference > 0 ? '+' : '−'}${(Math.abs(difference) / 1000).toFixed(1)} s`,
};

/** Durations closer than this read the same. */
const SAME_WITHIN_MS = 100;

/**
 * The Compare view's headline: one chip per recording (its colour and name, errors, duration and how much longer or
 * shorter it ran than the one in focus). A chip moves the focus.
 */
export function CompareSummary({ tiles, focus, onFocus }: { tiles: readonly LoadedTile[]; focus: string; onFocus: (id: string) => void }) {
  const focused = tiles.find((tile) => tile.id === focus) ?? tiles[0];
  const base = focused?.bundle.meta.duration ?? 0;
  return (
    <ul className="compare-summary" aria-label={STRINGS.list} data-testid="compare-summary">
      {tiles.map((tile) => {
        const duration = tile.bundle.meta.duration;
        const difference = duration - base;
        return (
          <li key={tile.id}>
            <button
              type="button"
              className="compare-chip"
              data-tile={tile.colour}
              aria-current={tile.id === focused?.id || undefined}
              onClick={() => onFocus(tile.id)}
            >
              <span className="ct-swatch" aria-hidden="true" />
              <span className="compare-chip-name">{tile.name}</span>
              <span className="compare-chip-detail">{STRINGS.errors(tile.errors)}</span>
              <span className="compare-chip-detail">{formatClock(duration)}</span>
              {tile.id !== focused?.id && Math.abs(difference) >= SAME_WITHIN_MS ? (
                <span className="compare-chip-detail" data-tone={difference > 0 ? 'worse' : 'better'}>
                  {STRINGS.delta(difference)}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
