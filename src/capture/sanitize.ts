import { type CompiledRedaction, compileRedaction, type RedactionRules, redactJsonKeys, redactText } from '../shared/redaction.ts';
import type { ReplayBundle, ReplayNetworkEntry } from '../shared/replay.ts';

// Exact auth headers plus any `*-token` / `*-secret` / `*-jwt` / `*-assertion` (X-CSRF-Token, X-Amz-Security-Token,
// signed-identity headers set by proxies, ...).
const SENSITIVE_HEADER =
  /^(authorization|cookie|proxy-authorization|set-cookie|x-api-key|x-auth-token|x-forwarded-access-token|x-amz-security-token)$|[-_](token|secret|jwt|assertion)$/i;
const URL_HEADER = /^(content-location|location|origin|referer|referrer)$/i;
const URL_FIELD = /^(action|currentSrc|formAction|href|poster|src|url|xlink:href)$/i;
/** Absolute URLs inside free text: srcset, ping, style/CSS url(), meta content, console messages, labels. */
const EMBEDDED_URL = /\b(?:https?|wss?):\/\/[^\s"'`()<>\\]+/gi;
/** CSS `url(...)` in styles and stylesheet text, relative or absolute. */
const CSS_URL = /url\(\s*(['"]?)([^'"()\s]+)\1\s*\)/gi;
const SRCSET_FIELD = /^(imagesrcset|srcset)$/i;
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

// The helpers below take the host's redaction rules (src/shared/redaction.ts), compiled; rules only ever add to the
// built-in patterns. The exported functions take `RedactionRules` and compile them (cached per rules object).

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
  return rules.empty ? message : redactText(redactJsonKeys(message, rules), rules);
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

// Mask selectors on a recording that is already serialised (an upload from an old producer, an import). The capture
// recorder gets them as rrweb `maskTextSelector`, which sees the live DOM; here only each selector's last compound part
// is checked (`.card [data-private]` checks `[data-private]`) and pseudo-classes are ignored, so this masks the same
// text or more, never less.

interface CompoundSelector {
  tag?: string;
  ids: string[];
  classes: string[];
  attributes: Array<{ name: string; operator?: string; value?: string; insensitive: boolean }>;
}

/** Splits on `separator` outside brackets, parentheses and quotes. */
function splitTopLevel(text: string, separator: RegExp) {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === '\\') current += char + (text[++index] ?? '');
      else {
        if (char === quote) quote = '';
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '(') depth++;
    else if (char === ']' || char === ')') depth--;
    else if (depth === 0 && separator.test(char)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const SELECTOR_TOKEN =
  /\[\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s\]]+))\s*(i)?\s*)?\]|#([\w-]+)|\.([\w-]+)|::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?|^([a-zA-Z][\w-]*|\*)/g;

function parseCompound(selector: string): CompoundSelector | undefined {
  const last = splitTopLevel(selector, /[\s>+~]/).at(-1);
  if (!last) return undefined;
  const compound: CompoundSelector = { ids: [], classes: [], attributes: [] };
  for (const match of last.matchAll(SELECTOR_TOKEN)) {
    if (match[1]) {
      const value = match[3] ?? match[4] ?? match[5];
      compound.attributes.push({
        name: match[1].toLowerCase(),
        ...(match[2] ? { operator: match[2] } : {}),
        ...(value !== undefined ? { value } : {}),
        insensitive: Boolean(match[6]),
      });
    } else if (match[7]) compound.ids.push(match[7]);
    else if (match[8]) compound.classes.push(match[8]);
    else if (match[9] && match[9] !== '*') compound.tag = match[9].toLowerCase();
  }
  return compound;
}

function attributeMatches(actual: string, operator: string | undefined, expected: string | undefined, insensitive: boolean) {
  if (!operator || expected === undefined) return true;
  const [a, e] = insensitive ? [actual.toLowerCase(), expected.toLowerCase()] : [actual, expected];
  switch (operator) {
    case '=':
      return a === e;
    case '~=':
      return a.split(/\s+/).includes(e);
    case '|=':
      return a === e || a.startsWith(`${e}-`);
    case '^=':
      return Boolean(e) && a.startsWith(e);
    case '$=':
      return Boolean(e) && a.endsWith(e);
    default:
      return Boolean(e) && a.includes(e);
  }
}

