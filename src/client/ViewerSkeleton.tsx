import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useState } from 'react';

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
 * progress line appears under the top bar. `LoadingSwap` keeps it up at least 300 ms once shown and crossfades.
 */

/* Repeated from the viewer chunk (StepRail.tsx, Inspector.tsx, Viewer.tsx); keep in sync. */
const STEPS_WIDTH_KEY = 'replay-kit-steps-width';
const INSPECTOR_HEIGHT_KEY = 'replay-kit-inspector-height';
const INSPECTOR_COLLAPSED_KEY = 'replay-kit-inspector-collapsed';
const DEFAULT_INSPECTOR_HEIGHT = 260;
const MIN_INSPECTOR_HEIGHT = 120;
const INSPECTOR_TABS_HEIGHT = 37;

/**
 * What the page opening the replay already knows (the index writes it before navigating; see OPEN_HINT_KEY):
 * the title, the recording's viewport and step count.
 */
export const OPEN_HINT_KEY = 'replay-kit-open-hint';
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

/** The thin line under the top bar after 1.2 s: indeterminate, or the share downloaded when the size is known. */
function ProgressHint() {
  const progress = useLoadProgress();
  const share = progress?.total ? Math.min(1, progress.loaded / progress.total) : undefined;
  return (
    <span className="sk-progress" data-determinate={share === undefined ? undefined : ''} aria-hidden="true">
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

/**
 * Shows `skeleton` until `ready`, without flashing: a load that finishes inside the skeleton's 150 ms fade-in delay
 * never shows it; once shown it stays at least 300 ms; then the skeleton fades out over the arriving content
 * (180 ms); the content is already there underneath at full opacity, so nothing it shares with the skeleton (the
 * opening frame) dims (styles.css `html[data-skeleton-swap]`).
 */
export function LoadingSwap({ ready, skeleton, children }: { ready: boolean; skeleton: ReactNode; children: ReactNode }) {
  const [mountedAt] = useState(() => performance.now());
  const [phase, setPhase] = useState<'loading' | 'leaving' | 'done'>(ready ? 'done' : 'loading');
  useLayoutEffect(() => {
    if (!ready || phase !== 'loading') return;
    const elapsed = performance.now() - mountedAt;
    // Ready inside the fade-in delay: the skeleton never became visible, so the content simply replaces it.
    const fast = elapsed < SHOW_DELAY_MS;
    const wait = fast ? 0 : Math.max(0, SHOW_DELAY_MS + MIN_VISIBLE_MS - elapsed);
    const timer = window.setTimeout(() => setPhase(fast ? 'done' : 'leaving'), wait);
    return () => window.clearTimeout(timer);
  }, [mountedAt, phase, ready]);
  // Leaving: keep the skeleton fully up until the real page has actually rendered (a lazy chunk can still suspend
  // for a tick), then fade it out over the content and drop it.
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (phase !== 'leaving') return;
    const root = document.documentElement;
    let frame = 0;
    let timer = 0;
    const started = performance.now();
    const arrived = () =>
      document.querySelector('main.app-shell:not(.skeleton-shell), .suite-workspace:not(.skeleton-suite), .state-shell');
    const check = () => {
      if (!arrived() && performance.now() - started < 3000) {
        frame = requestAnimationFrame(check);
        return;
      }
      // Stays set for the page's life: removing it would swap the content's entrance animation and replay it.
      root.dataset.skeletonSwap = '';
      setFading(true);
      timer = window.setTimeout(() => setPhase('done'), CROSSFADE_MS + 20);
    };
    frame = requestAnimationFrame(check);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [phase]);
  if (phase === 'loading') return <>{skeleton}</>;
  if (phase === 'done') return <>{children}</>;
  return (
    <>
      {children}
      <div className="skeleton-overlay" data-fading={fading || undefined} aria-hidden="true">
        {skeleton}
      </div>
    </>
  );
}

const MIN_VISIBLE_MS = 300;
const CROSSFADE_MS = 180;
