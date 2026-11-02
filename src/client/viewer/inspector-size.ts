/** The diagnostics panel's default share of the window: about six table rows at 1280×800. */
const DEFAULT_SHARE = 0.42;
export const MIN_INSPECTOR_HEIGHT = 120;
const FLOOR = 260;

/** The panel's tallest size: the player keeps 40 % of the window. */
export function maxInspectorHeight(viewport = window.innerHeight) {
  return Math.max(MIN_INSPECTOR_HEIGHT, Math.round(viewport * 0.6));
}

/**
 * The panel's height before the person sizes it. Shared by the loading shells and the ready viewer, so the
 * player keeps its geometry through the hand-over.
 */
export function defaultInspectorHeight(viewport = window.innerHeight) {
  return Math.min(Math.max(FLOOR, Math.round(viewport * DEFAULT_SHARE)), maxInspectorHeight(viewport));
}