function compoundMatches(node: SerializedNode, compound: CompoundSelector) {
  const attributes = node.attributes ?? {};
  const text = (name: string) => (typeof attributes[name] === 'string' ? (attributes[name] as string) : undefined);
  if (compound.tag && String(node.tagName ?? '').toLowerCase() !== compound.tag) return false;
  if (compound.ids.some((id) => text('id') !== id)) return false;
  const classes = (text('class') ?? '').split(/\s+/);
  if (compound.classes.some((name) => !classes.includes(name))) return false;
  return compound.attributes.every((rule) => {
    const value = attributes[rule.name];
    if (value === undefined || value === null || value === false) return false;
    return attributeMatches(String(value), rule.operator, rule.value, rule.insensitive);
  });
}

/** rrweb's default `maskTextFn`: every non-space character becomes `*`. */
const maskedText = (value: string) => value.replace(/\S/g, '*');

function maskSelectorTree(node: SerializedNode | undefined, compounds: CompoundSelector[], inside: boolean, masked: Set<number>) {
  if (!node || typeof node !== 'object') return;
  const hit = inside || (node.type === ELEMENT && compounds.some((compound) => compoundMatches(node, compound)));
  if (hit && typeof node.id === 'number') masked.add(node.id);
  if (hit && node.type === TEXT && typeof node.textContent === 'string') node.textContent = maskedText(node.textContent);
  for (const child of Array.isArray(node.childNodes) ? node.childNodes : []) maskSelectorTree(child, compounds, hit, masked);
}

/** Masks the text inside elements that match the selectors: in snapshots, in added nodes and in later text changes. */
function maskSelectorText<T>(events: T, selectors: readonly string[]): T {
  const compounds = selectors.flatMap((list) => splitTopLevel(list, /,/)).flatMap((selector) => parseCompound(selector) ?? []);
  if (!Array.isArray(events) || !compounds.length) return events;
  const masked = new Set<number>();
  for (const event of events) {
    const record = event as { type?: unknown; data?: Record<string, unknown> } | null;
    const data = record?.data;
    if (!data || typeof data !== 'object') continue;
    if (record.type === FULL_SNAPSHOT) {
      masked.clear();
      maskSelectorTree(data.node as SerializedNode, compounds, false, masked);
      continue;
    }
    if (record.type !== INCREMENTAL || data.source !== MUTATION) continue;
    for (const add of (data.adds as Array<{ parentId?: number; node?: SerializedNode }> | undefined) ?? [])
      maskSelectorTree(add?.node, compounds, typeof add?.parentId === 'number' && masked.has(add.parentId), masked);
    for (const change of (data.texts as Array<{ id?: number; value?: unknown }> | undefined) ?? [])
      if (typeof change?.id === 'number' && masked.has(change.id) && typeof change.value === 'string')
        change.value = maskedText(change.value);
  }
  return events;
}

/** Text patterns and mask selectors over rrweb events (the recorder session applies them chunk by chunk). */
export function redactEvents<T>(events: T, redaction?: RedactionRules): T {
  const rules = compileRedaction(redaction);
  return rules.empty ? events : maskSelectorText(textWith(events, rules), rules.maskSelectors);
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
    console: bundle.console.map((entry) => ({ ...entry, message: text(redactJsonKeys(entry.message, rules)) })),
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
  const clean = defaultPass(bundle, rules);
  // The default pass runs again after the text rules, so nothing a rule writes can bring back what it removes: the
  // result is always a bundle the default pass leaves unchanged.
  return rules.empty ? clean : defaultPass(textRulesWith(clean, rules), rules);
}

function defaultPass(bundle: ReplayBundle, rules: CompiledRedaction): ReplayBundle {
  const sanitized = urlFieldsWith(bundle, rules);
  sanitized.events = maskCapturedInputs(sanitized.events);
  // Only the viewer's fields survive: raw HAR leftovers (request.postData, cookies, content) are dropped.
  sanitized.network = sanitized.network.map((entry) => ({
    ...(Object.fromEntries(Object.entries(entry).filter(([key]) => NETWORK_FIELDS.has(key))) as typeof entry),
    ...(Array.isArray(entry.requestHeaders) ? { requestHeaders: headersWith(entry.requestHeaders, rules) } : {}),
    ...(Array.isArray(entry.responseHeaders) ? { responseHeaders: headersWith(entry.responseHeaders, rules) } : {}),
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

export function networkEntries(input: unknown, startedAt: number, redaction?: RedactionRules): ReplayNetworkEntry[] {
  const har = sanitizeHar(input, redaction);
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
