import { type CompiledRedaction, compileRedaction, type RedactionRules, redactJsonKeys, redactText } from '../shared/redaction.ts';
import type { NetworkBodyLimits } from '../shared/capture-profile.ts';
import { sanitizeBody } from '../shared/network-bodies.ts';
import type { ReplayBundle, ReplayNetworkEntry } from '../shared/replay.ts';
import { isRecord } from '../shared/validate.ts';
import { harEntryBodies } from './har-bodies.ts';
import { maskCapturedInputs } from './mask-inputs.ts';
import { compileMaskSelectors, compoundMatches } from './mask-selectors.ts';

/* why: exact auth headers plus any `*-token` / `*-secret` / `*-jwt` / `*-assertion` (X-CSRF-Token, X-Amz-Security-Token,
   signed-identity headers set by proxies, ...). */
const SENSITIVE_HEADER =
  /^(authorization|cookie|proxy-authorization|set-cookie|x-api-key|x-auth-token|x-forwarded-access-token|x-amz-security-token)$|[-_](token|secret|jwt|assertion)$/i;
const URL_HEADER = /^(content-location|location|origin|referer|referrer)$/i;
const URL_FIELD = /^(action|currentSrc|formAction|href|poster|src|url|xlink:href)$/i;
/** Absolute URLs inside free text: srcset, ping, style/CSS url(), meta content, console messages, labels. */
const EMBEDDED_URL = /\b(?:https?|wss?):\/\/[^\s"'`()<>\\]+/gi;
/** CSS `url(...)` in styles and stylesheet text, relative or absolute. */
const CSS_URL = /url\(\s*(['"]?)([^'"()\s]+)\1\s*\)/gi;
const SRCSET_FIELD = /^(imagesrcset|srcset)$/i;
const BODY_FIELDS = new Set(['requestBody', 'responseBody']);
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
  'requestBody',
  'responseBody',
]);
/* why: exact names plus any `*_token` / `*-secret` / `*_password` / `*-signature` suffix (`api_token`; login pages that
   mirror the typed address into `?email=` links; presigned object-storage URLs carry `X-Amz-Signature`). Deliberately
   broad: `code` also hides invite and promo codes, and the suffix hides opaque pagination cursors such as `page_token`;
   losing those in a replay is cheaper than storing an OAuth code or a session-bound token. */
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

/* invariant: the host's redaction rules (src/shared/redaction.ts) only ever add to the built-in patterns. The exported
   functions take `RedactionRules` and compile them (cached per rules object); the helpers take them compiled. */

function redactSensitiveParameters(value: string, rules: CompiledRedaction) {
  const parameters = new URLSearchParams(value);
  let changed = false;
  for (const name of new Set(parameters.keys())) {
    if (!SENSITIVE_QUERY.test(name) && !rules.queryParam(name)) continue;
    parameters.set(name, '[redacted]');
    changed = true;
  }
  return changed ? parameters.toString() : value;
}

function sanitizeHash(hash: string, rules: CompiledRedaction) {
  if (!hash) return hash;
  const fragment = hash.slice(1);
  const queryStart = fragment.indexOf('?');
  const prefix = queryStart >= 0 ? fragment.slice(0, queryStart + 1) : '';
  const parameters = queryStart >= 0 ? fragment.slice(queryStart + 1) : fragment;
  if (!parameters.includes('=')) return hash;
  return `#${prefix}${redactSensitiveParameters(parameters, rules)}`;
}

export function sanitizeHeaders(headers: HarHeader[] = [], redaction?: RedactionRules) {
  return headersWith(headers, compileRedaction(redaction));
}

function headersWith(headers: HarHeader[], rules: CompiledRedaction) {
  return headers
    .filter((header) => !SENSITIVE_HEADER.test(header.name) && !rules.header(header.name))
    .map((header) => (URL_HEADER.test(header.name) ? { ...header, value: urlWith(header.value, rules) } : header));
}

export function sanitizeUrl(value: string, redaction?: RedactionRules) {
  return urlWith(value, compileRedaction(redaction));
}

function urlWith(value: string, rules: CompiledRedaction) {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
    const protocolRelative = value.startsWith('//');
    const relative = value.startsWith('/') || value.startsWith('?');
    if (!absolute && !protocolRelative && !relative) return value;
    const url = new URL(value, 'https://redaction.invalid');
    url.search = redactSensitiveParameters(url.search.slice(1), rules);
    url.hash = sanitizeHash(url.hash, rules);
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
 * Redacts absolute URLs embedded in free text, and CSS url() values (relative ones too). Only URLs that carry
 * credentials or a sensitive parameter are rewritten, so other text stays byte-for-byte (and a second pass
 * changes nothing).
 */
export function sanitizeEmbeddedUrls(text: string, redaction?: RedactionRules) {
  return embeddedUrlsWith(text, compileRedaction(redaction));
}

function embeddedUrlsWith(text: string, rules: CompiledRedaction) {
  const styled = text.includes('url(')
    ? text.replace(CSS_URL, (match, quote: string, url: string) => {
        const clean = redactKnownUrl(url, rules);
        return clean === url ? match : `url(${quote}${clean}${quote})`;
      })
    : text;
  if (!styled.includes('://')) return styled;
  return styled.replace(EMBEDDED_URL, (match) => redactKnownUrl(match, rules));
}

/**
 * A value known to be a URL (a srcset candidate, a CSS url()), relative ones included: rewritten only when it
 * carries credentials or a sensitive parameter. Relative paths keep their exact form (`../`, no leading slash).
 */
function redactKnownUrl(url: string, rules: CompiledRedaction) {
  if (/^([a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
    const clean = urlWith(url, rules);
    return clean.includes('%5Bredacted%5D') || /^([a-z][a-z\d+.-]*:)?\/\/[^/?#]*@/i.test(url) ? clean : url;
  }
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt >= 0 ? `?${redactSensitiveParameters(beforeHash.slice(queryAt + 1), rules)}` : '';
  const clean = `${queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash}${query}${hashAt >= 0 ? sanitizeHash(url.slice(hashAt), rules) : ''}`;
  return clean.includes('%5Bredacted%5D') ? clean : url;
}

/** srcset / imagesrcset: each candidate's URL (up to whitespace, trailing commas aside), relative ones included. */
function sanitizeSrcset(value: string, rules: CompiledRedaction) {
  return value.replace(/(^|,)(\s*)(\S+)/g, (match, comma: string, space: string, candidate: string) => {
    const url = candidate.replace(/,+$/, '');
    const clean = redactKnownUrl(url, rules);
    return clean === url ? match : `${comma}${space}${clean}${candidate.slice(url.length)}`;
  });
}

export function sanitizeUrlFields<T>(value: T, redaction?: RedactionRules): T {
  return urlFieldsWith(value, compileRedaction(redaction));
}

function urlFieldsWith<T>(value: T, rules: CompiledRedaction): T {
  if (typeof value === 'string') return embeddedUrlsWith(value, rules) as T;
  if (Array.isArray(value)) return value.map((entry) => urlFieldsWith(entry, rules)) as T;
  if (!value || typeof value !== 'object') return value;
  const sanitized = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      if (typeof nested === 'string' && URL_FIELD.test(key)) return [key, urlWith(nested, rules)];
      if (typeof nested === 'string' && SRCSET_FIELD.test(key)) return [key, embeddedUrlsWith(sanitizeSrcset(nested, rules), rules)];
      return [key, urlFieldsWith(nested, rules)];
    }),
  );
  return sanitized as T;
}

/** Text rules over every string in a value (DOM text, attribute values, CSS); `tagName` and object keys stay as they are. */
function textWith<T>(value: T, rules: CompiledRedaction): T {
  if (typeof value === 'string') return redactText(value, rules) as T;
  if (Array.isArray(value)) return value.map((entry) => textWith(entry, rules)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, key === 'tagName' ? nested : textWith(nested, rules)])) as T;
}

/** A console message with the host's rules applied: JSON keys first (the message is often a logged object), then text. */
export function redactConsoleMessage(message: string, redaction?: RedactionRules) {
  const rules = compileRedaction(redaction);
  return rules.empty ? message : consoleWith(message, rules);
}

/** Settle interactions between privacy stages too, not just the text rules within one stage. */
function settleRedaction<T>(input: T, apply: (value: T) => T, serialize: (value: T) => string): T {
  let value = input;
  let previous = serialize(value);
  const maxLength = Math.max(4096, previous.length * 4);
  for (let pass = 0; pass < 32; pass++) {
    const next = apply(value);
    const serialized = serialize(next);
    if (serialized.length > maxLength) throw new Error('redaction stages exceed the output limit');
    if (serialized === previous) return next;
    value = next;
    previous = serialized;
  }
  throw new Error('redaction stages did not settle within 32 passes');
}

function consoleWith(message: string, rules: CompiledRedaction) {
  const apply = (value: string) => redactText(redactJsonKeys(value, rules), rules);
  return rules.text.length ? settleRedaction(message, apply, (value) => value) : apply(message);
}

const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const MUTATION = 0;
const ELEMENT = 2;
const TEXT = 3;
interface SerializedNode {
  type?: number;
  tagName?: string;
  id?: number;
  textContent?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SerializedNode[];
}

/** rrweb's default `maskTextFn`: every non-space character becomes `*`. */
const maskedText = (value: string) => value.replace(/\S/g, '*');

/**
 * Masks selector matches through snapshots, moves, attribute mutations, added nodes and later text changes, on a recording
 * that is already serialized (an upload from an old producer, an import). The capture recorder gets the same selectors as
 * rrweb `maskTextSelector`, which sees the live DOM (src/capture/mask-selectors.ts).
 */
function maskSelectorText<T>(events: T, selectors: readonly string[]): T {
  const compounds = compileMaskSelectors(selectors);
  if (!Array.isArray(events) || !compounds.length) return events;
  const masked = new Set<number>();
  const nodes = new Map<number, { node: SerializedNode; attributes: Record<string, unknown> }>();
  const parents = new Map<number, number>();
  // why: edges are kept even if an add lists the child before its parent.
  const children = new Map<number, Set<number>>();
  const detach = (id: number) => {
    const parent = parents.get(id);
    if (parent !== undefined) children.get(parent)?.delete(id);
    parents.delete(id);
  };
  const protect = (id: number) => {
    const pending = [id];
    const seen = new Set<number>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      masked.add(current);
      const node = nodes.get(current)?.node;
      // why: the earlier serialized text is scrubbed too when its element becomes private, conservatively.
      if (node?.type === TEXT && typeof node.textContent === 'string') node.textContent = maskedText(node.textContent);
      for (const child of children.get(current) ?? []) pending.push(child);
    }
  };
  const matches = (node: SerializedNode) => node.type === ELEMENT && compounds.some((compound) => compoundMatches(node, compound));
  const remember = (node: SerializedNode | undefined, parent: number | undefined, inside = false) => {
    if (!node || typeof node !== 'object') return;
    const id = typeof node.id === 'number' ? node.id : undefined;
    if (id !== undefined) {
      detach(id);
      nodes.set(id, { node, attributes: { ...node.attributes } });
      if (parent !== undefined) {
        parents.set(id, parent);
        let siblings = children.get(parent);
        if (!siblings) children.set(parent, (siblings = new Set()));
        siblings.add(id);
      }
    }
    const hit = inside || (parent !== undefined && masked.has(parent)) || (id !== undefined && masked.has(id)) || matches(node);
    if (hit && id !== undefined) protect(id);
    if (hit && node.type === TEXT && typeof node.textContent === 'string') node.textContent = maskedText(node.textContent);
    for (const child of Array.isArray(node.childNodes) ? node.childNodes : []) remember(child, id ?? parent, hit);
  };
  for (const event of events) {
    const record = event as { type?: unknown; data?: Record<string, unknown> } | null;
    const data = record?.data;
    if (!data || typeof data !== 'object') continue;
    if (record.type === FULL_SNAPSHOT) {
      masked.clear();
      nodes.clear();
      parents.clear();
      children.clear();
      remember(data.node as SerializedNode, undefined);
      continue;
    }
    if (record.type !== INCREMENTAL || data.source !== MUTATION) continue;
    // invariant: removed subtrees are detached but keep their state and masking for a later move or re-add.
    for (const removal of (data.removes as Array<{ id?: number }> | undefined) ?? [])
      if (typeof removal?.id === 'number') detach(removal.id);
    for (const add of (data.adds as Array<{ parentId?: number; node?: SerializedNode }> | undefined) ?? [])
      remember(add?.node, typeof add?.parentId === 'number' ? add.parentId : undefined);
    for (const change of (data.attributes as Array<{ id?: number; attributes?: Record<string, unknown> }> | undefined) ?? []) {
      if (typeof change?.id !== 'number') continue;
      const known = nodes.get(change.id);
      if (!known) continue;
      // invariant: the current mirror changes, never the historical snapshot's attributes.
      known.attributes = { ...known.attributes, ...change.attributes };
      if (masked.has(change.id) || matches({ ...known.node, attributes: known.attributes })) protect(change.id);
    }
    for (const change of (data.texts as Array<{ id?: number; value?: unknown }> | undefined) ?? [])
      if (typeof change?.id === 'number' && masked.has(change.id) && typeof change.value === 'string')
        change.value = maskedText(change.value);
  }
  return events;
}

