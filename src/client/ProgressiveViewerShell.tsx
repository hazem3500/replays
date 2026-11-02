import { ChevronLeftIcon } from 'lucide-react';
import { type CSSProperties, useState } from 'react';

import { readOpenHint, readViewerLoadingLayout } from './viewer/open-hint.ts';
import { useMediaQuery, MOBILE_QUERY } from './media.ts';
import { indexReturnHref } from './route.ts';
import { InspectorCollapseButton, InspectorNavigation } from './viewer/InspectorNavigation.tsx';
import { inspectorTabItems } from './viewer/inspector-tabs.tsx';
import type { ReplayBundle } from '../shared/replay.ts';
import { ViewerBackLink, ViewerPageTitle, ViewerTopbarFrame } from './viewer/presentation.tsx';
import {
  LoadingPanel,
  LoadingPlayer,
  LoadingSteps,
  LoadingTopbarActions,
  LoadingTransport,
  ProgressHint,
} from './viewer/LoadingParts.tsx';
import { usePreloadPanel } from './hooks/use-preload-panel.ts';
import { useShellHandover } from './hooks/use-shell-handover.ts';
import { writeStorage } from './storage.ts';
import './viewer/loading-shell.css';

/**
 * The replay page while its bundle and player code load: the real chrome (top bar, transport, tabs, headers) at
 * once, placeholders only for data (viewer/LoadingParts.tsx), and a per-region hand-over to the ready page.
 */
export function ProgressiveViewerShell({
  title,
  activePanel,
  onPanelChange,
  bundle,
  onNavigationFocusChange,
  status = 'Loading replay',
}: {
  /** What screen readers hear while it loads ("Loading review suite", "Loading run"). */
  status?: string;
  title?: string;
  activePanel: string;
  onPanelChange: (panel: string) => void;
  bundle?: ReplayBundle;
  onNavigationFocusChange?: (focused: boolean) => void;
}) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [hint] = useState(readOpenHint);
  const [shape] = useState(() => readViewerLoadingLayout(hint));
  const [collapsed, setCollapsedState] = useState(shape.collapsed);
  const setCollapsed = (next: boolean) => {
    setCollapsedState(next);
    writeStorage('replays-inspector-collapsed', next ? '1' : '0');
  };
  const selectPanel = (next: string) => {
    if (collapsed) setCollapsed(false);
    onPanelChange(next);
  };
  const stepCount = bundle?.steps.length ?? hint?.steps;
  const hasSteps = stepCount === undefined || stepCount > 0;
  // invariant: the ready viewer folds the rail to a 0 px column (Viewer.tsx); the shell keeps the same geometry.
  const railFolded = hasSteps && !mobile && shape.railCollapsed;
  const stepsWidth = railFolded ? 0 : shape.stepsWidth;
  // why: the ready Inspector's row minus what needs the replay's data (badges) or plugins keeps tabs in the same places.
  const items = inspectorTabItems({ stepCount: stepCount ?? 0, rail: hasSteps && !mobile });
  const selected = items.find((item) => item.id === activePanel) ?? items[0];
  const panel = selected?.id ?? 'console';
  const label = selected?.label ?? 'Replay';
  const ratio = bundle?.meta.viewport.height
    ? bundle.meta.viewport.width / bundle.meta.viewport.height
    : hint?.viewport && hint.viewport.height > 0
      ? hint.viewport.width / hint.viewport.height
      : 16 / 10;
  const poster = hint?.poster;
  usePreloadPanel(panel);
  // What each region shows, for the hand-over: real rows (from the bundle) settle, placeholders fade in their place.
  useShellHandover(
    `player ${bundle?.steps.length ? 'steps-data' : 'steps'} ${panel === 'console' && bundle?.console.length ? 'panel-data' : 'panel'}`,
  );

  return (
    <main
      className="app-shell skeleton-shell progressive-viewer-loading"
      data-mobile={mobile || undefined}
      data-inspector-collapsed={collapsed || undefined}
      aria-label="Replay"
      onFocusCapture={(event) => {
        const target = event.target;
        onNavigationFocusChange?.(target instanceof HTMLElement && Boolean(target.closest('.inspector-navigation')));
      }}
      onBlurCapture={(event) => {
        const target = event.target;
        const next = event.relatedTarget;
        if (
          target instanceof HTMLElement &&
          target.closest('.inspector-navigation') &&
          !(next instanceof HTMLElement && next.closest('.inspector-navigation'))
        )
          onNavigationFocusChange?.(false);
      }}
      style={
        {
          '--inspector-height': collapsed && !mobile ? 'var(--inspector-folded-height)' : `${shape.height}px`,
          '--steps-width': stepsWidth === undefined ? undefined : `${stepsWidth}px`,
          '--sk-ratio': String(ratio),
          '--viewport-ratio': `${ratio} / 1`,
        } as CSSProperties
      }
    >
      <span className="visually-hidden" role="status">
        {status}…
      </span>
      <ViewerTopbarFrame compact={mobile}>
        <ViewerBackLink href={indexReturnHref()} label="All replays">
          <ChevronLeftIcon aria-hidden="true" />
        </ViewerBackLink>
        <ViewerPageTitle id="replay-title">
          <span className="topbar-title-text">{title ?? bundle?.meta.title ?? hint?.title ?? 'Replay'}</span>
        </ViewerPageTitle>
        <LoadingTopbarActions compact={mobile} />
        <ProgressHint />
      </ViewerTopbarFrame>
      <div className={`workspace${hasSteps && !mobile ? '' : ' no-steps'}`} data-rail-collapsed={railFolded || undefined}>
        <section className="player-region" aria-label="Replay" aria-busy="true">
          <LoadingPlayer poster={poster} />
          <LoadingTransport steps={stepCount ?? 0} />
        </section>
        {hasSteps && !mobile ? (
          <>
            <span aria-hidden="true" />
            {railFolded ? null : (
              <aside className="timeline-panel" aria-label="Steps" aria-busy="true">
                <div className="section-heading">
                  <h2>Steps</h2>
                  {stepCount === undefined ? null : <span className="section-count">{stepCount}</span>}
                </div>
                <span className="visually-hidden" role="status">
                  Loading steps…
                </span>
                <LoadingSteps count={stepCount ?? 5} steps={bundle?.steps} />
              </aside>
            )}
          </>
        ) : null}
      </div>
      {!collapsed && !mobile ? <div className="skeleton-divider" aria-hidden="true" /> : null}
      <section className="inspector progressive-inspector" aria-label="Replay panels" data-collapsed={collapsed || undefined}>
        <div className="inspector-tabs">
          <InspectorNavigation
            items={items}
            activePanel={panel}
            onPanelChange={selectPanel}
            trailing={<InspectorCollapseButton collapsed={collapsed} onCollapsedChange={setCollapsed} compact={mobile} />}
          />
        </div>
        <div
          className="inspector-panel"
          id={`${panel}-panel`}
          role="tabpanel"
          aria-labelledby={`${panel}-tab`}
          aria-busy="true"
          hidden={collapsed}
        >
          <span className="visually-hidden" role="status">
            Loading {label}…
          </span>
          <LoadingPanel panel={panel} bundle={bundle} />
        </div>
      </section>
    </main>
  );
}
