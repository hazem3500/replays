/*
 * Where the app lives, chosen at runtime (`BASE_PATH`):
 *
 * | Shape           | BASE_PATH        | Index              | API                 |
 * | --------------- | ---------------- | ------------------ | ------------------- |
 * | Own domain      | `/` (default)    | `/`                | `/api/…`            |
 * | Under a prefix  | `/tools/replays` | `/tools/replays/`  | `/tools/replays/api/…` |
 *
 * Internally every route has one canonical shape without the prefix (`/api/…`, `/r/<id>`, `/assets/…`).
 * `appPath` maps a request onto it and `publicPath` maps back for links the server writes (upload receipts,
 * redirects). A reverse proxy may strip the prefix before the request reaches the process, so both the prefixed
 * and the bare shape are accepted.
 */

/** `''` at the root of a domain, else `/a/b` (no trailing slash). */
export function normalizeBasePath(value: string | undefined) {
  const raw = (value ?? '').trim();
  if (!raw || raw === '/') return '';
  if (!/^\/[A-Za-z0-9._~/-]*$/.test(raw) || raw.includes('//') || /(^|\/)\.\.?(\/|$)/.test(raw))
    throw new Error(`BASE_PATH must be "/" or an absolute path like "/replays" (got ${JSON.stringify(value)})`);
  return raw.replace(/\/+$/, '');
}

function under(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Maps a request path (`URL.pathname`) onto the canonical route shape (the prefix removed when present). */
export function appPath(pathname: string, base: string) {
  if (base && under(pathname, base)) return pathname.slice(base.length) || '/';
  return pathname;
}

/** The public URL path of a canonical route path (`/r/x` → `/replays/r/x`). */
export function publicPath(path: string, base: string) {
  return `${base}${path || '/'}`;
}

export interface PageBranding {
  name: string;
  /** Inline `<style>` body with the theme's design tokens, or empty. */
  tokensCss: string;
  /** Optional logo URL (absolute path or https). */
  logoUrl?: string;
  /** Enabled beta features, space separated (`editor`); empty when none. */
  beta?: string;
  /** Comments on replays are enabled (`<meta name="app-comments">`). */
  comments?: boolean;
}

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * index.html as served: the base for the client (`<meta name="app-base">`), its relative asset URLs made
 * absolute, the product name in the title, and the theme's design tokens as a style block (branding.ts).
 */
export function withBase(html: string, base: string, branding?: PageBranding) {
  let out = html
    .replace('<meta name="app-base" content="" />', `<meta name="app-base" content="${base || '/'}" />`)
    .replace('<meta name="app-base" content="">', `<meta name="app-base" content="${base || '/'}">`)
    .replaceAll(/(\s(?:src|href)=")\.\/(assets\/)/g, `$1${base}/$2`);
  if (branding) {
    out = out.replace('<meta name="app-comments" content="" />', `<meta name="app-comments" content="${branding.comments ? 'on' : ''}" />`);
    out = out.replace('<meta name="app-beta" content="" />', `<meta name="app-beta" content="${escapeHtml(branding.beta ?? '')}" />`);
    out = out.replaceAll('__PRODUCT_NAME__', escapeHtml(branding.name)).replaceAll('__PRODUCT_LOGO__', escapeHtml(branding.logoUrl ?? ''));
    if (branding.tokensCss) out = out.replace('</head>', `<style id="brand-tokens">${branding.tokensCss}</style></head>`);
  }
  return out;
}
