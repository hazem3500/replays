/**
 * The editor's timeline dock height, shared with its loading skeleton so the stage does not jump when it loads; the
 * dock grows past it to hold every lane, so the default is the bar, ruler and clip alone (no taller than its content).
 */
export const EDITOR_DOCK = {
  storageKey: 'replays-editor-dock-height',
  height: 140,
  // why: playback, ruler and clip fit without reserving a permanent instruction row.
  min: 124,
} as const;
