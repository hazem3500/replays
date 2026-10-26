import './editor/skeleton.css';

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

import { useLoadProgress } from './load-progress.ts';
import { MOBILE_QUERY, useMediaQuery } from './media.ts';
import { readStorage } from './storage.ts';

/**
 * The placeholder while a replay (or a suite run) loads. It is the viewer's own layout, drawn with quiet shapes:
 * the same top bar, workspace grid (player, splitter column, step rail), transport, splitter row and panel, at
 * the stored rail width and panel height, so nothing moves when the replay arrives. Lives outside the viewer
 * chunk (the index bundle renders it while that chunk downloads), so the few viewer constants it needs are
 * repeated here (storage keys, defaults).
 *
 * Calm on purpose: it fades in only after 150 ms (fast loads never show it), every block shares one slow sheen
 * (a viewport-fixed gradient, so blocks shimmer in sync; static under reduced motion), and after 1.2 s a thin
 * progress line appears under the top bar. Ready content replaces it immediately, without a second full-page layer.
 */

/* Repeated from the viewer chunk (StepRail.tsx, Inspector.tsx, Viewer.tsx); keep in sync. */
const STEPS_WIDTH_KEY = 'replays-steps-width';
const INSPECTOR_HEIGHT_KEY = 'replays-inspector-height';
const INSPECTOR_COLLAPSED_KEY = 'replays-inspector-collapsed';
const DEFAULT_INSPECTOR_HEIGHT = 260;
const MIN_INSPECTOR_HEIGHT = 120;
const INSPECTOR_TABS_HEIGHT = 37;

/**
 * What the page opening the replay already knows (the index writes it before navigating; see OPEN_HINT_KEY):
 * the title, the recording's viewport and step count.
 */
export const OPEN_HINT_KEY = 'replays-open-hint';
export interface OpenHint {
  id: string;
  title?: string;
  viewport?: { width: number; height: number };
  steps?: number;
  /** A source chip (a linked pull request or ticket) shows beside the title. */
  source?: boolean;
  /** The card's poster, or its opening still when loaded: the frame shows it while loading (navigation.ts). */
  poster?: string;
  /** `poster` is the opening still (the replay's first paint), not the list poster. */
  still?: boolean;
}

function readHint(): OpenHint | undefined {
  try {
    const raw = sessionStorage.getItem(OPEN_HINT_KEY);
    if (!raw) return undefined;
    const hint = JSON.parse(raw) as OpenHint;
    return location.pathname.includes(`/${encodeURIComponent(hint.id)}`) ? hint : undefined;
  } catch {
    return undefined;
  }
}

function layout(hint: OpenHint | undefined) {
  const savedHeight = Number(readStorage(INSPECTOR_HEIGHT_KEY));
  const maxHeight = Math.max(MIN_INSPECTOR_HEIGHT, Math.round(window.innerHeight * 0.6));
  const height =
    Number.isFinite(savedHeight) && savedHeight > 0
      ? Math.round(Math.min(Math.max(savedHeight, MIN_INSPECTOR_HEIGHT), maxHeight))
      : DEFAULT_INSPECTOR_HEIGHT;
  const savedCollapsed = readStorage(INSPECTOR_COLLAPSED_KEY);
  const collapsed = savedCollapsed === '1';
  const stepsWidth = Number(readStorage(STEPS_WIDTH_KEY));
  const ratio = hint?.viewport && hint.viewport.height > 0 ? hint.viewport.width / hint.viewport.height : 16 / 10;
  return { height, collapsed, stepsWidth: Number.isFinite(stepsWidth) && stepsWidth > 0 ? stepsWidth : undefined, ratio };
}

/** Deterministic "natural" widths: a fixed sequence, never random per render. */
const LINE_WIDTHS = [64, 48, 72, 56, 80, 44, 68, 52, 76, 60, 40, 70];
const width = (index: number) => LINE_WIDTHS[index % LINE_WIDTHS.length]!;

/** A skeleton that disappeared this recently hands over to the next one at once (no second fade-in). */
let lastVisibleAt = Number.NEGATIVE_INFINITY;
const SHOW_DELAY_MS = 150;

export function ViewerSkeleton({ label = 'Loading replay', suite = false }: { label?: string; suite?: boolean }) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [hint] = useState(readHint);
  const [shape] = useState(() => layout(hint));
  const [instant] = useState(() => performance.now() - lastVisibleAt < 120);
  useEffect(() => {
    const started = performance.now();
    return () => {
      if (instant || performance.now() - started >= SHOW_DELAY_MS) lastVisibleAt = performance.now();
    };
  }, [instant]);
  const collapsed = shape.collapsed;
  const viewer = (
    <main
      className="app-shell skeleton-shell"
      data-mobile={mobile || undefined}
      data-inspector-collapsed={collapsed || undefined}
      data-instant={instant || undefined}
      aria-busy="true"
      aria-label={label}
      style={
        {
          '--inspector-height': collapsed && !mobile ? `${INSPECTOR_TABS_HEIGHT}px` : `${shape.height}px`,
          '--sk-ratio': String(shape.ratio),
        } as CSSProperties
      }
    >
      <span className="visually-hidden" role="status">
        {label}…
      </span>
      {mobile ? <PhoneSkeleton hint={hint} /> : <DesktopSkeleton hint={hint} stepsWidth={shape.stepsWidth} collapsed={collapsed} />}
    </main>
  );
  if (!suite || mobile) return viewer;
  return (
    <div className="suite-workspace skeleton-suite" data-instant={instant || undefined}>
      <SuiteSidebarSkeleton />
      <div className="suite-viewer">{viewer}</div>
    </div>
  );
}

