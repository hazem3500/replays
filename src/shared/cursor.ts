/** Cua Cursor Motion's built-in styles, in Cua Driver's order. `signature_arc` is the original behavior. */
export const CURSOR_MOTION_STYLES = ['signature_arc', 'spring_settle', 'magnetic', 'comet_swoop', 'adaptive', 'classic'] as const;
export type CursorMotionStyle = (typeof CURSOR_MOTION_STYLES)[number];

export const isCursorMotionStyle = (value: unknown): value is CursorMotionStyle =>
  CURSOR_MOTION_STYLES.includes(value as CursorMotionStyle);

/** Replay-wide cursor presentation. Omitted fields preserve the original CUA arrow behavior. */
export interface ReplayCursorSettings {
  visible?: boolean;
  /** Multiplier of the existing 32 px canvas (the arrow itself is about 19 px tall). */
  size?: number;
  hideWhenIdle?: boolean;
  clickFeedback?: boolean;
  /** How the arrow travels between recorded targets. */
  motion?: CursorMotionStyle;
}

export function normalizeCursor(settings: ReplayCursorSettings | undefined): ReplayCursorSettings | undefined {
  if (!settings) return undefined;
  const cursor: ReplayCursorSettings = {
    ...(settings.visible === false ? { visible: false } : {}),
    ...(settings.size !== undefined && settings.size !== 1 ? { size: settings.size } : {}),
    ...(settings.hideWhenIdle === false ? { hideWhenIdle: false } : {}),
    ...(settings.clickFeedback === false ? { clickFeedback: false } : {}),
    ...(settings.motion !== undefined && settings.motion !== 'signature_arc' ? { motion: settings.motion } : {}),
  };
  return Object.keys(cursor).length ? cursor : undefined;
}
