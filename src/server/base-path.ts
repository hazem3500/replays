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
 *
 * One process can serve several addresses at different bases (`hosts` in the config, `HostRouting`): a request whose
 * host is listed gets that host's base, every other host the default one. The base is then chosen per request
 * (`hostBase`), and every response says `Vary: Host` (`hostVary`), because the same path means a different route
 * (and index.html, redirects and upload receipts differ) from one host to the next.
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

/** `Host` / `X-Forwarded-Host` value → lower-case name without port or trailing dot (`[::1]:80` → `[::1]`). */
export function hostName(value: string | undefined) {
  const host = (value ?? '').trim().toLowerCase();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d*$/, '');
  return name.replace(/\.$/, '');
}

const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/** One entry of `hosts` in the config: the base this host is served at (`''` or `'/'` for the root). */
export interface HostConfig {
  basePath: string;
}

/** The per-host bases, checked and normalized: what `createApp` routes by. */
export interface HostRouting {
  /** Lower-case host name (no port) → its base (`''` or `/a/b`). */
  bases: ReadonlyMap<string, string>;
  /** Read the host from the last `X-Forwarded-Host` value (the one the nearest proxy wrote) instead of `Host`. */
  trustForwardedHost: boolean;
}

/**
 * Checks `hosts` (`{ 'replays.example.com': { basePath: '' } }`) and normalizes it: host names are plain DNS names
 * (no scheme, port, path or wildcard), compared case-insensitively; each base goes through `normalizeBasePath`.
 */
export function normalizeHosts(input: unknown, trustForwardedHost = false): HostRouting {
  const bases = new Map<string, string>();
  if (input !== undefined) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('hosts must be an object of host name → { basePath }');
    for (const [key, value] of Object.entries(input)) {
      const name = key.trim().toLowerCase().replace(/\.$/, '');
      if (!HOST_NAME.test(name)) throw new Error(`hosts: ${JSON.stringify(key)} is not a host name like "replays.example.com"`);
      if (bases.has(name)) throw new Error(`hosts: ${JSON.stringify(key)} is listed twice`);
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as HostConfig).basePath !== 'string')
        throw new Error(`hosts[${JSON.stringify(key)}] must be { basePath: "/" | "/path" }`);
      const extra = Object.keys(value).filter((field) => field !== 'basePath');
      if (extra.length) throw new Error(`hosts[${JSON.stringify(key)}] has unknown keys: ${extra.join(', ')}`);
      try {
        bases.set(name, normalizeBasePath((value as HostConfig).basePath));
      } catch {
        throw new Error(
          `hosts[${JSON.stringify(key)}].basePath must be "/" or an absolute path like "/replays" (got ${JSON.stringify((value as HostConfig).basePath)})`,
        );
      }
    }
  }
  return { bases, trustForwardedHost };
}

/** The host a request was addressed to: `Host`, or the last `X-Forwarded-Host` value when trusted. */
export function requestHost(headers: Record<string, string | string[] | undefined>, trustForwardedHost: boolean) {
  const forwarded = headers['x-forwarded-host'];
  if (trustForwardedHost && forwarded) {
    const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded).split(',').at(-1);
    if (last?.trim()) return hostName(last);
  }
  const host = headers.host;
  return hostName(Array.isArray(host) ? host[0] : host);
}

/** The base of a request: its host's entry in `hosts`, else `fallback` (the global `basePath`). */
export function hostBase(headers: Record<string, string | string[] | undefined>, routing: HostRouting | undefined, fallback: string) {
  if (!routing?.bases.size) return fallback;
  return routing.bases.get(requestHost(headers, routing.trustForwardedHost)) ?? fallback;
}

/** The `Vary` value for responses that depend on the requesting host; undefined when every host shares one base. */
export function hostVary(routing: HostRouting | undefined) {
  if (!routing?.bases.size) return undefined;
  return routing.trustForwardedHost ? 'Host, X-Forwarded-Host' : 'Host';
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
  /** JSON list of the deployment's purposes (`<meta name="app-purposes">`); absent when there are none. */
  purposes?: string;
  /** JSON list of the plugins' browser entries (`<meta name="app-plugins">`); see src/server/plugin-runtime.ts. */
  plugins?: string;
  /** Browser chrome colour per scheme (`<meta name="theme-color">`): the theme's `page` token; unset keeps the built-in one. */
  themeColor?: { dark?: string; light?: string };
}

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const THEME_COLOR_META = /<meta name="theme-color"[^>]*>/;

/**
 * index.html as served: the base for the client (`<meta name="app-base">`), its relative asset URLs made
 * absolute, the product name in the title, the theme's design tokens as a style block (branding.ts) and its `page`
 * colours as the browser chrome colour (`<meta name="theme-color">`, `data-dark` / `data-light` for the inline
 * script and theme.tsx). The server runs it per request; `replays build-static` runs it once (src/server/static.ts).
 */
export function withBase(html: string, base: string, branding?: PageBranding) {
  let out = html
    .replace('<meta name="app-base" content="" />', `<meta name="app-base" content="${base || '/'}" />`)
    .replace('<meta name="app-base" content="">', `<meta name="app-base" content="${base || '/'}">`)
    .replaceAll(/(\s(?:src|href)=")\.\/(assets\/)/g, `$1${base}/$2`);
  if (branding) {
    out = out.replace('<meta name="app-comments" content="" />', `<meta name="app-comments" content="${branding.comments ? 'on' : ''}" />`);
    out = out.replace('<meta name="app-beta" content="" />', `<meta name="app-beta" content="${escapeHtml(branding.beta ?? '')}" />`);
    out = out.replace(
      '<meta name="app-purposes" content="" />',
      `<meta name="app-purposes" content="${escapeHtml(branding.purposes ?? '')}" />`,
    );
    out = out.replace(
      '<meta name="app-plugins" content="" />',
      `<meta name="app-plugins" content="${escapeHtml(branding.plugins ?? '')}" />`,
    );
    out = out.replaceAll('__PRODUCT_NAME__', escapeHtml(branding.name)).replaceAll('__PRODUCT_LOGO__', escapeHtml(branding.logoUrl ?? ''));
    const color = branding.themeColor;
    if (color?.dark || color?.light)
      out = out.replace(THEME_COLOR_META, (meta) => {
        // A scheme the theme leaves alone keeps the built-in colour index.html ships.
        const current = (scheme: 'dark' | 'light') => new RegExp(` data-${scheme}="([^"]*)"`).exec(meta)?.[1];
        const dark = escapeHtml(color.dark ?? current('dark') ?? '');
        const light = escapeHtml(color.light ?? current('light') ?? '');
        return `<meta name="theme-color" content="${dark}" data-dark="${dark}" data-light="${light}" />`;
      });
    if (branding.tokensCss) out = out.replace('</head>', `<style id="brand-tokens">${branding.tokensCss}</style></head>`);
  }
  return out;
}
