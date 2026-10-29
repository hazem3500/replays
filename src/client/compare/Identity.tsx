import type { CompareTile } from './tiles.ts';

/** A recording's identity wherever it appears: its colour as a small rounded square, then its name. */
export function Identity({ tile }: { tile: Pick<CompareTile, 'name' | 'colour'> }) {
  return (
    <span className="ct-identity" data-tile={tile.colour}>
      <span className="ct-swatch" aria-hidden="true" />
      <span className="ct-name">{tile.name}</span>
    </span>
  );
}
