import { useState } from 'react';

import { type InspectorTab, isInspectorTab } from '../viewer/context.ts';
import { initialInspectorHeight } from '../viewer/inspector-size.ts';
import type { ViewDefaults } from '../views/resolve.ts';
import {
  readCaptionsPreference,
  readViewFlag,
  readViewSetting,
  resetViewSettings,
  writeCaptionsPreference,
  writeViewFlag,
  writeViewSetting,
} from '../views/settings.ts';

interface ViewState {
  view: string;
  collapsed: boolean;
  /** A hidden inspector the person opened for this visit ("Show details", a tab key, a jump to an error). */
  revealed: boolean;
  height: number;
  railCollapsed: boolean;
  captions: boolean;
  tab: InspectorTab;
}

interface Opening {
  /** Opening on an error: the tab that holds it, unfolded for this visit (the stored fold stands). */
  errorTab?: InspectorTab | undefined;
  /** The tab when neither the person nor the view picks one. */
  fallbackTab: InspectorTab;
}

function stateFor(view: string, defaults: ViewDefaults, { errorTab, fallbackTab }: Opening): ViewState {
  const tab = errorTab ?? [readViewSetting(view, 'tab'), defaults.tab].find(isInspectorTab) ?? fallbackTab;
  return {
    view,
    collapsed: errorTab ? false : (readViewFlag(view, 'dock-collapsed') ?? defaults.inspector === 'collapsed'),
    revealed: Boolean(errorTab),
    height: initialInspectorHeight(view),
    railCollapsed: readViewFlag(view, 'rail-collapsed') ?? defaults.steps === 'collapsed',
    captions: readCaptionsPreference() ?? defaults.captions,
    tab,
  };
}

type SetState = (update: (current: ViewState) => ViewState) => void;

export interface ViewSetters {
  /** `persist: false` is a change for one action (a shortcut that needs the panel), not a preference. */
  setCollapsed: (next: boolean, persist?: boolean) => void;
  /** The splitter stores committed heights itself (its storage key is this view's). */
  setHeight: (next: number) => void;
  setRailCollapsed: (next: boolean) => void;
  switchCaptions: () => void;
  /** `persist: false` opens a tab for one jump (to an error) without making it the view's default. */
  setTab: (next: InspectorTab, persist?: boolean) => void;
}

/** invariant: each writes storage inside its state update, keyed by the state's own view, so one set serves every view. */
function settersFor(setState: SetState): ViewSetters {
  return {
    setCollapsed(next, persist = true) {
      setState((current) => {
        if (persist) writeViewFlag(current.view, 'dock-collapsed', next);
        return { ...current, collapsed: next, revealed: current.revealed || !next };
      });
    },
    setHeight(next) {
      setState((current) => ({ ...current, height: next }));
    },
    setRailCollapsed(next) {
      setState((current) => {
        writeViewFlag(current.view, 'rail-collapsed', next);
        return { ...current, railCollapsed: next };
      });
    },
    switchCaptions() {
      setState((current) => {
        writeCaptionsPreference(!current.captions);
        return { ...current, captions: !current.captions };
      });
    },
    setTab(next, persist = true) {
      setState((current) => {
        if (persist) writeViewSetting(current.view, 'tab', next);
        return { ...current, tab: next };
      });
    },
  };
}

/**
 * The viewer's layout in one view: the dock's height and fold, the steps rail's fold, captions and the open tab. Each is
 * remembered per view (captions once for all views), else the view's preset decides; switching views swaps them all without remounting anything.
 * The setters keep their identity for the viewer's life; `reset` ("Reset this view") forgets the view's settings.
 */
export function useViewState(view: string, defaults: ViewDefaults, opening: Opening) {
  const [stored, setState] = useState(() => stateFor(view, defaults, opening));
  const [setters] = useState(() => settersFor(setState));
  let state = stored;
  if (stored.view !== view) {
    state = stateFor(view, defaults, { fallbackTab: stored.tab });
    setState(state);
  }
  return {
    ...state,
    ...setters,
    // why: hidden only until the person opens the panel on this visit.
    hidden: defaults.inspector === 'hidden' && !state.revealed,
    reset: () => {
      resetViewSettings(view);
      setState(stateFor(view, defaults, { fallbackTab: opening.fallbackTab }));
    },
  };
}
