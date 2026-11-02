/** CUA Cursor Motion's six trajectory styles (`@trycua/cursor-motion` `MOTION_STYLES`); the first is the default. */
export const CURSOR_MOTION_STYLES = ['signature_arc', 'spring_settle', 'magnetic', 'comet_swoop', 'adaptive', 'classic'] as const;
export type CursorMotionStyle = (typeof CURSOR_MOTION_STYLES)[number];
export const DEFAULT_CURSOR_MOTION_STYLE: CursorMotionStyle = 'signature_arc';

export const isCursorMotionStyle = (value: unknown): value is CursorMotionStyle =>
  typeof value === 'string' && (CURSOR_MOTION_STYLES as readonly string[]).includes(value);

/**
 * Built-in cursor themes (`cursor.themes` slot items, src/client/cursor-themes.ts); the first is the default.
 * Plugins and deployments add `plugin:<owner>:<id>` themes; a saved id whose plugin is absent draws the default.
 */
export const CORE_CURSOR_APPEARANCES = ['core:arrow', 'core:classic-arrow', 'core:dot', 'core:ring', 'core:hand', 'core:agent'] as const;
export type CoreCursorAppearance = (typeof CORE_CURSOR_APPEARANCES)[number];
export const DEFAULT_CURSOR_APPEARANCE: CoreCursorAppearance = 'core:arrow';
/** The slot item id rule (src/client/plugins/slots.ts), with `core:` limited to the built-ins above. */
const PLUGIN_THEME_ID = /^plugin:(?:user:)?[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

export const isCursorAppearance = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 120 &&
  ((CORE_CURSOR_APPEARANCES as readonly string[]).includes(value) || PLUGIN_THEME_ID.test(value));

/**
 * Cursor tints, each a design token's value (styles.css): the light accent, the dark accent, success, the dark warning
 * and danger hues, and light text. Fixed hex rather than `var()`, so a video export never depends on the app's theme.
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
export const CURSOR_COLOR_NAMES = Object.keys(CURSOR_COLORS) as CursorColor[];

export const isCursorColor = (value: unknown): value is CursorColor => typeof value === 'string' && Object.hasOwn(CURSOR_COLORS, value);

/** Replay-wide cursor presentation. Omitted fields preserve the original CUA arrow behavior. */
export interface ReplayCursorSettings {
  visible?: boolean;
  /** Multiplier of the existing 32 px canvas (the arrow itself is about 19 px tall). */
  size?: number;
  hideWhenIdle?: boolean;
  clickFeedback?: boolean;
  /** How the cursor travels between recorded targets; `signature_arc` when omitted. */
  motionStyle?: CursorMotionStyle;
  /** Which cursor theme draws it (`cursor.themes` item id); `core:arrow` when omitted. */
  appearance?: string;
  /** A tint for themes that take one; the theme's own colours when omitted. */
  color?: CursorColor | undefined;
}

const CURSOR_FIELDS = ['visible', 'size', 'hideWhenIdle', 'clickFeedback', 'motionStyle', 'appearance', 'color'];

/** Validates saved cursor settings (the `cursor` of an edit list). Throws an Error naming the field. */
export function assertReplayCursor(value: unknown, name = 'cursor'): asserts value is ReplayCursorSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const cursor = value as Record<string, unknown>;
  for (const key of Object.keys(cursor)) if (!CURSOR_FIELDS.includes(key)) throw new Error(`${name}.${key} is not a supported field`);
  for (const key of ['visible', 'hideWhenIdle', 'clickFeedback']) {
    if (cursor[key] !== undefined && typeof cursor[key] !== 'boolean') throw new Error(`${name}.${key} must be a boolean`);
  }
  if (
    cursor.size !== undefined &&
    (typeof cursor.size !== 'number' || !Number.isFinite(cursor.size) || cursor.size < 0.5 || cursor.size > 2)
  )
    throw new Error(`${name}.size must be from 0.5 to 2`);
  if (cursor.motionStyle !== undefined && !isCursorMotionStyle(cursor.motionStyle)) {
    throw new Error(`${name}.motionStyle must be one of ${CURSOR_MOTION_STYLES.join(', ')}`);
  }
  if (cursor.appearance !== undefined && !isCursorAppearance(cursor.appearance)) {
    throw new Error(`${name}.appearance must be one of ${CORE_CURSOR_APPEARANCES.join(', ')} or a plugin:<owner>:<id> theme`);
  }
  if (cursor.color !== undefined && !isCursorColor(cursor.color))
    throw new Error(`${name}.color must be one of ${CURSOR_COLOR_NAMES.join(', ')}`);
}

export function normalizeCursor(settings: ReplayCursorSettings | undefined): ReplayCursorSettings | undefined {
  if (!settings) return undefined;
  const cursor: ReplayCursorSettings = {
    ...(settings.visible === false ? { visible: false } : {}),
    ...(settings.size !== undefined && settings.size !== 1 ? { size: settings.size } : {}),
    ...(settings.hideWhenIdle === false ? { hideWhenIdle: false } : {}),
    ...(settings.clickFeedback === false ? { clickFeedback: false } : {}),
    ...(isCursorMotionStyle(settings.motionStyle) && settings.motionStyle !== DEFAULT_CURSOR_MOTION_STYLE
      ? { motionStyle: settings.motionStyle }
      : {}),
    ...(isCursorAppearance(settings.appearance) && settings.appearance !== DEFAULT_CURSOR_APPEARANCE
      ? { appearance: settings.appearance }
      : {}),
    ...(isCursorColor(settings.color) ? { color: settings.color } : {}),
  };
  return Object.keys(cursor).length ? cursor : undefined;
}