/** Text patterns and mask selectors over rrweb events (the recorder session applies them chunk by chunk). */
export function redactEvents<T>(events: T, redaction?: RedactionRules): T {
  const rules = compileRedaction(redaction);
  if (rules.empty) return events;
  const apply = (value: T) => maskSelectorText(textWith(value, rules), rules.maskSelectors);
  return rules.text.length && rules.maskSelectors.length
    ? settleRedaction(events, apply, (value) => JSON.stringify(value) ?? '')
    : apply(events);
}

/**
 * The host's rules over a bundle's free text (src/shared/redaction.ts): text patterns over DOM text and attributes, step
 * labels, the title, network URLs and header values; JSON keys and text patterns over console messages; mask selectors
 * over the DOM text. Query parameters and headers are handled by the URL and header passes.
 */
function textRulesWith(bundle: ReplayBundle, rules: CompiledRedaction): ReplayBundle {
  if (rules.empty) return bundle;
  const text = (value: string) => redactText(value, rules);
  const headers = (list: HarHeader[]) =>
    Array.isArray(list)
      ? list.map((header) => (typeof header?.value === 'string' ? { ...header, value: text(header.value) } : header))
      : list;
  return {
    ...bundle,
    meta: { ...bundle.meta, title: text(bundle.meta.title) },
    events: maskSelectorText(textWith(bundle.events, rules), rules.maskSelectors),
    console: bundle.console.map((entry) => ({ ...entry, message: consoleWith(entry.message, rules) })),
    steps: bundle.steps.map((step) => ({ ...step, label: text(step.label) })),
    network: bundle.network.map((entry) => ({
      ...entry,
      url: text(entry.url),
      requestHeaders: headers(entry.requestHeaders),
      responseHeaders: headers(entry.responseHeaders),
    })),
  };
}

