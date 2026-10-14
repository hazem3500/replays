import type { ReplayBundle, ReplayNetworkEntry } from '../shared/replay.ts';

// Exact auth headers plus any `*-token` / `*-secret` / `*-jwt` / `*-assertion` (X-CSRF-Token, X-Amz-Security-Token,
// signed-identity headers set by proxies, ...).
const SENSITIVE_HEADER =
  /^(authorization|cookie|proxy-authorization|set-cookie|x-api-key|x-auth-token|x-forwarded-access-token|x-amz-security-token)$|[-_](token|secret|jwt|assertion)$/i;
const URL_HEADER = /^(content-location|location|origin|referer|referrer)$/i;
const URL_FIELD = /^(action|currentSrc|formAction|href|poster|src|url|xlink:href)$/i;
/** Absolute URLs inside free text: srcset, ping, style/CSS url(), meta content, console messages, labels. */
const EMBEDDED_URL = /\b(?:https?|wss?):\/\/[^\s"'`()<>\\]+/gi;
const NETWORK_FIELDS = new Set([
  'id',
  'at',
  'duration',
  'method',
  'url',
  'status',
  'statusText',
  'mimeType',
  'requestHeaders',
  'responseHeaders',
]);
// Exact names plus any `*_token` / `*-secret` / `*_password` / `*-signature` suffix (`api_token`; login pages
// that mirror the typed address into `?email=` links; presigned object-storage URLs carry `X-Amz-Signature`). Deliberately broad: `code` also hides invite
// and promo codes, and the suffix hides opaque pagination cursors such as `page_token`; losing
// those in a replay is cheaper than storing an OAuth code or a session-bound token.
const SENSITIVE_QUERY =
  /^(access[-_]?token|api[-_]?key|api[-_]?token|auth|authorization|client[-_]?secret|code|e[-_]?mail|id[-_]?token|jwt|password|refresh[-_]?token|secret|session|signature|token)$|[-_](token|secret|password|signature)$/i;

interface HarHeader {
  name: string;
  value: string;
}
interface HarEntry {
  startedDateTime?: string;
  time?: number;
  request?: { method?: string; url?: string; headers?: HarHeader[]; cookies?: unknown[]; postData?: Record<string, unknown> };
  response?: {
    status?: number;
    statusText?: string;
    headers?: HarHeader[];
    cookies?: unknown[];
    content?: { mimeType?: string; text?: string; encoding?: string };
  };
}

interface Har {
  log?: { entries?: HarEntry[] };
}

function redactSensitiveParameters(value: string) {
  const parameters = new URLSearchParams(value);
  let changed = false;
  for (const name of new Set(parameters.keys())) {
    if (!SENSITIVE_QUERY.test(name)) continue;
    parameters.set(name, '[redacted]');
    changed = true;
  }
  return changed ? parameters.toString() : value;
}

function sanitizeHash(hash: string) {
  if (!hash) return hash;
  const fragment = hash.slice(1);
  const queryStart = fragment.indexOf('?');
  const prefix = queryStart >= 0 ? fragment.slice(0, queryStart + 1) : '';
  const parameters = queryStart >= 0 ? fragment.slice(queryStart + 1) : fragment;
  if (!parameters.includes('=')) return hash;
  return `#${prefix}${redactSensitiveParameters(parameters)}`;
}

export function sanitizeHeaders(headers: HarHeader[] = []) {
  return headers
    .filter((header) => !SENSITIVE_HEADER.test(header.name))
    .map((header) => (URL_HEADER.test(header.name) ? { ...header, value: sanitizeUrl(header.value) } : header));
}

export function sanitizeUrl(value: string) {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
    const protocolRelative = value.startsWith('//');
    const relative = value.startsWith('/') || value.startsWith('?');
    if (!absolute && !protocolRelative && !relative) return value;
    const url = new URL(value, 'https://redaction.invalid');
    url.search = redactSensitiveParameters(url.search.slice(1));
    url.hash = sanitizeHash(url.hash);
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
 * Redacts absolute URLs embedded in free text. Only URLs that carry credentials or a sensitive
 * parameter are rewritten, so other text stays byte-for-byte (and a second pass changes nothing).
 */
export function sanitizeEmbeddedUrls(text: string) {
  if (!text.includes('://')) return text;
  return text.replace(EMBEDDED_URL, (match) => {
    const clean = sanitizeUrl(match);
    return clean.includes('%5Bredacted%5D') || /^[a-z]+:\/\/[^/?#]*@/i.test(match) ? clean : match;
  });
}

export function sanitizeUrlFields<T>(value: T): T {
  if (typeof value === 'string') return sanitizeEmbeddedUrls(value) as T;
  if (Array.isArray(value)) return value.map((entry) => sanitizeUrlFields(entry)) as T;
  if (!value || typeof value !== 'object') return value;
  const sanitized = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      if (typeof nested === 'string' && URL_FIELD.test(key)) return [key, sanitizeUrl(nested)];
      return [key, sanitizeUrlFields(nested)];
    }),
  );
  return sanitized as T;
}

