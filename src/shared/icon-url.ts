/*
 * Icons that come from plugins and config (a source provider's mark, a bar action's glyph) are URLs, never markup: the
 * viewer draws them as `<img src>`, where an SVG cannot run script or reach the page. Only two kinds qualify: an inline
 * `data:image/svg+xml` image (base64, URL-encoded or plain) and an absolute `https:` URL without credentials.
 */

/** Longest icon URL accepted (an inline SVG mark is a few hundred bytes; this leaves room for a detailed one). */
export const MAX_ICON_URL = 8192;

export function isSafeIconUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ICON_URL) return false;
  // Whatever the SVG holds, an <img> renders it inert (no script, no external loads).
  if (/^data:image\/svg\+xml[;,]/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
