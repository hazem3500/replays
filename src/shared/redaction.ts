/**
 * Redaction rules: what a host adds to the sanitiser's defaults (src/capture/sanitize.ts). They come from the config file's
 * `redaction` key and from `api.redaction(rules)` in plugins, and apply in the capture CLI and again in the server's privacy
 * pass. Rules only ever add: nothing here can turn a default off.
 *
 * Rules are trusted config. Their regular expressions run over every captured string, so they are only ever taken from the
 * host's config and plugins, never from an upload, a request or a user plugin; patterns are capped at
 * `MAX_REDACTION_PATTERN_LENGTH` characters and each list at `MAX_REDACTION_RULES` entries. Avoid nested quantifiers.
 */

/** A name to match: a string is an exact, case-insensitive name; `"/.../flags"` (JSON configs) or a `RegExp` is tested. */
export type RedactionPattern = string | RegExp;

export interface RedactionTextRule {
  /** A `RegExp` (made global), a `"/.../flags"` string, or a literal string to find. Must not match the empty string. */
  pattern: RegExp | string;
  /** What each match becomes. Default `[redacted]`; must not itself match the pattern (the pass stays idempotent). */
  replace?: string;
}

export interface RedactionRules {
  /** Request and response headers to drop, next to the built-in secret headers. */
  headers?: readonly RedactionPattern[];
  /** Query and hash parameters whose values become `[redacted]` in every URL. */
  queryParams?: readonly RedactionPattern[];
  /** JSON keys whose values become `"[redacted]"` in console arguments and in form or JSON bodies a HAR keeps. */
  jsonKeys?: readonly RedactionPattern[];
  /** Free-text replacements over DOM text and attributes, console messages, step labels, the title, URLs and header values. */
  text?: readonly RedactionTextRule[];
  /** CSS selectors whose text is masked in the DOM snapshot (rrweb `maskTextSelector`). */
  maskSelectors?: readonly string[];
}

export const MAX_REDACTION_PATTERN_LENGTH = 200;
export const MAX_REDACTION_RULES = 100;
const KEYS = new Set(['headers', 'queryParams', 'jsonKeys', 'text', 'maskSelectors']);
const NAME_LISTS = ['headers', 'queryParams', 'jsonKeys'] as const;
const SLASHED = /^\/(.+)\/([dgimsuvy]*)$/s;

function fail(where: string, message: string): never {
  throw new Error(`${where} ${message}`);
}

function checkLength(source: string, where: string) {
  if (source.length > MAX_REDACTION_PATTERN_LENGTH) fail(where, `is longer than ${MAX_REDACTION_PATTERN_LENGTH} characters`);
}

/** The pattern as a `RegExp` (a `"/.../flags"` string compiled), or the literal string. Throws on a bad or oversized one. */
function parsePattern(value: unknown, where: string): RegExp | string {
  if (value instanceof RegExp) {
    checkLength(value.source, where);
    return value;
  }
  if (typeof value !== 'string' || !value) fail(where, 'must be a non-empty string or a RegExp');
  checkLength(value, where);
  const slashed = SLASHED.exec(value);
  if (!slashed) return value;
  try {
    return new RegExp(slashed[1]!, slashed[2]);
  } catch (error) {
    fail(where, `is not a valid regular expression: ${(error as Error).message}`);
  }
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(where, 'must be an array');
  if (value.length > MAX_REDACTION_RULES) fail(where, `may have at most ${MAX_REDACTION_RULES} entries`);
  return value;
}

