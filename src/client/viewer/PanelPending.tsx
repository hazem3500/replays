import type { CSSProperties, ReactNode } from 'react';
import { usePanelPendingMotion } from '../hooks/use-panel-pending-motion.ts';

const STRINGS = {
  steps: 'Loading steps',
  console: 'Loading console',
  network: 'Loading requests',
  performance: 'Loading performance',
  context: 'Loading context',
  fallback: 'Loading panel',
} as const;

type Pending = keyof typeof STRINGS;
const isPending = (panel: string): panel is Pending => Object.hasOwn(STRINGS, panel);

/** Stand-in bar widths per row: varied like real text, the same on every load. */
const WIDTHS = [62, 48, 74, 40, 56, 68, 44, 52];
const ROWS = WIDTHS.map((_, index) => index);
const width = (row: number, scale = 1): CSSProperties => ({ width: `${Math.round((WIDTHS[row % WIDTHS.length] ?? 50) * scale)}%` });

function Bar({ row, scale, thin = false }: { row: number; scale?: number; thin?: boolean }) {
  return <span className={thin ? 'skeleton skeleton-thin pending-bar' : 'skeleton pending-bar'} style={width(row, scale)} />;
}

/**
 * The table panels' frame (console, network): the real table classes and header, so the columns land where the loaded
 * rows will, with stand-in rows under it.
 */
function PendingTable({ kind, head }: { kind: 'console' | 'network'; head: readonly string[] }) {
  return (
    <div className="table-scroll pending-scroll">
      <table className={`diagnostic-table ${kind}-table`}>
        <thead>
          <tr>
            {head.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="pending-rows">
          {ROWS.map((row) => (
            <tr key={row}>
              {head.map((label, column) => (
                <td key={label}>
                  <Bar row={row + column} scale={column === 1 ? 1 : 0.9} thin={column !== 1} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ROW_LIST = (
  <div className="pending-list">
    {ROWS.map((row) => (
      <div key={row} className="pending-line">
        <Bar row={row} />
      </div>
    ))}
  </div>
);

const FRAMES: Record<Pending, ReactNode> = {
  console: <PendingTable kind="console" head={['Time', 'Message', 'Source']} />,
  network: (
    <>
      <div className="diagnostic-toolbar network-toolbar pending-toolbar">
        <span className="skeleton pending-control" />
        <span className="skeleton pending-control pending-control-wide" />
        <span className="skeleton skeleton-thin pending-total" />
      </div>
      <PendingTable kind="network" head={['Time', 'Request', 'Status', 'Duration']} />
    </>
  ),
  context: (
    <div className="ctx-inner pending-context">
      <div className="ctx-summary">
        <span className="skeleton pending-bar" style={width(0, 0.5)} />
      </div>
      <div className="pending-columns">
        {[0, 1].map((column) => (
          <div key={column} className="pending-column">
            <span className="skeleton skeleton-thin pending-heading" />
            {ROWS.slice(0, 3).map((row) => (
              <div key={row} className="ctx-row">
                <Bar row={row + column} scale={0.8} thin />
                <Bar row={row + column + 2} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  ),
  steps: (
    <div className="pending-list">
      {ROWS.slice(0, 5).map((row) => (
        <div key={row} className="step pending-step">
          <span className="skeleton pending-icon" />
          <Bar row={row} />
          <span className="skeleton skeleton-thin pending-time" />
        </div>
      ))}
    </div>
  ),
  performance: ROW_LIST,
  fallback: ROW_LIST,
};

/**
 * An inspector panel before its rows can render (the page transition is still running, or its code is loading): the
 * panel's own frame at once (toolbar, column headers, row height), so nothing moves when the rows arrive. Never an
 * empty panel.
 */
export function PanelPending({ panel }: { panel: string }) {
  const kind = isPending(panel) ? panel : 'fallback';
  return <PendingFrame key={kind} kind={kind} />;
}

function PendingFrame({ kind }: { kind: Pending }) {
  const ref = usePanelPendingMotion();
  return (
    <div ref={ref} className="panel-pending" data-panel={kind} aria-busy="true" data-testid="panel-pending">
      <span className="visually-hidden" role="status">
        {STRINGS[kind]}
      </span>
      <div className="panel-pending-frame" aria-hidden="true">
        {FRAMES[kind]}
      </div>
    </div>
  );
}