/**
 * Server-side privacy pass for any bundle a client uploads: every URL field (meta, events,
 * steps, network, context) goes through `sanitizeUrl`, URLs inside other strings (console
 * messages, labels, CSS, srcset) are redacted, input/textarea/select values are masked,
 * network entries keep only the viewer's fields, and sensitive network headers are dropped.
 * `redaction` (the host's rules) adds to all of that; it cannot turn any of it off.
 * Idempotent: a second pass changes nothing, so a bundle from the capture or import CLI is
 * stored unchanged and a suite re-upload of the same bundle still compares equal.
 */
export function sanitizeReplayBundle(bundle: ReplayBundle, redaction?: RedactionRules): ReplayBundle {
  const rules = compileRedaction(redaction);
  /* invariant: the default pass runs again after the text rules, so nothing a rule writes can bring back what it removes;
     the result is always a bundle the default pass leaves unchanged. */
  const apply = (value: ReplayBundle) => {
    const clean = defaultPass(value, rules);
    return rules.empty ? clean : defaultPass(textRulesWith(clean, rules), rules);
  };
  return rules.text.length ? settleRedaction(bundle, apply, JSON.stringify) : apply(bundle);
}

function defaultPass(bundle: ReplayBundle, rules: CompiledRedaction): ReplayBundle {
  const sanitized = urlFieldsWith(bundle, rules);
  sanitized.events = maskCapturedInputs(sanitized.events);
  // invariant: only the viewer's fields survive; raw HAR leftovers (request.postData, cookies, content) are dropped.
  sanitized.network = sanitized.network.map((entry) => ({
    ...(Object.fromEntries(Object.entries(entry).filter(([key]) => NETWORK_FIELDS.has(key) && !BODY_FIELDS.has(key))) as typeof entry),
    ...(Array.isArray(entry.requestHeaders) ? { requestHeaders: headersWith(entry.requestHeaders, rules) } : {}),
    ...(Array.isArray(entry.responseHeaders) ? { responseHeaders: headersWith(entry.responseHeaders, rules) } : {}),
    ...bodiesWith(entry, rules),
  }));
  return sanitized;
}

