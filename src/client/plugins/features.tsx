import type { LucideIcon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import type { EditTimeline } from '../../shared/edits.ts';
import type { ShortcutAction } from '../shortcuts.ts';

/*
 * Built-in viewer features: parts of the viewer that ship with the app but are not wired into its layout. Each registers
 * here (comments does, src/client/comments/feature.ts) and the viewer asks the registry for what to draw: a provider
 * around the whole viewer, a tab in the bottom panel, an overlay on the seek bar. A feature is active when the server
 * loaded the plugin behind it (the page says so), so it is off, in the UI as in the API, when that plugin is absent.
 *
 * This is the React-side twin of the DOM-based plugin API in api.ts, for code that lives in this repository and wants the
 * viewer's own components and state. Deployment plugins use api.ts.
 */

export interface FeatureProviderProps {
  replayId: string;
  /** The saved edits' timeline when they are applied (the beta editor), else undefined. */
  timeline: EditTimeline | undefined;
  /** Bring a tab up by its id (unfolding the bottom panel when it is folded). */
  openPanel: (tab: string) => void;
  /** The feature registers what its keyboard shortcut does (`undefined` when it unmounts). */
  registerStartAction: (start: (() => void) | undefined) => void;
  children: ReactNode;
}

export interface ViewerFeature {
  /** Also the tab's value, so `setTab(id)` opens it. */
  id: string;
  enabled(): boolean;
  /** Wraps the whole viewer: state shared by the tab, the seek bar and the keyboard. */
  Provider?: ComponentType<FeatureProviderProps>;
  tab?: {
    label: string;
    Icon: LucideIcon;
    Panel: ComponentType;
    /** A number shown on the tab. Called on every render of the panel's tab row, so it must be a hook-safe constant call. */
    useBadge?: () => number | undefined;
    /** The shortcut whose key is shown in the tab's tooltip. */
    shortcut?: ShortcutAction;
  };
  /** Drawn inside the seek bar, over the track. */
  ScrubberOverlay?: ComponentType<{ width: number; inset: number }>;
}

const features: ViewerFeature[] = [];

export function registerViewerFeature(feature: ViewerFeature) {
  if (features.some((existing) => existing.id === feature.id)) throw new Error(`viewer feature ${feature.id} is registered twice`);
  features.push(feature);
}

/** Features that are on for this page. Constant for the page's life (the server decides when it renders it). */
export function activeFeatures() {
  return features.filter((feature) => feature.enabled());
}

/** Wraps `children` in every active feature's provider (the first registered outermost). */
export function FeatureProviders({ children, ...props }: Omit<FeatureProviderProps, 'children'> & { children: ReactNode }) {
  return activeFeatures()
    .filter((feature) => feature.Provider)
    .reduceRight<ReactNode>((inner, feature) => {
      const Provider = feature.Provider!;
      return <Provider {...props}>{inner}</Provider>;
    }, children);
}

export function FeatureScrubberOverlays(props: { width: number; inset: number }) {
  return (
    <>
      {activeFeatures().map((feature) => {
        const Overlay = feature.ScrubberOverlay;
        return Overlay ? <Overlay key={feature.id} {...props} /> : null;
      })}
    </>
  );
}

/** Tab badges by feature id. The list of active features never changes while the page is open, so the hook order is stable. */
export function useFeatureBadges() {
  const badges: Record<string, number | undefined> = {};
  for (const feature of activeFeatures()) {
    // oxlint-disable-next-line react/rules-of-hooks
    badges[feature.id] = feature.tab?.useBadge?.();
  }
  return badges;
}

/** Tests only. */
export function resetViewerFeatures() {
  features.length = 0;
}
