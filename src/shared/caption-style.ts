/**
 * How the edit list's captions look (size, position, background), saved with the edits and drawn the same way by
 * the viewer, the editor's preview and the video export: each sets these values as data attributes on the caption
 * host, and one stylesheet (src/client/caption-style.css) reads them. Omitted values mean the defaults.
 */

export const CAPTION_SIZES = ['s', 'm', 'l'] as const;
export const CAPTION_POSITIONS = ['bottom', 'top'] as const;
export const CAPTION_BACKGROUNDS = ['solid', 'translucent'] as const;
export type CaptionSize = (typeof CAPTION_SIZES)[number];
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export type CaptionBackground = (typeof CAPTION_BACKGROUNDS)[number];

export interface ReplayCaptionStyle {
  size?: CaptionSize;
  position?: CaptionPosition;
  background?: CaptionBackground;
}

export const DEFAULT_CAPTION_STYLE: Required<ReplayCaptionStyle> = { size: 'm', position: 'bottom', background: 'solid' };

const OPTIONS = { size: CAPTION_SIZES, position: CAPTION_POSITIONS, background: CAPTION_BACKGROUNDS } as const;
const FIELDS = Object.keys(OPTIONS) as Array<keyof ReplayCaptionStyle>;

export function assertCaptionStyle(value: unknown, name = 'captionStyle'): asserts value is ReplayCaptionStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const style = value as Record<string, unknown>;
  for (const key of Object.keys(style)) if (!FIELDS.includes(key as keyof ReplayCaptionStyle)) throw new Error(`${name}.${key} is not a supported field`);
  for (const key of FIELDS) {
    const allowed: readonly string[] = OPTIONS[key];
    if (style[key] !== undefined && !allowed.includes(style[key] as string)) throw new Error(`${name}.${key} must be one of ${allowed.join(', ')}`);
  }
}

/** Only the values that differ from the defaults; undefined when nothing does. */
export function normalizeCaptionStyle(style: ReplayCaptionStyle | undefined): ReplayCaptionStyle | undefined {
  if (!style) return undefined;
  const normalized: ReplayCaptionStyle = {};
  for (const key of FIELDS) {
    const value = style[key];
    const allowed: readonly string[] = OPTIONS[key];
    if (value !== undefined && allowed.includes(value) && value !== DEFAULT_CAPTION_STYLE[key]) Object.assign(normalized, { [key]: value });
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

/** Every value, defaults filled in. */
export function resolveCaptionStyle(style: ReplayCaptionStyle | undefined): Required<ReplayCaptionStyle> {
  return { ...DEFAULT_CAPTION_STYLE, ...normalizeCaptionStyle(style) };
}

/** The caption host's data attributes (React props or `element.dataset` keys via `setAttribute`). */
export function captionStyleData(style: ReplayCaptionStyle | undefined) {
  const resolved = resolveCaptionStyle(style);
  return {
    'data-caption-size': resolved.size,
    'data-caption-position': resolved.position,
    'data-caption-background': resolved.background,
  } as const;
}
