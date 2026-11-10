/**
 * Client-side redaction. Ported from `Replays/src/capture/sanitize.ts` so
 * a bundle is already clean when it leaves the browser; the ingest endpoint
 * must still run its own `sanitizeReplayBundle` pass and never trust this one.
 */

import { traceOnlyServerTiming } from './trace.ts';

// why: exact names plus any `*_token` / `*-secret` / `*_password` / `*-signature` suffix.
const SENSITIVE_QUERY =
  /^(access[-_]?token|api[-_]?key|api[-_]?token|auth|authorization|client[-_]?secret|code|e[-_]?mail|id[-_]?token|jwt|password|refresh[-_]?token|secret|session|signature|token)$|[-_](token|secret|password|signature)$/i;
/** Absolute URLs inside free text (console messages, labels). */
const EMBEDDED_URL = /\b(?:https?|wss?):\/\/[^\s"'`()<>\\]+/gi;
const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})+/g;
/** Long opaque runs: JWTs, API tokens, session ids. */
const OPAQUE_TOKEN = /\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|[A-Za-z0-9_-]{32,})\b/g;

export const REDACTED = '[redacted]';

/**
 * Network headers kept by default. Allow-list, not deny-list: anything not
 * listed (authorization, cookie, set-cookie, x-api-key, custom tokens…) is
 * dropped.
 */
export const DEFAULT_ALLOWED_HEADERS: readonly string[] = [
  'accept',
  'cache-control',
  'content-length',
  'content-type',
  'retry-after',
  'server-timing',
  'traceparent',
  'x-request-id',
  'x-trace-id',
];

function redactParameters(value: string) {
  const parameters = new URLSearchParams(value);
  let changed = false;
  for (const name of new Set(parameters.keys())) {
    if (!SENSITIVE_QUERY.test(name)) continue;
    parameters.set(name, REDACTED);
    changed = true;
  }
  return changed ? parameters.toString() : value;
}

function redactHash(hash: string) {
  if (!hash) return hash;
  const fragment = hash.slice(1);
  const queryStart = fragment.indexOf('?');
  const prefix = queryStart >= 0 ? fragment.slice(0, queryStart + 1) : '';
  const parameters = queryStart >= 0 ? fragment.slice(queryStart + 1) : fragment;
  if (!parameters.includes('=')) return hash;
  return `#${prefix}${redactParameters(parameters)}`;
}

/** Drops URL credentials and redacts sensitive query and hash parameters. */
export function redactUrl(value: string): string {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
    const protocolRelative = value.startsWith('//');
    const relative = value.startsWith('/') || value.startsWith('?');
    if (!absolute && !protocolRelative && !relative) return value;
    const url = new URL(value, 'https://redaction.invalid');
    url.search = redactParameters(url.search.slice(1));
    url.hash = redactHash(url.hash);
    url.username = '';
    url.password = '';
    if (absolute) return url.toString();
    if (protocolRelative) return `//${url.host}${url.pathname}${url.search}${url.hash}`;
    if (value.startsWith('?')) return `${url.search}${url.hash}` || value;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

/**
 * Free text (console messages): embedded URLs are redacted, e-mail addresses
 * and long opaque tokens are replaced, and the result is capped at
 * `maxLength`.
 */
export function redactText(text: string, maxLength = 2_000): string {
  const clean = text
    .replace(EMBEDDED_URL, (match) => redactUrl(match))
    .replace(EMAIL, REDACTED)
    .replace(OPAQUE_TOKEN, REDACTED);
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean;
}

/** Keeps only allow-listed headers (case-insensitive). Values are kept as-is. */
export function filterHeaders(
  headers: Iterable<[string, string]>,
  allowed: readonly string[] = DEFAULT_ALLOWED_HEADERS,
): { name: string; value: string }[] {
  const allow = new Set(allowed.map((name) => name.toLowerCase()));
  const result: { name: string; value: string }[] = [];
  for (const [name, value] of headers) {
    // why: never allow authentication material, even in a host-provided allow-list.
    if (
      allow.has(name.toLowerCase()) &&
      !/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$|(?:^|[-_])(token|secret|password|credential|session|api[-_]?key)(?:$|[-_])/i.test(
        name,
      )
    ) {
      const lower = name.toLowerCase();
      // why: Server-Timing metrics can name internals; only its trace metrics are kept.
      const kept = lower === 'server-timing' ? traceOnlyServerTiming(value) : value;
      if (kept !== undefined) result.push({ name: lower, value: kept });
    }
  }
  return result;
}

/** Replaces every non-whitespace character, like rrweb's default text mask. */
export function maskText(text: string): string {
  return text.replace(/\S/g, '*');
}
