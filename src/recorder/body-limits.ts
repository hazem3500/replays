/** Limits for captured bodies; each can only be lowered from `DEFAULT_BODY_LIMITS`. */
export type RecorderBodyLimits = {
  /** Bytes kept per body before it is cut with `truncated: true`. */
  maxBytes?: number;
  /** MIME types (`application/json`) or families (`text/*`) whose bodies are kept. */
  contentTypes?: readonly string[];
};

/** 64 KiB of JSON, text or form data, the same defaults as the capture CLI. */
export const DEFAULT_BODY_LIMITS: Readonly<Required<RecorderBodyLimits>> = Object.freeze({
  maxBytes: 64 * 1024,
  contentTypes: Object.freeze(['application/json', 'application/*+json', 'text/*', 'application/x-www-form-urlencoded']),
});

/** True when `mimeType` (parameters ignored) matches one of `allowed` (`text/*`, `application/*+json`, exact). */
export function contentTypeAllowed(mimeType: string | undefined, allowed: readonly string[]): boolean {
  const type = mimeType?.split(';')[0]?.trim().toLowerCase();
  if (!type) return false;
  const [family, subtype = ''] = type.split('/');
  return allowed.some((pattern) => {
    if (pattern === type) return true;
    const [allowedFamily, allowedSubtype = ''] = pattern.split('/');
    if (allowedFamily !== family) return false;
    if (allowedSubtype === '*') return true;
    return allowedSubtype.startsWith('*+') && subtype.endsWith(allowedSubtype.slice(1));
  });
}
