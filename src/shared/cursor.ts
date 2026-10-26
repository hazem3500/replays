/** Replay-wide cursor presentation. Omitted fields preserve the original CUA arrow behavior. */
export interface ReplayCursorSettings {
  visible?: boolean;
  /** Multiplier of the existing 32 px canvas (the arrow itself is about 19 px tall). */
  size?: number;
  hideWhenIdle?: boolean;
  clickFeedback?: boolean;
}

export function normalizeCursor(settings: ReplayCursorSettings | undefined): ReplayCursorSettings | undefined {
  if (!settings) return undefined;
  const cursor: ReplayCursorSettings = {
    ...(settings.visible === false ? { visible: false } : {}),
    ...(settings.size !== undefined && settings.size !== 1 ? { size: settings.size } : {}),
    ...(settings.hideWhenIdle === false ? { hideWhenIdle: false } : {}),
    ...(settings.clickFeedback === false ? { clickFeedback: false } : {}),
  };
  return Object.keys(cursor).length ? cursor : undefined;
}
