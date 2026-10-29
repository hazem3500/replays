/** Cua Cursor Motion's built-in styles, in Cua Driver's order. `signature_arc` is the original behavior. */
export const CURSOR_MOTION_STYLES = ['signature_arc', 'spring_settle', 'magnetic', 'comet_swoop', 'adaptive', 'classic'] as const;
export type CursorMotionStyle = (typeof CURSOR_MOTION_STYLES)[number];

export const isCursorMotionStyle = (value: unknown): value is CursorMotionStyle =>
  CURSOR_MOTION_STYLES.includes(value as CursorMotionStyle);

/** How the cursor is drawn (src/client/cursor-themes.ts). `arrow` is the CUA arrow and the default. */
export const CURSOR_APPEARANCES = ['arrow', 'classic-arrow', 'hand', 'dot', 'ring', 'agent'] as const;
export type CursorAppearance = (typeof CURSOR_APPEARANCES)[number];

export const isCursorAppearance = (value: unknown): value is CursorAppearance => CURSOR_APPEARANCES.includes(value as CursorAppearance);

/**
 * Cursor tints, each a design token's value (styles.css). Fixed hex rather than `var()`, so a video export never
 * depends on the app's theme.
 */
export const CURSOR_COLORS = {
  accent: '#3d4fd1',
  periwinkle: '#8b9dff',
  green: '#1f7445',
  amber: '#e8bd72',
  coral: '#ff8a7a',
  graphite: '#181b22',
} as const;
export type CursorColor = keyof typeof CURSOR_COLORS;

export const isCursorColor = (value: unknown): value is CursorColor => typeof value === 'string' && Object.hasOwn(CURSOR_COLORS, value);

/** Replay-wide cursor presentation. Omitted fields preserve the original CUA arrow behavior. */
export interface ReplayCursorSettings {
  visible?: boolean;
  /** Multiplier of the existing 32 px canvas (the arrow itself is about 19 px tall). */
  size?: number;
  hideWhenIdle?: boolean;
  clickFeedback?: boolean;
  /** How the arrow travels between recorded targets. */
  motion?: CursorMotionStyle;
  /** Which cursor is drawn; the CUA arrow when omitted. */
  appearance?: CursorAppearance;
  /** A tint for the cursor; its own colors when omitted. */
  color?: CursorColor | undefined;
}

export function normalizeCursor(settings: ReplayCursorSettings | undefined): ReplayCursorSettings | undefined {
  if (!settings) return undefined;
  const cursor: ReplayCursorSettings = {
    ...(settings.visible === false ? { visible: false } : {}),
    ...(settings.size !== undefined && settings.size !== 1 ? { size: settings.size } : {}),
    ...(settings.hideWhenIdle === false ? { hideWhenIdle: false } : {}),
    ...(settings.clickFeedback === false ? { clickFeedback: false } : {}),
    ...(settings.motion !== undefined && settings.motion !== 'signature_arc' ? { motion: settings.motion } : {}),
    ...(settings.appearance !== undefined && settings.appearance !== 'arrow' ? { appearance: settings.appearance } : {}),
    ...(settings.color !== undefined ? { color: settings.color } : {}),
  };
  return Object.keys(cursor).length ? cursor : undefined;
}