/** Flags without the stateful ones, so `test` and `replace` never depend on a previous call. */
const stateless = (pattern: RegExp, extra = '') => new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}${extra}`);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function textRegExp(pattern: RegExp | string) {
  return typeof pattern === 'string' ? new RegExp(escape(pattern), 'g') : stateless(pattern, 'g');
}

/** Throws (naming the bad field) unless `value` is a well-formed `RedactionRules`. */
export function assertRedactionRules(value: unknown, where = 'redaction'): asserts value is RedactionRules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'must be an object');
  const rules = value as Record<string, unknown>;
  const unknown = Object.keys(rules).filter((key) => !KEYS.has(key));
  if (unknown.length) fail(where, `has unknown keys: ${unknown.join(', ')}`);
  for (const key of NAME_LISTS) {
    if (rules[key] === undefined) continue;
    list(rules[key], `${where}.${key}`).forEach((entry, index) => parsePattern(entry, `${where}.${key}[${index}]`));
  }
  if (rules.text !== undefined) {
    list(rules.text, `${where}.text`).forEach((entry, index) => {
      const at = `${where}.text[${index}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(at, 'must be { pattern, replace? }');
      const { pattern, replace, ...rest } = entry as Record<string, unknown>;
      if (Object.keys(rest).length) fail(at, `has unknown keys: ${Object.keys(rest).join(', ')}`);
      if (replace !== undefined && (typeof replace !== 'string' || replace.length > MAX_REDACTION_PATTERN_LENGTH))
        fail(`${at}.replace`, `must be a string of at most ${MAX_REDACTION_PATTERN_LENGTH} characters`);
      const regExp = textRegExp(parsePattern(pattern, `${at}.pattern`));
      if (regExp.test('')) fail(`${at}.pattern`, 'must not match the empty string');
      regExp.lastIndex = 0;
      if (regExp.test(replace ?? '[redacted]')) fail(`${at}.replace`, 'must not match its own pattern');
    });
  }
  if (rules.maskSelectors !== undefined) {
    list(rules.maskSelectors, `${where}.maskSelectors`).forEach((entry, index) => {
      const at = `${where}.maskSelectors[${index}]`;
      if (typeof entry !== 'string' || !entry.trim()) fail(at, 'must be a non-empty CSS selector');
      checkLength(entry, at);
    });
  }
}

/** All rules in one: the lists concatenated (rules from several plugins and the config file add up). */
export function mergeRedactionRules(...sets: readonly (RedactionRules | undefined)[]): RedactionRules {
  const merged: { -readonly [K in keyof RedactionRules]-?: NonNullable<RedactionRules[K]>[number][] } = {
    headers: [],
    queryParams: [],
    jsonKeys: [],
    text: [],
    maskSelectors: [],
  };
  for (const rules of sets) {
    if (!rules) continue;
    for (const key of KEYS) merged[key as keyof typeof merged].push(...((rules[key as keyof RedactionRules] ?? []) as never[]));
  }
  return Object.fromEntries(Object.entries(merged).filter(([, entries]) => entries.length)) as RedactionRules;
}

/** Rules ready to run: name tests, global text patterns, selectors. Built once per rules object. */
export interface CompiledRedaction {
  readonly empty: boolean;
  header(name: string): boolean;
  queryParam(name: string): boolean;
  jsonKey(name: string): boolean;
  readonly text: readonly { pattern: RegExp; replace: string }[];
  readonly maskSelectors: readonly string[];
}

function nameTest(patterns: readonly RedactionPattern[] | undefined, where: string) {
  const names = new Set<string>();
  const tests: RegExp[] = [];
  (patterns ?? []).forEach((entry, index) => {
    const parsed = parsePattern(entry, `${where}[${index}]`);
    if (typeof parsed === 'string') names.add(parsed.toLowerCase());
    else tests.push(stateless(parsed));
  });
  if (!names.size && !tests.length) return () => false;
  return (name: string) => names.has(name.toLowerCase()) || tests.some((test) => test.test(name));
}

const NONE: CompiledRedaction = Object.freeze({
  empty: true,
  header: () => false,
  queryParam: () => false,
  jsonKey: () => false,
  text: [],
  maskSelectors: [],
});
const compiled = new WeakMap<RedactionRules, CompiledRedaction>();

