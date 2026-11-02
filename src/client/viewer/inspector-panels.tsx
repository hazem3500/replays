import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react';

import { PanelPending } from './PanelPending.tsx';
import { registerPerformanceTrack } from './performance/scrubber-track.ts';

/*
 * The Issues, Network and Performance panels load with their tab, not with the viewer: TanStack Table/Virtual/DB and
 * the panels' row models stay off the first frame. While a chunk loads the panel shows its own pending state
 * (PanelPending: its toolbar and headers, then stand-in rows), never an empty box.
 */

// why: the scrubber's performance ranges show on every tab, so they register with the dock, not the lazy panel.
registerPerformanceTrack();

const loaders = {
  issues: () => import('./issues/IssuesPanel.tsx'),
  network: () => import('./network/NetworkPanel.tsx'),
  performance: () => import('./performance/PerformancePanel.tsx'),
};

const LazyIssuesPanel = lazy(() => loaders.issues().then((module) => ({ default: module.IssuesPanel })));
const LazyNetworkPanel = lazy(() => loaders.network().then((module) => ({ default: module.NetworkPanel })));
const LazyPerformancePanel = lazy(() => loaders.performance().then((module) => ({ default: module.PerformancePanel })));

/**
 * Starts loading a lazy panel's code (the active tab's, alongside the player), so the tab is usually ready on its
 * first frame. The import is the same one the panel's `lazy` uses, so it resolves at once when the panel renders.
 */
export function preloadPanel(panel: string) {
  if (panel in loaders) void loaders[panel as keyof typeof loaders]().catch(() => undefined);
}

function Loading({ panel, children }: { panel: string; children: ReactNode }) {
  return <Suspense fallback={<PanelPending panel={panel} />}>{children}</Suspense>;
}

export function IssuesTab(props: ComponentProps<typeof LazyIssuesPanel>) {
  return (
    <Loading panel="issues">
      <LazyIssuesPanel {...props} />
    </Loading>
  );
}

export function NetworkTab(props: ComponentProps<typeof LazyNetworkPanel>) {
  return (
    <Loading panel="network">
      <LazyNetworkPanel {...props} />
    </Loading>
  );
}

export function PerformanceTab(props: ComponentProps<typeof LazyPerformancePanel>) {
  return (
    <Loading panel="performance">
      <LazyPerformancePanel {...props} />
    </Loading>
  );
}
