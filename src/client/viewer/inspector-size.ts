import { readStorage } from '../storage.ts';

/** The person's diagnostics panel height, per browser (the key predates the splitter, so saved sizes survive). */
export const INSPECTOR_HEIGHT_KEY = 'replays-inspector-height';
export const MIN_INSPECTOR_HEIGHT = 120;
/** The steps rail is folded on wide screens ('1'), per browser. */
export const RAIL_COLLAPSED_KEY = 'replays-steps-collapsed';
/** The panel's default share of the window: about nine table rows at 1280×800, not three. */
const DEFAULT_SHARE = 0.42;
const FLOOR = 260;

/** The panel's tallest size: the player keeps 40 % of the window. */
export function maxInspectorHeight(viewport = window.innerHeight) {
  return Math.max(MIN_INSPECTOR_HEIGHT, Math.round(viewport * 0.6));
}

/**
 * The panel's height before the person sizes it. Shared by the loading skeleton and the ready viewer, so the player
 * keeps its geometry through the hand-over.
 */
export function defaultInspectorHeight(viewport = window.innerHeight) {
  return Math.min(Math.max(FLOOR, Math.round(viewport * DEFAULT_SHARE)), maxInspectorHeight(viewport));
}

export function clampInspectorHeight(height: number) {
  return Math.round(Math.min(Math.max(height, MIN_INSPECTOR_HEIGHT), maxInspectorHeight()));
}

export function initialInspectorHeight() {
  const saved = Number(readStorage(INSPECTOR_HEIGHT_KEY));
  return Number.isFinite(saved) && saved > 0 ? clampInspectorHeight(saved) : defaultInspectorHeight();
}