export function sanitizeHar(input: unknown, redaction?: RedactionRules): Har {
  const rules = compileRedaction(redaction);
  const har = structuredClone(input) as Har;
  for (const entry of har.log?.entries ?? []) {
    if (entry.request) {
      entry.request.url = urlWith(entry.request.url ?? '', rules);
      entry.request.headers = headersWith(entry.request.headers ?? [], rules);
      entry.request.cookies = [];
      if (entry.request.postData) {
        delete entry.request.postData.text;
        if (Array.isArray(entry.request.postData.params)) {
          entry.request.postData.params = entry.request.postData.params.map((parameter: unknown) => {
            if (!parameter || typeof parameter !== 'object') return parameter;
            const copy = { ...parameter } as { name?: string; value?: string };
            if (copy.name && (SENSITIVE_QUERY.test(copy.name) || rules.queryParam(copy.name) || rules.jsonKey(copy.name)))
              copy.value = '[redacted]';
            return copy;
          });
        }
      }
    }
    if (entry.response) {
      entry.response.headers = headersWith(entry.response.headers ?? [], rules);
      entry.response.cookies = [];
      if (entry.response.content) {
        delete entry.response.content.text;
        delete entry.response.content.encoding;
      }
    }
  }
  return har;
}

/**
 * An uploaded entry's bodies run through the body redaction again (src/shared/network-bodies.ts): only known fields,
 * secrets replaced, oversized text cut. A body that is not a record is dropped.
 */