/** Edit loads retain the editor's single stage and compact timeline; no viewer inspector or step rail flashes. */
export function EditorSkeleton() {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [hint] = useState(readHint);
  const [height] = useState(() => {
    const saved = Number(readStorage('replays-editor-dock-height'));
    return Math.round(Math.min(Math.max(Number.isFinite(saved) && saved > 0 ? saved : 168, 148), Math.max(148, window.innerHeight * 0.65)));
  });
  return (
    <main
      className="app-shell skeleton-shell editor-loading"
      data-mobile={mobile || undefined}
      aria-busy="true"
      aria-label="Loading editor"
      data-testid="editor-skeleton"
      style={{ '--editor-loading-height': `${height}px`, '--sk-ratio': String(layout(hint).ratio) } as CSSProperties}
    >
      <span className="visually-hidden" role="status">
        Loading editor…
      </span>
      <div className="topbar app-topbar sk-topbar" aria-hidden="true">
        <span className="sk-slot">
          <Glyph />
        </span>
        <span className="sk-title">
          <Line width={hint?.title ? Math.min(420, hint.title.length * 8) : 260} className="sk-line-title" />
        </span>
        <span className="topbar-actions">
          <Line width={72} className="sk-line-chip" />
          <Line width={64} className="sk-line-chip" />
        </span>
        <ProgressHint />
      </div>
      <section className="editor-loading-stage" aria-hidden="true">
        <PlayerSkeleton poster={hint?.poster} />
      </section>
      {mobile ? null : <div className="editor-loading-divider" aria-hidden="true" />}
      <section className="editor-loading-dock" aria-hidden="true">
        <div className="editor-loading-tools">
          <Glyph />
          <Line width={46} />
          <Glyph />
          <Glyph />
          <Line width={72} />
        </div>
        <div className="editor-loading-ruler">
          <Line width={30} />
          <Line width={30} />
          <Line width={30} />
          <Line width={30} />
        </div>
        <div className="sk editor-loading-track" />
      </section>
    </main>
  );
}

/** The thin line under the top bar after 1.2 s: indeterminate, or the share downloaded when the size is known. */
function ProgressHint() {
  // Visibility is loading state, not an animation side effect. It must survive disabled/cancelled animations.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  const progress = useLoadProgress();
  const share = progress?.total ? Math.min(1, progress.loaded / progress.total) : undefined;
  return (
    <span
      className="sk-progress"
      data-visible={visible || undefined}
      data-determinate={share === undefined ? undefined : ''}
      aria-hidden="true"
    >
      <span style={share === undefined ? undefined : { transform: `scaleX(${share})` }} />
    </span>
  );
}

function Glyph({ size = 16 }: { size?: number }) {
  return <span className="sk sk-glyph" style={{ width: size, height: size }} />;
}

function Line({ width: value, className = '' }: { width: number | string; className?: string }) {
  return <span className={`sk sk-line ${className}`} style={{ width: value }} />;
}

/** The player: the stage's canvas, the recording's frame at its aspect ratio (as the viewer fits it), a faint play glyph. */
function PlayerSkeleton({ poster }: { poster?: string | undefined }) {
  return (
    <div className="stage-wrap">
      <div className="player-stage sk-stage">
        <div className="sk-frame">
          {poster ? (
            <img className="sk-poster" src={poster} alt="" decoding="sync" draggable={false} />
          ) : (
            <svg className="sk-play" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l10.5-6.5z" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

/** Segmented like the real scrubber (one bar per step), at its rest height. */
function ScrubSkeleton({ steps }: { steps: number }) {
  const count = Math.max(1, Math.min(steps, 14));
  return (
    <span className="sk-scrub" style={{ gridArea: 'scrub' }}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="sk" style={{ flexGrow: 2 + (width(index * 3) % 5) }} />
      ))}
    </span>
  );
}

function TransportSkeleton({ steps }: { steps: number }) {
  return (
    <div className="transport sk-transport">
      <span className="sk-slot" style={{ gridArea: 'play' }}>
        <Glyph />
      </span>
      <span style={{ gridArea: 'time' }}>
        <Line width={42} />
      </span>
      <ScrubSkeleton steps={steps} />
      <span className="sk-slot" style={{ gridArea: 'captions' }}>
        <Glyph />
      </span>
      <span className="sk-slot sk-slot-wide" style={{ gridArea: 'options' }}>
        <Line width={14} />
      </span>
    </div>
  );
}

function StepRows({ count, phone = false }: { count: number; phone?: boolean }) {
  return (
    <div className="timeline sk-steps">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={`step sk-step ${phone ? 'sk-step-phone' : ''}`}>
          <Glyph size={14} />
          <Line width={`${width(index)}%`} />
          <Line width={30} className="sk-faint" />
        </div>
      ))}
    </div>
  );
}

