import { createContext, useContext } from 'react';

import type { FrameBand } from './performance/frames.ts';
import type { ReplayStep } from '../../shared/replay.ts';
import type { ReplayError } from '../issues.ts';
import type { ProjectedHighlight } from '../../shared/highlights.ts';

export type BuiltinInspectorTab = 'console' | 'network' | 'waterfall' | 'performance' | 'context';
/** A tab a client plugin registered: `plugin:<plugin>:<id>` (src/client/plugins/). */
export type PluginInspectorTab = `plugin:${string}`;
/** A tab a built-in viewer feature registered (src/client/plugins/features.tsx): comments. */
export type FeatureInspectorTab = 'comments';
export type InspectorTab = BuiltinInspectorTab | PluginInspectorTab | FeatureInspectorTab;

const NAMED_TABS: readonly string[] = ['console', 'network', 'waterfall', 'performance', 'context', 'comments'];

/** A stored or preset tab id the inspector can show; anything else falls back to another tab. */
export function isInspectorTab(value: string | undefined): value is InspectorTab {
  return value !== undefined && (NAMED_TABS.includes(value) || /^plugin:\S+$/.test(value));
}

/**
 * Viewer-level data and actions shared by the transport, header, step rail and shortcuts. The value is
 * stable for a replay: UI state that changes (the inspector tab, the expanded request) is passed to the
 * Inspector as props instead, so switching tabs does not re-render every consumer of this context.
 */
export interface ViewerActions {
  steps: ReplayStep[];
  errors: ReplayError[];
  setTab: (tab: InspectorTab) => void;
  setExpandedRequest: (id: string | undefined) => void;
  goToStep: (index: number) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  jumpToError: (error: ReplayError) => void;
  goToNextError: () => void;
  goToPreviousError: () => void;
  copyLink: () => void;
  switchFullscreen: () => void;
  openShortcuts: () => void;
  notify: (message: string) => void;
  /** Step captions on the player (off until turned on; the choice is remembered). */
  captions: boolean;
  switchCaptions: () => void;
  /** Viewer-only step numbering (off by default); absent in editor contexts, never applied to saved captions or exports. */
  captionNumbers?: boolean;
  setCaptionNumbers?: (show: boolean) => void;
  /**
   * The saved edit list's version (src/shared/edits.ts editsVersion), '' when unedited: video exports always apply
   * the edits, and name this version so a running export keeps to it.
   */
  editsVersion?: string;
  /** The saved edits carry their own captions: they replace the step captions (and their switch). */
  editCaptions?: boolean;
  /** Saved navigation marks mapped onto the playback timeline. */
  highlights?: ProjectedHighlight[];
  /** The open view's built-in seek bar tracks (`core:steps`, `core:errors`, `core:highlights`); undefined shows all. */
  tracks?: readonly string[] | undefined;
  /** The open view's inspector tab order (views/resolve.ts `orderTabs`): listed tabs lead. */
  tabOrder?: readonly string[] | undefined;
  /** The replay or suite is about performance (shared/performance-focus.ts): frame rate shows on the player and in the Performance tab. */
  performanceFocused?: boolean;
  /** Frame rate per second of recording on the player's clock; empty when frame timing was not recorded. */
  frames?: readonly FrameBand[];
}

export const ViewerContext = createContext<ViewerActions | null>(null);

export function useViewer() {
  const viewer = useContext(ViewerContext);
  if (!viewer) throw new Error('useViewer needs a ViewerContext provider');
  return viewer;
}