/** Validates and compiles `rules` (cached per object); `undefined` compiles to "no extra rules". */
export function compileRedaction(rules: RedactionRules | undefined): CompiledRedaction {
  if (!rules) return NONE;
  const cached = compiled.get(rules);
  if (cached) return cached;
  assertRedactionRules(rules);
  const text = (rules.text ?? []).map((rule) => ({
    pattern: textRegExp(parsePattern(rule.pattern, 'pattern')),
    replace: rule.replace ?? '[redacted]',
  }));
  const maskSelectors = (rules.maskSelectors ?? []).map((selector) => selector.trim());
  const result: CompiledRedaction = Object.freeze({
    empty: !NAME_LISTS.some((key) => rules[key]?.length) && !text.length && !maskSelectors.length,
    header: nameTest(rules.headers, 'redaction.headers'),
    queryParam: nameTest(rules.queryParams, 'redaction.queryParams'),
    jsonKey: nameTest(rules.jsonKeys, 'redaction.jsonKeys'),
    text,
    maskSelectors,
  });
  compiled.set(rules, result);
  return result;
}

/**
 * Settle the whole merged rule list, so later replacements cannot leave work for an earlier rule on the next upload.
 * A cycle or an expanding/non-converging rule set fails closed without including recorded text in the error.
 */
export function redactText(value: string, rules: CompiledRedaction): string {
  if (!rules.text.length) return value;
  let result = value;
  const seen = new Set([value]);
  const maxLength = Math.max(4096, value.length * 4);
  for (let pass = 0; pass < 32; pass++) {
    let changed = false;
    for (const rule of rules.text) {
      const next = result.replace(rule.pattern, rule.replace);
      changed ||= next !== result;
      if (next.length > maxLength) throw new Error('redaction.text replacements exceed the output limit');
      result = next;
    }
    if (!changed) return result;
    if (seen.has(result)) throw new Error('redaction.text replacements form a cycle');
    seen.add(result);
  }
  throw new Error('redaction.text replacements did not settle within 32 passes');
}

/** The end of the JSON value that starts at `start` (a string, an object or array, or a bare scalar). */
function jsonValueEnd(text: string, start: number): number {
  const first = text[start];
  if (first === '"') {
    for (let index = start + 1; index < text.length; index++) {
      if (text[index] === '\\') index++;
      else if (text[index] === '"') return index + 1;
    }
    return text.length;
  }
  if (first === '{' || first === '[') {
    let depth = 0;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (char === '"') index = jsonValueEnd(text, index) - 1;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) return index + 1;
      }
    }
    return text.length;
  }
  const end = /[,}\]\s]/.exec(text.slice(start));
  return end ? start + end.index : text.length;
}

const JSON_KEY = /"((?:[^"\\]|\\.)*)"\s*:\s*/g;

/**
 * Replaces the value of every matching key in JSON text (a console argument logged as an object, a JSON body) with
 * `"[redacted]"`, nested objects and arrays included. Text that is not JSON is scanned the same way, so `{"ssn": 1}`
 * inside a longer message is found too.
 */
export function redactJsonKeys(text: string, rules: CompiledRedaction): string {
  if (!text.includes('"')) return text;
  let result = '';
  let last = 0;
  JSON_KEY.lastIndex = 0;
  for (let match = JSON_KEY.exec(text); match; match = JSON_KEY.exec(text)) {
    let key = match[1]!;
    try {
      key = JSON.parse(`"${key}"`) as string;
    } catch {
      /* keep the raw key */
    }
    const valueStart = match.index + match[0].length;
    if (valueStart >= text.length || !rules.jsonKey(key)) continue;
    const valueEnd = jsonValueEnd(text, valueStart);
    result += `${text.slice(last, valueStart)}"[redacted]"`;
    last = valueEnd;
    JSON_KEY.lastIndex = valueEnd;
  }
  return last ? result + text.slice(last) : text;
}