const TAB_WIDTHS = [86, 90, 112, 52];

function DesktopSkeleton({
  hint,
  stepsWidth,
  collapsed,
}: {
  hint: OpenHint | undefined;
  stepsWidth: number | undefined;
  collapsed: boolean;
}) {
  const steps = hint?.steps ?? 10;
  const titleWidth = hint?.title ? Math.min(420, Math.max(120, hint.title.length * 8)) : 260;
  return (
    <>
      <div className="topbar app-topbar sk-topbar" aria-hidden="true">
        <span className="sk-slot" data-skel="back">
          <Glyph />
        </span>
        <span data-skel="title" className="sk-title">
          <Line width={titleWidth} className="sk-line-title" />
        </span>
        {hint?.source ? <Line width={92} className="sk-line-chip" /> : null}
        <span className="topbar-actions" data-skel="actions">
          {[0, 1, 2, 3, 4].map((index) => (
            <span key={index} className="sk-slot">
              <Glyph />
            </span>
          ))}
        </span>
        <ProgressHint />
      </div>
      <div
        className="workspace"
        aria-hidden="true"
        style={stepsWidth ? ({ '--steps-width': `${stepsWidth}px` } as CSSProperties) : undefined}
      >
        <section className="player-region">
          <PlayerSkeleton poster={hint?.poster} />
          <TransportSkeleton steps={steps} />
        </section>
        {/* The splitter's grid column (zero wide), so the rail lands in its own column. */}
        <span />
        <aside className="timeline-panel">
          <div className="section-heading">
            <Line width={34} />
            <Line width={36} className="sk-faint" />
          </div>
          <StepRows count={Math.min(steps, 16)} />
        </aside>
      </div>
      {collapsed ? null : <div className="skeleton-divider" aria-hidden="true" />}
      <div className="inspector" aria-hidden="true">
        <div className="inspector-tabs sk-tabs">
          {TAB_WIDTHS.map((tab, index) => (
            <span key={index} className="sk-tab">
              <Line width={tab} />
            </span>
          ))}
          <span className="sk-slot sk-tabs-end">
            <Glyph size={14} />
          </span>
        </div>
        {collapsed ? null : (
          <div className="sk-table">
            <div className="sk-table-head">
              <Line width={28} className="sk-faint" />
              <Line width={52} className="sk-faint" />
            </div>
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="sk-table-row">
                <Line width={36} className="sk-faint" />
                <Line width={`${width(row + 3) * 0.6}%`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PhoneSkeleton({ hint }: { hint: OpenHint | undefined }) {
  const steps = hint?.steps ?? 10;
  return (
    <>
      <div className="topbar app-topbar topbar-compact sk-topbar" aria-hidden="true">
        <span className="sk-slot sk-slot-touch" data-skel="back">
          <Glyph />
        </span>
        <span data-skel="title" className="sk-title">
          <Line width="min(180px, 100%)" className="sk-line-title" />
        </span>
        <span className="topbar-actions" data-skel="actions">
          {[0, 1, 2].map((index) => (
            <span key={index} className="sk-slot sk-slot-touch">
              <Glyph />
            </span>
          ))}
        </span>
        <ProgressHint />
      </div>
      <div className="workspace" aria-hidden="true">
        <section className="player-region">
          <PlayerSkeleton poster={hint?.poster} />
          <TransportSkeleton steps={steps} />
        </section>
      </div>
      <div className="inspector" aria-hidden="true">
        <div className="inspector-tabs sk-tabs sk-tabs-phone">
          {[0, 1, 2, 3, 4].map((index) => (
            <span key={index} className="sk-tab">
              <Glyph />
              {index < 4 ? <Line width={22} className="sk-faint" /> : null}
            </span>
          ))}
          <span className="sk-slot sk-tabs-end">
            <Glyph size={14} />
          </span>
        </div>
        <div className="inspector-panel">
          <StepRows count={Math.min(steps, 12)} phone />
        </div>
      </div>
    </>
  );
}

function SuiteSidebarSkeleton() {
  return (
    <aside className="suite-sidebar" aria-hidden="true">
      <div className="suite-sidebar-head sk-sidebar-head">
        <span className="sk-stack">
          <Line width="82%" />
          <Line width="46%" className="sk-faint" />
        </span>
      </div>
      <div className="suite-run-list">
        {[0, 1, 2].map((index) => (
          <div key={index} className="suite-run-item sk-run">
            <Line width={16} className="sk-faint" />
            <span className="sk-stack">
              <Line width={`${width(index + 1)}%`} />
              <Line width="38%" className="sk-faint" />
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Loading is a single layout, replaced as soon as content is ready. CSS delays its entrance for fast loads. */
export function LoadingSwap({ ready, skeleton, children }: { ready: boolean; skeleton: ReactNode; children: ReactNode }) {
  return <>{ready ? children : skeleton}</>;
}
