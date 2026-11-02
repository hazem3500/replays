import './editor/skeleton.css';
import { DockSkeleton, TopbarActionsSkeleton } from './editor/EditorSkeletonParts.tsx';
import { InspectorSkeleton } from './editor/InspectorSkeleton.tsx';
import { PhoneEditorSkeleton } from './editor/PhoneEditorSkeleton.tsx';

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

import type { ReplayEdits } from '../shared/edits.ts';
import { apiUrl } from './api/fetch.ts';
import { useLoadProgress } from './load-progress.ts';
import { MOBILE_QUERY, useMediaQuery } from './media.ts';
import { readStorage } from './storage.ts';
import { STANDARD_VIEW, viewSettingKey } from './views/settings.ts';
import { currentSearchParam } from './routing/navigate.ts';
import { LoadingPanel, LoadingRail, LoadingTabs, LoadingTopbar, LoadingTransport } from './ViewerLoadingParts.tsx';
import { replayHref } from './routing/links.ts';
import { SuiteSidebarSkeleton, TilesSkeleton } from './SuiteLoadingParts.tsx';
import { Topbar } from './Topbar.tsx';

/** Loading retains the destination's geometry and known poster, without drawing pretend controls or data. */

/*
 * Repeated from the viewer chunk (StepRail.tsx, viewer/inspector-size.ts, Viewer.tsx) to keep it out of every page's
 * bundle; keep in sync. The default panel height is the shell's CSS default (styles.css), the viewer's
 * defaultInspectorHeight().
 */
const STEPS_WIDTH_KEY = 'replays-steps-width';
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
  /** The card's poster, or its opening still when loaded: the frame shows it while loading (transitions/open-hint.ts). */
  poster?: string;
  /** `poster` is the opening still (the replay's first paint), not the list poster. */
  still?: boolean;
  /** A suite card's run count, and how many of those runs have a recording (the tiles its Grid compares). */
  runs?: number;
  recordings?: number;
}

/** The opening still's format version (src/server/posters.ts); bumping it refetches every cached still. */
export const OPEN_STILL_VERSION = 1;

/** A replay's opening still by id: what the player paints first, for loads that no card's poster describes. */
function openStillUrl(id: string) {
  return apiUrl(`replays/${encodeURIComponent(id)}/open?v=${OPEN_STILL_VERSION}`);
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

/** why: skeletons only render in the browser today, but a server render must not throw on `window`. */
function viewportHeight() {
  return typeof window === 'undefined' ? 800 : window.innerHeight;
}

function layout(hint: OpenHint | undefined) {
  // why: the replay's own profile is unknown until it loads, so the skeleton takes the view the URL names, else Standard.
  const view = currentSearchParam('view') ?? STANDARD_VIEW;
  const savedHeight = Number(readStorage(viewSettingKey(view, 'dock-height')));
  const maxHeight = Math.max(MIN_INSPECTOR_HEIGHT, Math.round(viewportHeight() * 0.6));
  const height =
    Number.isFinite(savedHeight) && savedHeight > 0
      ? Math.round(Math.min(Math.max(savedHeight, MIN_INSPECTOR_HEIGHT), maxHeight))
      : undefined;
  const savedCollapsed = readStorage(viewSettingKey(view, 'dock-collapsed'));
  const collapsed = savedCollapsed === '1';
  const savedWidth = Number(readStorage(STEPS_WIDTH_KEY));
  const stepsWidth =
    readStorage(viewSettingKey(view, 'rail-collapsed')) === '1'
      ? 0
      : Number.isFinite(savedWidth) && savedWidth > 0
        ? savedWidth
        : undefined;
  const ratio = hint?.viewport && hint.viewport.height > 0 ? hint.viewport.width / hint.viewport.height : 16 / 10;
  // why: a suite with two or more recordings opens comparing them in its Grid, unless its address names one run.
  const tiles = /\/s\/[^/]+\/r\//.test(location.pathname) ? 0 : (hint?.recordings ?? 0);
  return { height, collapsed, stepsWidth, ratio, tiles };
}

/** A skeleton that disappeared this recently hands over to the next one at once (no second fade-in). */
let lastVisibleAt = Number.NEGATIVE_INFINITY;
const SHOW_DELAY_MS = 150;

function loadingStyle(shape: ReturnType<typeof layout>, mobile: boolean): CSSProperties {
  return {
    ...(shape.collapsed && !mobile
      ? { '--inspector-height': 'var(--inspector-folded-height, 37px)' }
      : shape.height === undefined
        ? {}
        : { '--inspector-height': `${shape.height}px` }),
    '--sk-ratio': String(shape.ratio),
  } as CSSProperties;
}

export function ViewerSkeleton({
  label = 'Loading replay',
  suite = false,
  comparing,
}: {
  label?: string;
  /** The whole suite workspace: its runs sidebar too, and its Grid's tiles when the opened card counted them. */
  suite?: boolean;
  /** A comparison: its bar, and this many tiles when it opens in its Grid (0 for one frame). */
  comparing?: number | undefined;
}) {
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
      style={loadingStyle(shape, mobile)}
    >
      <span className="visually-hidden" role="status">
        {label}…
      </span>
      {mobile ? (
        <PhoneSkeleton hint={hint} />
      ) : (
        <DesktopSkeleton
          hint={hint}
          stepsWidth={shape.stepsWidth}
          collapsed={collapsed}
          compare={suite || comparing !== undefined}
          tiles={comparing ?? (suite ? shape.tiles : 0)}
        />
      )}
    </main>
  );
  if (!suite || mobile) return viewer;
  return (
    <div className="suite-workspace skeleton-suite" data-instant={instant || undefined}>
      <SuiteSidebarSkeleton title={hint?.title} runs={hint?.runs} />
      <div className="suite-viewer">{viewer}</div>
    </div>
  );
}

