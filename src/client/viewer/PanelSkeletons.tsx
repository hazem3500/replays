import type { ReactNode } from 'react';

import { Skeleton, SkeletonFrame } from '@/components/ui/skeleton.tsx';

// oxlint-disable-next-line import/no-unassigned-import -- why: the skeletons' styles travel with them into whichever chunk draws them.
import './panel-skeletons.css';
import { useRibbonCollapsed } from './ribbon-collapse.ts';

/** Stand-in widths per row: varied like real text, the same on every load. */
const VARY = [62, 48, 74, 40, 56, 68];
const at = (row: number, base: number, spread = 0.4) =>
  Math.round(base * (1 - spread + (((VARY[row % VARY.length] ?? 50) % 40) / 40) * spread));
const rows = (count: number) => Array.from({ length: count }, (_, row) => `row-${row}`);

/** One header or body row of a table skeleton: its cells are spans in the table's grid columns. */
function Row({ head, children }: { head?: boolean; children: ReactNode }) {
  return <div className={head ? 'sk-row sk-head' : 'sk-row'}>{children}</div>;
}

/** The two-to-three lanes of a time ribbon: labels in a gutter, faint bands in the plot. */
function Ribbon({ labels, bands, tall }: { labels: readonly number[]; bands: readonly number[]; tall?: boolean }) {
  return (
    <div className="sk-tl" data-tall={tall ? '' : undefined}>
      <div className="sk-tl-gutter">
        {labels.map((width) => (
          <div key={width} className="sk-lane">
            <Skeleton w={11} h={11} />
            <Skeleton w={width} h={8} className="sk-tl-text" />
          </div>
        ))}
      </div>
      <div className="sk-tl-plot">
        {bands.map((width, index) => (
          <div key={`${width}-${index}`} className="sk-lane" data-first={index === 0 && tall ? '' : undefined}>
            <Skeleton h={tall && index === 0 ? 20 : 14} w={`${width}%`} className="sk-band" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Performance: headline and jump button, the timeline's lanes, the stats strip, then the moments table. */
export function PerformanceSkeleton() {
  const collapsed = useRibbonCollapsed();
  return (
    <SkeletonFrame panel="performance" label="Loading performance">
      <div className="sk-lead">
        <Skeleton shape="dot" />
        <Skeleton w={240} h={10} />
        <Skeleton w={88} h={22} className="sk-end" />
      </div>
      {collapsed ? null : <Ribbon labels={[44, 56, 40]} bands={[100, 70, 85]} />}
      <ul className="sk-vitals">
        {[76, 88, 64, 92, 70].map((width) => (
          <li key={width}>
            <Skeleton w={width} h={18} shape="pill" />
          </li>
        ))}
      </ul>
      <div className="sk-table" data-kind="perf">
        <Row head>
          <Skeleton w={52} h={8} />
          <Skeleton w={32} h={8} />
          <Skeleton w={32} h={8} />
          <Skeleton w={44} h={8} className="sk-md" />
          <Skeleton w={52} h={8} />
        </Row>
        {rows(5).map((row, index) => (
          <Row key={row}>
            <span className="sk-cell">
              <Skeleton shape="dot" />
              <Skeleton w={at(index, 110)} h={10} />
            </span>
            <Skeleton w={32} h={8} />
            <Skeleton w={36} h={10} />
            <Skeleton w={at(index, 120, 0.3)} h={4} className="sk-md" />
            <Skeleton w={`${at(index, 90, 0.5)}%`} h={10} />
          </Row>
        ))}
      </div>
    </SkeletonFrame>
  );
}

/** Network: filter pills and search, the timeline's lanes, then rows of method, path, status and duration. */
export function NetworkSkeleton() {
  const collapsed = useRibbonCollapsed('network');
  return (
    <SkeletonFrame panel="network" label="Loading requests">
      <div className="sk-toolbar">
        {[44, 64, 56, 52].map((width) => (
          <Skeleton key={width} w={width} h={22} shape="pill" />
        ))}
        <Skeleton w={180} h={24} className="sk-end" />
      </div>
      {collapsed ? null : <Ribbon labels={[]} bands={[100, 38]} tall />}
      <div className="sk-table" data-kind="net">
        <Row head>
          <Skeleton w={32} h={8} />
          <Skeleton w={52} h={8} />
          <Skeleton w={36} h={8} />
          <Skeleton w={52} h={8} />
          <Skeleton w={36} h={8} className="sk-md" />
        </Row>
        {rows(7).map((row, index) => (
          <Row key={row}>
            <Skeleton w={34} h={8} />
            <span className="sk-cell">
              <Skeleton w={30} h={9} />
              <Skeleton w={`${at(index, 70, 0.6)}%`} h={10} />
            </span>
            <Skeleton w={26} h={10} />
            <span className="sk-cell">
              <Skeleton w={34} h={10} />
              <Skeleton w={at(index, 48, 0.7)} h={4} />
            </span>
            <Skeleton w={at(index, 120, 0.5)} h={9} className="sk-md" />
          </Row>
        ))}
      </div>
    </SkeletonFrame>
  );
}

/** Console: filter chips, then log lines, each a level dot and a message of its own length. */
export function ConsoleSkeleton() {
  return (
    <SkeletonFrame panel="console" label="Loading console">
      <div className="sk-toolbar">
        {[48, 40, 52, 44].map((width) => (
          <Skeleton key={width} w={width} h={22} shape="pill" />
        ))}
      </div>
      <div className="sk-table" data-kind="log">
        <Row head>
          <Skeleton w={30} h={8} />
          <Skeleton w={56} h={8} />
          <Skeleton w={40} h={8} className="sk-md" />
        </Row>
        {rows(6).map((row, index) => (
          <Row key={row}>
            <Skeleton w={34} h={8} />
            <span className="sk-cell">
              <Skeleton shape="dot" />
              <Skeleton w={`${at(index, 80, 0.7)}%`} h={10} />
            </span>
            <Skeleton w={at(index, 110, 0.5)} h={8} className="sk-md" />
          </Row>
        ))}
      </div>
    </SkeletonFrame>
  );
}

function ContextGroup({ rowsCount, seed }: { rowsCount: number; seed: number }) {
  return (
    <div className="sk-ctx-group">
      <Skeleton w={56} h={9} className="sk-heading" />
      {rows(rowsCount).map((row, index) => (
        <div key={row} className="sk-ctx-row">
          <Skeleton w={at(index + seed, 64, 0.4)} h={8} />
          <Skeleton w={`${at(index + seed, 70, 0.6)}%`} h={10} />
        </div>
      ))}
    </div>
  );
}

/** Context: the product and environment line, a sources list, then two columns of label and value rows. */
export function ContextSkeleton() {
  return (
    <SkeletonFrame panel="context" label="Loading context">
      <div className="sk-ctx">
        <div className="sk-ctx-summary">
          <Skeleton w={120} h={11} />
          <Skeleton w={56} h={20} shape="pill" />
          <Skeleton w={90} h={8} className="sk-end" />
        </div>
        <Skeleton w={56} h={9} className="sk-heading" />
        {[180, 140].map((width) => (
          <div key={width} className="sk-ctx-source">
            <Skeleton w={14} h={14} />
            <Skeleton w={width} h={10} />
          </div>
        ))}
        <div className="sk-ctx-groups">
          <ContextGroup rowsCount={4} seed={0} />
          <ContextGroup rowsCount={4} seed={3} />
        </div>
      </div>
    </SkeletonFrame>
  );
}

function CommentThreads() {
  return (
    <ol className="sk-comments">
      {[2, 1, 2].map((lines, index) => (
        <li key={`${lines}-${index}`}>
          <div className="sk-comment">
            <Skeleton w={24} h={24} shape="dot" className="sk-avatar" />
            <div className="sk-comment-text">
              <div className="sk-cell">
                <Skeleton w={at(index, 84)} h={9} />
                <Skeleton w={40} h={8} />
              </div>
              {rows(lines).map((line, lineIndex) => (
                <Skeleton key={line} w={`${lineIndex === lines - 1 && lines > 1 ? 55 : 92 - index * 8}%`} h={10} className="sk-line" />
              ))}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The threads alone, for the list's own loading state (the real composer is already docked below it). */
export function CommentThreadsSkeleton() {
  return (
    <SkeletonFrame panel="comments" label="Loading comments">
      <CommentThreads />
    </SkeletonFrame>
  );
}

/** Comments: a few threads (avatar, author and time, one or two lines) over the composer docked at the bottom. */
export function CommentsSkeleton() {
  return (
    <SkeletonFrame panel="comments" label="Loading comments">
      <div className="sk-comments-wrap">
        <CommentThreads />
        <div className="sk-composer">
          <Skeleton w={160} h={10} />
        </div>
      </div>
    </SkeletonFrame>
  );
}

/** Steps and anything without a layout of its own: step-like rows. */
export function ListSkeleton({ label = 'Loading panel' }: { label?: string }) {
  return (
    <SkeletonFrame panel="fallback" label={label}>
      <div className="sk-list">
        {rows(5).map((row, index) => (
          <div key={row} className="sk-list-row">
            <Skeleton w={14} h={14} />
            <Skeleton w={`${at(index, 70, 0.5)}%`} h={10} />
            <Skeleton w={30} h={8} className="sk-end" />
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}

const SKELETONS: Record<string, () => ReactNode> = {
  console: () => <ConsoleSkeleton />,
  network: () => <NetworkSkeleton />,
  performance: () => <PerformanceSkeleton />,
  context: () => <ContextSkeleton />,
  comments: () => <CommentsSkeleton />,
  steps: () => <ListSkeleton label="Loading steps" />,
};

/** The skeleton for a tab by id, or the generic list for a tab that has no layout of its own (plugins). */
export function PanelSkeleton({ panel }: { panel: string }) {
  return (SKELETONS[panel] ?? (() => <ListSkeleton />))();
}