const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const MUTATION = 0;
const INPUT = 5;
const ELEMENT = 2;
const TEXT = 3;
/**
 * rrweb `maskInputOptions` for the capture recorder: the `maskAllInputs` set (password is always
 * in it) plus hidden inputs, which often carry CSRF tokens and are never visible in a replay.
 * The import/upload pass below masks the same set.
 */
export const MASK_INPUT_OPTIONS: Record<string, true> = {
  color: true,
  date: true,
  'datetime-local': true,
  email: true,
  hidden: true,
  month: true,
  number: true,
  password: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
  textarea: true,
  select: true,
};
const MASKED_INPUT_TYPES = new Set(Object.keys(MASK_INPUT_OPTIONS));

function maskedInput(value: string) {
  return '*'.repeat(value.length);
}

interface SerializedNode {
  type?: number;
  tagName?: string;
  id?: number;
  textContent?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SerializedNode[];
}

function inputType(attributes: Record<string, unknown> | undefined) {
  return typeof attributes?.type === 'string' && attributes.type ? attributes.type.toLowerCase() : 'text';
}

function masksInput(tag: string, attributes: Record<string, unknown> | undefined) {
  if (tag === 'textarea' || tag === 'select') return true;
  return tag === 'input' && MASKED_INPUT_TYPES.has(inputType(attributes));
}

function maskElementTree(node: SerializedNode | undefined, inputIds: Set<number>, textIds: Set<number>) {
  if (!node || typeof node !== 'object') return;
  const children = Array.isArray(node.childNodes) ? node.childNodes : [];
  if (node.type === ELEMENT) {
    const tag = String(node.tagName ?? '').toLowerCase();
    const mask = masksInput(tag, node.attributes);
    if (mask && typeof node.id === 'number') inputIds.add(node.id);
    if (mask && node.attributes && typeof node.attributes.value === 'string') {
      node.attributes.value = maskedInput(node.attributes.value);
    }
    for (const child of children) {
      if (mask && child?.type === TEXT && typeof child.id === 'number') {
        textIds.add(child.id);
        if (typeof child.textContent === 'string') child.textContent = maskedInput(child.textContent);
      }
      maskElementTree(child, inputIds, textIds);
    }
    return;
  }
  for (const child of children) maskElementTree(child, inputIds, textIds);
}

/**
 * Replaces input, textarea and select values the way rrweb's `maskAllInputs` does,
 * so an imported recording cannot store typed secrets the capture path would have masked.
 * Button labels and other non-input text stay as recorded.
 */