function bodiesWith(entry: ReplayNetworkEntry, rules: CompiledRedaction): Pick<ReplayNetworkEntry, 'requestBody' | 'responseBody'> {
  const requestType = entry.requestHeaders?.find?.((header) => header?.name?.toLowerCase() === 'content-type')?.value;
  const clean = (body: unknown, mimeType: string | undefined) => {
    const kept = body === undefined ? undefined : sanitizeBody(body, mimeType, { rules });
    return kept?.text === undefined ? kept : { ...kept, text: embeddedUrlsWith(kept.text, rules) };
  };
  const requestBody = clean(entry.requestBody, requestType);
  const responseBody = clean(entry.responseBody, entry.mimeType);
  return { ...(requestBody ? { requestBody } : {}), ...(responseBody ? { responseBody } : {}) };
}

/**
 * The HAR as replay network entries. `bodies` (a capture with `network: 'bodies'`) keeps request and response bodies
 * under its limits, redacted; without it no body is read.
 */
export function networkEntries(
  input: unknown,
  startedAt: number,
  redaction?: RedactionRules,
  bodies?: NetworkBodyLimits,
): ReplayNetworkEntry[] {
  const rules = compileRedaction(redaction);
  const raw = bodies && isRecord(input) && isRecord(input.log) && Array.isArray(input.log.entries) ? input.log.entries : [];
  const har = sanitizeHar(input, redaction);
  return (har.log?.entries ?? []).map((entry, index) => ({
    ...(bodies ? harEntryBodies(raw[index], bodies, rules) : {}),
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
