import './editor/skeleton.css';

import { ChevronDownIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';

import { EditorTopbar } from './editor/EditorTopbar.tsx';
import { editorStrings } from './editor/strings.ts';
import { MOBILE_QUERY, useMediaQuery } from './media.ts';
import { ProgressiveViewerShell } from './ProgressiveViewerShell.tsx';
import { parseRoute, replayHref } from './route.ts';
import { readStorage } from './storage.ts';
import { SuiteSidebarPending } from './suite/SuiteSidebar.tsx';
import { useShellHandover } from './hooks/use-shell-handover.ts';
import { LoadingPlayer, ProgressHint } from './viewer/LoadingParts.tsx';
import { readOpenHint, readViewerLoadingLayout } from './viewer/open-hint.ts';

export { OPEN_HINT_KEY, type OpenHint, readOpenHint, readViewerLoadingLayout } from './viewer/open-hint.ts';
export { ProgressHint } from './viewer/LoadingParts.tsx';

/*
 * The replay, suite and editor pages while they load. One principle throughout (viewer/LoadingParts.tsx): the page's
 * real chrome at once (top bar, transport, tabs, headers, the editor's real top bar), the card's poster where the
 * player will be, and stand-ins only for data that is not known yet, drawn in the real markup and redacted
 * (`.pending`, loading.css), breathing slowly. Nothing shows for waits under --skeleton-delay; the ready page's
 * regions then arrive one by one (html[data-shell-handover]).
 */

/** The replay page's loading layout, standing alone (Suspense fallbacks, the suite route, a run switching in). */
export function ViewerSkeleton({ label = 'Loading replay', suite = false }: { label?: string; suite?: boolean }) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [panel, setPanel] = useState(() => (mobile && (readOpenHint()?.steps ?? 0) > 0 ? 'steps' : 'console'));
  const viewer = <ProgressiveViewerShell activePanel={panel} onPanelChange={setPanel} status={label} />;
  if (!suite || mobile) return viewer;
  return (
    <div className="suite-workspace skeleton-suite">
      {/* The real sidebar, pending (suite/SuiteSidebar.tsx): its own markup with redacted stand-in runs. */}
      <SuiteSidebarPending />
      <div className="suite-viewer">{viewer}</div>
    </div>
  );
}

/**
 * The editor while it loads: its real top bar (back, "Edit", the title, Undo/Redo and Export disabled; Done already
 * works), the stage with the card's poster and the download ring, and the dock as a calm, breathing tile.
 */
export function EditorSkeleton() {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [hint] = useState(readOpenHint);
  useShellHandover('player');
  const [height] = useState(() => {
    const saved = Number(readStorage('replays-editor-dock-height'));
    return Math.round(Math.min(Math.max(Number.isFinite(saved) && saved > 0 ? saved : 168, 148), Math.max(148, window.innerHeight * 0.65)));
  });
  const route = parseRoute(location.pathname, location.search);
  const id = route.kind === 'edit' || route.kind === 'replay' ? route.id : hint?.id;
  const back = id ? replayHref(id) : '/';
  return (
    <main
      className="app-shell skeleton-shell editor-loading"
      data-mobile={mobile || undefined}
      aria-busy="true"
      aria-label="Loading editor"
      data-testid="editor-skeleton"
      style={{ '--editor-loading-height': `${height}px`, '--sk-ratio': String(readViewerLoadingLayout(hint).ratio) } as CSSProperties}
    >
      <span className="visually-hidden" role="status">
        Loading editor…
      </span>
      <div className="editor-loading-topbar">
        <EditorTopbar
          title={hint?.title ?? 'Replay'}
          backHref={back}
          status={null}
          context={{
            canUndo: false,
            canRedo: false,
            undo: noop,
            redo: noop,
            done: () => location.assign(back),
            exportAction: <PendingExport />,
            menu: [],
          }}
        />
        <ProgressHint />
      </div>
      <section className="editor-loading-stage" aria-hidden="true">
        <LoadingPlayer poster={hint?.poster} />
      </section>
      {mobile ? null : <div className="editor-loading-divider" aria-hidden="true" />}
      <section className="editor-loading-dock" aria-hidden="true">
        <div className="editor-loading-tools" />
        <div className="editor-loading-track" />
      </section>
    </main>
  );
}

const noop = () => undefined;

/** The Export control as it will be (EditorExport.tsx), disabled until the editor can render a video. */
function PendingExport() {
  return (
    <span className="inline-flex">
      <Button className="editor-export" disabled>
        {editorStrings.export.button}
        <ChevronDownIcon aria-hidden="true" className="editor-export-chevron" />
      </Button>
    </span>
  );
}

/** Loading is a single layout, replaced as soon as content is ready. CSS delays its placeholders for fast loads. */
export function LoadingSwap({ ready, skeleton, children }: { ready: boolean; skeleton: ReactNode; children: ReactNode }) {
  return <>{ready ? children : skeleton}</>;
}
