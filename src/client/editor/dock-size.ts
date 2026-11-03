/** The editor's timeline dock height, shared with its loading skeleton so the stage does not jump when it loads. */
export const EDITOR_DOCK = {
  storageKey: 'replays-editor-dock-height',
  height: 188,
  // why: playback, ruler and clip fit without reserving a permanent instruction row.
  min: 124,
} as const;
