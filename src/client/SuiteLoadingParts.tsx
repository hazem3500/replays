import type { CSSProperties } from 'react';

const DEFAULT_RUNS = 3;
/** Stand-in runs and tiles stop here; a longer suite's list scrolls and its grid's tiles are thumbnails anyway. */
const MAX_ROWS = 12;
const LABEL_WIDTHS = [62, 48, 70, 54, 66, 44];
/** Stable keys for stand-ins that only differ by position. */
const SLOTS = Array.from({ length: MAX_ROWS }, (_, slot) => `slot-${slot}`);

/** The grid's column and row counts, which size each tile (styles.css, `.sk-tile`). */
interface TilesStyle extends CSSProperties {
  '--sk-cols': number;
  '--sk-rows': number;
}

/** The runs sidebar while a suite loads: the opened card's title and run count, else stand-in runs. */
export function SuiteSidebarSkeleton({ title, runs }: { title: string | undefined; runs: number | undefined }) {
  return (
    <aside className="suite-sidebar" aria-hidden="true">
      <div className="suite-sidebar-head">
        <div className="suite-sidebar-title">
          {title ? <h2>{title}</h2> : <span className="skeleton sk-suite-title" />}
          <p className="suite-sidebar-meta">
            <span className="skeleton skeleton-thin sk-suite-meta" />
          </p>
        </div>
        <span className="sk-rail-switch" />
      </div>
      <div className="suite-run-list">
        {SLOTS.slice(0, Math.min(runs ?? DEFAULT_RUNS, MAX_ROWS)).map((slot, index) => (
          <div key={slot} className="suite-run-item sk-run">
            <span className="run-swatch" />
            <span className="run-copy">
              <span className="skeleton" style={{ width: `${LABEL_WIDTHS[index % LABEL_WIDTHS.length]}%` }} />
              <span className="skeleton skeleton-thin sk-run-meta" />
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/**
 * A suite's Grid while it loads: one empty tile per recording with its name chip's place, as many columns as rows or one
 * more and the short last row centred, as compare/layout.ts places them on a landscape stage.
 */
export function TilesSkeleton({ count }: { count: number }) {
  const tiles = Math.min(count, MAX_ROWS);
  const columns = Math.ceil(Math.sqrt(tiles));
  const style: TilesStyle = { '--sk-cols': columns, '--sk-rows': Math.ceil(tiles / columns) };
  return (
    <div className="stage-wrap">
      <div className="player-stage sk-stage sk-tiles" style={style}>
        {SLOTS.slice(0, tiles).map((slot) => (
          <div key={slot} className="sk-tile">
            <span className="skeleton sk-tile-name" />
          </div>
        ))}
      </div>
    </div>
  );
}
