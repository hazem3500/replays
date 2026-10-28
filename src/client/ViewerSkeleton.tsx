import './editor/skeleton.css';

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

import { useLoadProgress } from './load-progress.ts';
import { MOBILE_QUERY, useMediaQuery } from './media.ts';
import { readStorage } from './storage.ts';

/** Loading retains the destination's geometry and known poster, without drawing pretend controls or data. */

/*
 * Repeated from the viewer chunk (StepRail.tsx, viewer/inspector-size.ts, Viewer.tsx) to keep it out of every page's
 * bundle; keep in sync. The default panel height is the shell's CSS default (styles.css), the viewer's
 * defaultInspectorHeight().
 */
const STEPS_WIDTH_KEY = 'replays-steps-width';
const RAIL_COLLAPSED_KEY = 'replays-steps-collapsed';
const INSPECTOR_HEIGHT_KEY = 'replays-inspector-height';
const INSPECTOR_COLLAPSED_KEY = 'replays-inspector-collapsed';
const MIN_INSPECTOR_HEIGHT = 120;

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
      : undefined;
  const savedCollapsed = readStorage(INSPECTOR_COLLAPSED_KEY);
  const collapsed = savedCollapsed === '1';
  const savedWidth = Number(readStorage(STEPS_WIDTH_KEY));
  const stepsWidth = readStorage(RAIL_COLLAPSED_KEY) === '1' ? 0 : Number.isFinite(savedWidth) && savedWidth > 0 ? savedWidth : undefined;
  const ratio = hint?.viewport && hint.viewport.height > 0 ? hint.viewport.width / hint.viewport.height : 16 / 10;
  return { height, collapsed, stepsWidth, ratio };
}

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
          ...(collapsed && !mobile
            ? { '--inspector-height': 'var(--inspector-folded-height, 37px)' }
            : shape.height === undefined
              ? {}
              : { '--inspector-height': `${shape.height}px` }),
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
      <LoadingHeader hint={hint} />
      <section className="editor-loading-stage" aria-hidden="true">
        <PlayerSkeleton poster={hint?.poster} />
      </section>
      {mobile ? null : <div className="editor-loading-divider" aria-hidden="true" />}
      <section className="editor-loading-dock" aria-hidden="true">
        <LoadingNotice label="Opening editor" />
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

function LoadingHeader({ hint }: { hint: OpenHint | undefined }) {
  return (
    <div className="topbar app-topbar sk-topbar" aria-hidden="true">
      <span className="loading-title">{hint?.title ?? 'Replay'}</span>
      <ProgressHint />
    </div>
  );
}

function LoadingNotice({ label = 'Opening replay' }: { label?: string }) {
  return (
    <span className="loading-notice">
      <span className="loading-dot" />
      {label}…
    </span>
  );
}

/** The player: the stage's canvas, the recording's frame at its aspect ratio (as the viewer fits it), a faint play glyph. */
function PlayerSkeleton({ poster }: { poster?: string | undefined }) {
  return (
    <div className="stage-wrap">
      <div className="player-stage sk-stage">
        <div className="sk-frame">
          {poster ? <img className="sk-poster" src={poster} alt="" decoding="sync" draggable={false} /> : null}
        </div>
      </div>
    </div>
  );
}

function DesktopSkeleton({
  hint,
  stepsWidth,
  collapsed,
}: {
  hint: OpenHint | undefined;
  stepsWidth: number | undefined;
  collapsed: boolean;
}) {
  return (
    <>
      <LoadingHeader hint={hint} />
      <div
        className="workspace"
        aria-hidden="true"
        style={stepsWidth === undefined ? undefined : ({ '--steps-width': `${stepsWidth}px` } as CSSProperties)}
      >
        <section className="player-region">
          <PlayerSkeleton poster={hint?.poster} />
          <div className="transport loading-transport">
            <LoadingNotice />
          </div>
        </section>
        <span />
        <aside className="timeline-panel" />
      </div>
      {collapsed ? null : <div className="skeleton-divider" aria-hidden="true" />}
      <div className="inspector" aria-hidden="true">
        <div className="inspector-tabs" />
      </div>
    </>
  );
}

function PhoneSkeleton({ hint }: { hint: OpenHint | undefined }) {
  return (
    <>
      <LoadingHeader hint={hint} />
      <div className="workspace" aria-hidden="true">
        <section className="player-region">
          <PlayerSkeleton poster={hint?.poster} />
          <div className="transport loading-transport">
            <LoadingNotice />
          </div>
        </section>
      </div>
      <div className="inspector" aria-hidden="true">
        <div className="inspector-tabs sk-tabs-phone" />
      </div>
    </>
  );
}

function SuiteSidebarSkeleton() {
  return <aside className="suite-sidebar" aria-hidden="true" />;
}

/** Loading is a single layout, replaced as soon as content is ready. CSS delays its entrance for fast loads. */
export function LoadingSwap({ ready, skeleton, children }: { ready: boolean; skeleton: ReactNode; children: ReactNode }) {
  return <>{ready ? children : skeleton}</>;
}