/**
 * Edit loads draw the loaded editor's own shell (editor-layout.css): the real top bar, the stage frame at its final
 * rect beside the inspector column, the 1 px resizer row and the dock at its saved height, so nothing moves when the
 * editor arrives. Phones draw the phone editor the same way (PhoneEditorSkeleton), with the cached edits' lanes.
 */
export function EditorSkeleton({
  id,
  meta,
  edits,
}: {
  id: string;
  meta?: { title?: string; viewport?: { width: number; height: number }; duration?: number } | undefined;
  /** The last edits seen for this replay, while the fresh copy loads: their lanes are drawn where they will be. */
  edits?: ReplayEdits | undefined;
}) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [stored] = useState(readHint);
  // why: from the viewer the bundle is already cached, so its real title and frame shape replace the guess.
  const hint = meta
    ? { ...stored, id, ...(meta.title ? { title: meta.title } : {}), ...(meta.viewport ? { viewport: meta.viewport } : {}) }
    : stored;
  const [height] = useState(() => {
    const saved = Number(readStorage('replays-editor-dock-height'));
    return Math.round(Math.min(Math.max(Number.isFinite(saved) && saved > 0 ? saved : 168, 148), Math.max(148, viewportHeight() * 0.65)));
  });
  const style = { '--dock-height': `${height}px`, '--sk-ratio': String(layout(hint).ratio) } as CSSProperties;
  const poster = hint?.poster ?? openStillUrl(id);
  if (mobile) {
    return (
      <main
        className="app-shell skeleton-shell editor-loading"
        data-mobile=""
        aria-busy="true"
        aria-label="Loading editor"
        data-testid="editor-skeleton"
        style={style}
      >
        <span className="visually-hidden" role="status">
          Loading editor…
        </span>
        <PhoneEditorSkeleton
          title={hint?.title ?? 'Replay'}
          frame={<PlayerSkeleton poster={poster} />}
          duration={meta?.duration}
          edits={edits}
          progress={<ProgressHint />}
        />
      </main>
    );
  }
  return (
    <main
      className="app-shell editor-shell skeleton-shell editor-loading"
      aria-busy="true"
      aria-label="Loading editor"
      data-testid="editor-skeleton"
      style={style}
    >
      <span className="visually-hidden" role="status">
        Loading editor…
      </span>
      <Topbar
        title={hint?.title ?? 'Replay'}
        prefix="Edit"
        backHref={replayHref(id)}
        backLabel="Back to the replay"
        status={<ProgressHint />}
        actions={<TopbarActionsSkeleton />}
        alwaysMenu
      />
      <section className="editor-stage" aria-hidden="true">
        <PlayerSkeleton poster={poster} />
        <aside className="editor-presentation">
          <InspectorSkeleton />
        </aside>
      </section>
      <div className="inspector-resizer" aria-hidden="true" />
      <DockSkeleton duration={meta?.duration} />
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

/** The player: the stage's canvas, the recording's frame at its aspect ratio (as the viewer fits it), a faint play glyph. */
function PlayerSkeleton({ poster }: { poster?: string | undefined }) {
  // why: a still that is not rendered yet (or posters are off) leaves the plain frame, not a broken image.
  const [failed, setFailed] = useState<string>();
  return (
    <div className="stage-wrap">
      <div className="player-stage sk-stage">
        <div className="sk-frame">
          {poster && failed !== poster ? (
            <img className="sk-poster" src={poster} alt="" decoding="sync" draggable={false} onError={() => setFailed(poster)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DesktopSkeleton({
  hint,
  stepsWidth,
  collapsed,
  compare,
  tiles,
}: {
  hint: OpenHint | undefined;
  stepsWidth: number | undefined;
  collapsed: boolean;
  /** A suite or comparison: the bar has the layout switch, and the title is the focused recording's, not yet known. */
  compare: boolean;
  /** Recordings a suite's Grid compares (0 when it opens on one run). */
  tiles: number;
}) {
  return (
    <>
      <LoadingTopbar title={compare ? undefined : hint?.title} mobile={false} compare={compare} progress={<ProgressHint />} />
      <div
        className={hint?.steps === 0 ? 'workspace no-steps' : 'workspace'}
        aria-hidden="true"
        style={stepsWidth === undefined ? undefined : ({ '--steps-width': `${stepsWidth}px` } as CSSProperties)}
      >
        <section className="player-region">
          <StageSkeleton tiles={tiles} poster={hint?.poster} />
          <LoadingTransport steps={hint?.steps} />
        </section>
        {hint?.steps === 0 ? null : (
          <>
            <span />
            <LoadingRail steps={hint?.steps} />
          </>
        )}
      </div>
      {collapsed ? null : <div className="skeleton-divider" aria-hidden="true" />}
      <div className="inspector" aria-hidden="true">
        <LoadingTabs mobile={false} steps={hint?.steps} />
        {collapsed ? null : <LoadingPanel />}
      </div>
    </>
  );
}

/** The stage while loading: a comparison's Grid of tiles under its headline row, else the one recording's frame. */
function StageSkeleton({ tiles, poster }: { tiles: number; poster: string | undefined }) {
  if (tiles < 2) return <PlayerSkeleton poster={poster} />;
  return (
    <>
      {/* why: two or more recordings open in the Compare view, whose summary headline sits over the stage. */}
      <div className="sk-headline" />
      <TilesSkeleton count={tiles} />
    </>
  );
}

function PhoneSkeleton({ hint }: { hint: OpenHint | undefined }) {
  return (
    <>
      <LoadingTopbar title={hint?.title} mobile progress={<ProgressHint />} />
      <div className="workspace" aria-hidden="true">
        <section className="player-region">
          <PlayerSkeleton poster={hint?.poster} />
          <LoadingTransport steps={hint?.steps} />
        </section>
      </div>
      <div className="inspector" aria-hidden="true">
        <LoadingTabs mobile steps={hint?.steps} />
        <LoadingPanel />
      </div>
    </>
  );
}

/** Loading is a single layout, replaced as soon as content is ready. CSS delays its entrance for fast loads. */
export function LoadingSwap({ ready, skeleton, children }: { ready: boolean; skeleton: ReactNode; children: ReactNode }) {
  return <>{ready ? children : skeleton}</>;
}