export function maskCapturedInputs<T>(events: T): T {
  if (!Array.isArray(events)) return events;
  const inputIds = new Set<number>();
  const textIds = new Set<number>();
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const record = event as { type?: unknown; data?: Record<string, unknown> };
    const data = record.data;
    if (!data || typeof data !== 'object') continue;
    if (record.type === FULL_SNAPSHOT) {
      maskElementTree(data.node as SerializedNode, inputIds, textIds);
      continue;
    }
    if (record.type !== INCREMENTAL) continue;
    if (data.source === INPUT && typeof data.text === 'string') {
      data.text = maskedInput(data.text);
      continue;
    }
    if (data.source !== MUTATION) continue;
    for (const add of (data.adds as Array<{ node?: SerializedNode }> | undefined) ?? []) maskElementTree(add?.node, inputIds, textIds);
    for (const removal of (data.removes as Array<{ id?: number }> | undefined) ?? []) {
      if (typeof removal?.id !== 'number') continue;
      inputIds.delete(removal.id);
      textIds.delete(removal.id);
    }
    for (const change of (data.attributes as Array<{ id?: number; attributes?: Record<string, unknown> }> | undefined) ?? []) {
      if (typeof change?.id === 'number' && inputIds.has(change.id) && typeof change.attributes?.value === 'string') {
        change.attributes.value = maskedInput(change.attributes.value);
      }
    }
    for (const change of (data.texts as Array<{ id?: number; value?: unknown }> | undefined) ?? []) {
      if (typeof change?.id === 'number' && textIds.has(change.id) && typeof change.value === 'string') {
        change.value = maskedInput(change.value);
      }
    }
  }
  return events;
}

/**
 * Server-side privacy pass for any bundle a client uploads: every URL field (meta, events,
 * steps, network, context) goes through `sanitizeUrl`, URLs inside other strings (console
 * messages, labels, CSS, srcset) are redacted, input/textarea/select values are masked,
 * network entries keep only the viewer's fields, and sensitive network headers are dropped.
 * Idempotent: a second pass changes nothing, so a bundle from the capture or import CLI is
 * stored unchanged and a suite re-upload of the same bundle still compares equal.
 */
export function sanitizeReplayBundle(bundle: ReplayBundle): ReplayBundle {
  const sanitized = sanitizeUrlFields(bundle);
  sanitized.events = maskCapturedInputs(sanitized.events);
  // Only the viewer's fields survive: raw HAR leftovers (request.postData, cookies, content) are dropped.
  sanitized.network = sanitized.network.map((entry) => ({
    ...(Object.fromEntries(Object.entries(entry).filter(([key]) => NETWORK_FIELDS.has(key))) as typeof entry),
    ...(Array.isArray(entry.requestHeaders) ? { requestHeaders: sanitizeHeaders(entry.requestHeaders) } : {}),
    ...(Array.isArray(entry.responseHeaders) ? { responseHeaders: sanitizeHeaders(entry.responseHeaders) } : {}),
  }));
  return sanitized;
}

export function sanitizeHar(input: unknown): Har {
  const har = structuredClone(input) as Har;
  for (const entry of har.log?.entries ?? []) {
    if (entry.request) {
      entry.request.url = sanitizeUrl(entry.request.url ?? '');
      entry.request.headers = sanitizeHeaders(entry.request.headers);
      entry.request.cookies = [];
      if (entry.request.postData) {
        delete entry.request.postData.text;
        if (Array.isArray(entry.request.postData.params)) {
          entry.request.postData.params = entry.request.postData.params.map((parameter: unknown) => {
            if (!parameter || typeof parameter !== 'object') return parameter;
            const copy = { ...parameter } as { name?: string; value?: string };
            if (copy.name && SENSITIVE_QUERY.test(copy.name)) copy.value = '[redacted]';
            return copy;
          });
        }
      }
    }
    if (entry.response) {
      entry.response.headers = sanitizeHeaders(entry.response.headers);
      entry.response.cookies = [];
      if (entry.response.content) {
        delete entry.response.content.text;
        delete entry.response.content.encoding;
      }
    }
  }
  return har;
}

export function networkEntries(input: unknown, startedAt: number): ReplayNetworkEntry[] {
  const har = sanitizeHar(input);
  return (har.log?.entries ?? []).map((entry, index) => ({
    id: `request-${index + 1}`,
    at: Math.max(0, Date.parse(entry.startedDateTime ?? '') - startedAt) || 0,
    duration: Number(entry.time ?? 0),
    method: entry.request?.method ?? 'GET',
    url: entry.request?.url ?? '',
    status: Number(entry.response?.status ?? 0),
    statusText: entry.response?.statusText ?? '',
    ...(entry.response?.content?.mimeType ? { mimeType: entry.response.content.mimeType } : {}),
    requestHeaders: entry.request?.headers ?? [],
    responseHeaders: entry.response?.headers ?? [],
  }));
}
