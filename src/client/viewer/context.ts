import { createContext, useContext } from 'react';

import type { ReplayStep } from '../../shared/replay.ts';
import type { ReplayError } from '../issues.ts';

export type InspectorTab = 'console' | 'network' | 'performance' | 'context';

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
}

export const ViewerContext = createContext<ViewerActions | null>(null);

export function useViewer() {
  const viewer = useContext(ViewerContext);
  if (!viewer) throw new Error('useViewer needs a ViewerContext provider');
  return viewer;
}
