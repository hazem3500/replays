import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from 'react';

import { bestGrid, GAP } from './compare/layout.ts';

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

const DEFAULT_ASPECT = 1.6;
const STAGE_PADDING = 12;

/** The columns the loaded Grid will pick for the stage's box: compare/layout.ts's own rule, so the tiles do not jump. */
function useGridColumns(count: number, stage: RefObject<HTMLDivElement | null>) {
  const [columns, setColumns] = useState(Math.ceil(Math.sqrt(count)));
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return undefined;
    const measure = () => {
      const aspect = Number.parseFloat(getComputedStyle(element).getPropertyValue('--sk-ratio')) || DEFAULT_ASPECT;
      const box = { width: element.clientWidth - STAGE_PADDING * 2, height: element.clientHeight - STAGE_PADDING * 2 };
      setColumns(bestGrid(count, box, aspect, GAP).columns);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count, stage]);
  return columns;
}

/**
 * A suite's Grid while it loads: one empty tile per recording with its name chip's place, in the columns
 * compare/layout.ts picks for the stage (measured), the short last row centred.
 */
export function TilesSkeleton({ count }: { count: number }) {
  const tiles = Math.min(count, MAX_ROWS);
  const stage = useRef<HTMLDivElement>(null);
  const columns = useGridColumns(tiles, stage);
  const style: TilesStyle = { '--sk-cols': columns, '--sk-rows': Math.ceil(tiles / columns) };
  return (
    <div className="stage-wrap">
      <div ref={stage} className="player-stage sk-stage sk-tiles" style={style}>
        {SLOTS.slice(0, tiles).map((slot) => (
          <div key={slot} className="sk-tile">
            <span className="skeleton sk-tile-name" />
          </div>
        ))}
      </div>
    </div>
  );
}
