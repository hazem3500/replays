import { formatClock } from '../../shared/replay.ts';
import '../loading.css';
import './panel-pending.css';

/** How one inspector panel looks before its code or its first frame is there: its chrome, then stand-in rows. */
interface PendingSpec {
  /** Read to screen readers while the panel loads. */
  label: string;
  /** The panel's own toolbar, drawn as it will be (inert). */
  toolbar?: { search: string; chips: readonly string[] };
  /** Performance's vitals strip: one tile per vital. */
  vitals?: readonly string[];
  /** Column headers, as the real table has them, and its grid template. */
  head?: readonly string[];
  columns?: string;
  /** Stand-in text per column; only its redacted line box shows. */
  cells: (index: number) => readonly string[];
}

const PATHS = ['/api/cart', '/api/coupons/validate', '/checkout', '/api/session'];
const MESSAGES = ['Hydrated checkout form', 'Coupon validation failed: code expired', 'GET /api/cart 200', 'Retrying order once'];
const EVENTS = ['Long task', 'Slow interaction · click', 'Largest contentful paint', 'Long task'];
const ISSUES = ['Request failed: POST /api/coupons', 'Console error: code expired', 'Slow interaction after click'];
const COMMENTS = ['Coupon field loses focus here', 'Is this the retry we expected?', 'Looks right after the fix'];
const at = (values: readonly string[], index: number) => values[index % values.length] ?? '';

/* why: the labels repeat the real panels' own (network/columns.tsx, NetworkToolbar.tsx, PerformanceTable.tsx, Inspector.tsx), because this file must stay out of their lazy chunks. */
const SPECS: Record<string, PendingSpec> = {
  network: {
    label: 'Loading requests',
    toolbar: { search: 'Filter URL, method, status', chips: ['All', 'Failed', '4xx', '5xx'] },
    head: ['', 'Method', 'Name', 'Status', 'Type', 'Duration'],
    columns: '6px 52px minmax(0, 1fr) 52px 64px 72px',
    cells: (index) => ['', 'GET', at(PATHS, index), '200', 'fetch', `${84 + index * 37} ms`],
  },
  performance: {
    label: 'Loading performance',
    vitals: ['LCP', 'INP', 'CLS', 'Long tasks'],
    head: ['', 'Event', 'When', 'Value', 'Budget'],
    columns: '10px minmax(160px, 1fr) 56px 64px minmax(140px, 28%)',
    cells: (index) => ['', at(EVENTS, index), formatClock((index + 1) * 1400), `${120 + index * 40} ms`, ''],
  },
  console: {
    label: 'Loading console',
    head: ['Time', 'Message', 'Source'],
    columns: '72px minmax(0, 1fr) 180px',
    cells: (index) => [formatClock((index + 1) * 1800), at(MESSAGES, index), 'shop.example.test'],
  },
  issues: { label: 'Loading issues', cells: (index) => [at(ISSUES, index), formatClock((index + 1) * 2300)] },
  comments: { label: 'Loading comments', cells: (index) => [at(COMMENTS, index), formatClock((index + 1) * 3100)] },
};

const FALLBACK: PendingSpec = { label: 'Loading panel', cells: (index) => [at(MESSAGES, index), formatClock((index + 1) * 2000)] };
const ROWS = [0, 1, 2, 3];

/**
 * An inspector panel while its code loads or its page is still settling: the panel's real chrome at once (toolbar,
 * vitals, column headers), then four stand-in rows in its own row geometry, redacted to bands and breathing, after
 * --skeleton-delay. Never an empty panel.
 */
export function PanelPending({ panel }: { panel: string }) {
  const spec = SPECS[panel] ?? FALLBACK;
  return (
    <div className="panel-pending" data-panel={panel} aria-busy="true">
      <span className="visually-hidden" role="status">
        {spec.label}…
      </span>
      {spec.toolbar ? <PendingToolbar {...spec.toolbar} /> : null}
      {spec.vitals ? (
        <div className="panel-pending-vitals" aria-hidden="true">
          {spec.vitals.map((vital) => (
            <span key={vital} className="panel-pending-vital">
              <span>{vital}</span>
              <span className="pending">
                <strong className="redact">2.4 s</strong>
              </span>
            </span>
          ))}
        </div>
      ) : null}
      {spec.head ? (
        <div className="panel-pending-row panel-pending-head" style={{ gridTemplateColumns: spec.columns }} aria-hidden="true">
          {spec.head.map((label, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- why: a fixed header (some labels are empty), never reordered.
            <span key={index}>{label}</span>
          ))}
        </div>
      ) : null}
      <div className="panel-pending-rows pending" aria-hidden="true">
        {ROWS.map((row) => (
          <div key={row} className="panel-pending-row" style={spec.columns ? { gridTemplateColumns: spec.columns } : undefined}>
            {spec.cells(row).map((text, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- why: fixed stand-in cells, one per column, never reordered.
              <span key={index} className={text ? 'redact' : 'panel-pending-dot'}>
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingToolbar({ search, chips }: { search: string; chips: readonly string[] }) {
  return (
    <div className="panel-pending-toolbar" aria-hidden="true">
      <span className="panel-pending-search">{search}</span>
      {chips.map((chip) => (
        <span key={chip} className="panel-pending-chip">
          {chip}
        </span>
      ))}
    </div>
  );
}
