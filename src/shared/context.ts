/*
 * Test-run context: the small, explicit block of metadata a producer attaches to a recording
 * (which app and build, which test, which tickets or pull requests, plus any fields of your own).
 * It is supplied by the runner, never scraped from the browser, and it is bounded.
 *
 * `fields` is the extension point: a free-form object that the server validates against an optional JSON Schema
 * (`CONTEXT_SCHEMA_FILE`) and the viewer renders using that schema's titles and types.
 */

/** A link to the thing a recording is about: a pull request, an issue, a ticket. `url` is always https. */
export interface ReplaySourceRef {
  /** The provider that resolved it: `github`, `gitlab`, `url` or a configured template provider. */
  provider: string;
  /** The provider's own reference (`owner/repo#12`), when there is one. */
  ref?: string;
  url: string;
  label?: string;
  /** Small facts about the target from its provider (`{ channel: 'support', replies: 3 }`); see sourceAttrs. */
  attrs?: SourceAttrs;
}

/** A source's attributes: at most MAX_SOURCE_ATTRS short string or number values under identifier-like keys. */
export type SourceAttrs = Record<string, string | number>;

/** What a producer sends: `url` may be left out when the provider can resolve `ref` (source-providers.ts). */
export interface ReplaySourceInput {
  provider: string;
  ref?: string;
  url?: string;
  label?: string;
  attrs?: SourceAttrs;
}

export interface ReplayContext {
  version: 1;
  capturedAt: string;
  app?: { name?: string; environment?: string; origin?: string; version?: string; commit?: string };
  test?: { suite?: string; case?: string; runId?: string };
  sources?: ReplaySourceRef[];
  /** User-defined fields; shape decided by the configured JSON Schema, if any. */
  fields?: Record<string, unknown>;
}

export const MAX_CONTEXT_BYTES = 16_384;
export const MAX_SOURCES = 10;
export const MAX_SOURCE_ATTRS = 8;
const ATTR_KEY = /^[A-Za-z][\w-]{0,39}$/;
const MAX_ATTR_TEXT = 200;

/**
 * The attributes worth keeping from `value`, capped: the first `max` entries with a valid key and a short string (no
 * line breaks or angle brackets) or finite number. Anything else is dropped, never an error: a provider's resolver
 * should not fail an upload over a decoration. Undefined when nothing is left.
 */
export function sourceAttrs(value: unknown, max = MAX_SOURCE_ATTRS, maxText = MAX_ATTR_TEXT): SourceAttrs | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const kept: SourceAttrs = {};
  let count = 0;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (count >= max) break;
    if (!ATTR_KEY.test(key)) continue;
    if (typeof entry === 'number' ? !Number.isFinite(entry) : typeof entry !== 'string' || !entry || /[\n\r<>]/.test(entry)) continue;
    kept[key] = typeof entry === 'string' ? entry.slice(0, maxText) : (entry as number);
    count += 1;
  }
  return count ? kept : undefined;
}

function object(value: unknown, name: string, allowed: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${name} contains unsupported fields: ${unknown.join(', ')}`);
  return record;
}

function text(value: unknown, name: string, max: number, pattern = /^[\w .:+()/#@-]+$/) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !pattern.test(value)) {
    throw new Error(`${name} is invalid`);
  }
}

/** `https:` URLs without credentials or fragments; the only links the viewer ever renders. */
export function assertSafeUrl(value: unknown, name: string) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error(`${name} is invalid`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is invalid`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`${name} is unsafe`);
  return url;
}

/** JSON values only, bounded in depth and breadth: `fields` is rendered by the viewer, so keep it small and plain. */
function assertPlainJson(value: unknown, name: string, depth = 0) {
  if (depth > 6) throw new Error(`${name} is nested too deeply`);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 200) throw new Error(`${name} has too many entries`);
    value.forEach((entry, index) => assertPlainJson(entry, `${name}[${index}]`, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 100) throw new Error(`${name} has too many keys`);
    for (const [key, entry] of entries) {
      if (key === '__proto__' || key.length > 80) throw new Error(`${name} has an invalid key`);
      assertPlainJson(entry, `${name}.${key}`, depth + 1);
    }
    return;
  }
  throw new Error(`${name} must be plain JSON`);
}

/** Structural validation of a stored context; `fields` is further checked by the server's JSON Schema, if any. */
export function assertReplayContext(value: unknown): asserts value is ReplayContext {
  const context = object(value, 'replay.context', ['version', 'capturedAt', 'app', 'test', 'sources', 'fields']);
  if (context.version !== 1) throw new Error('replay.context.version is unsupported');
  if (typeof context.capturedAt !== 'string' || !Number.isFinite(Date.parse(context.capturedAt))) {
    throw new Error('replay.context.capturedAt is invalid');
  }
  if (context.app !== undefined) {
    const app = object(context.app, 'replay.context.app', ['name', 'environment', 'origin', 'version', 'commit']);
    if (app.name !== undefined) text(app.name, 'replay.context.app.name', 80);
    if (app.environment !== undefined) text(app.environment, 'replay.context.app.environment', 40, /^[a-zA-Z0-9._-]+$/);
    if (app.version !== undefined) text(app.version, 'replay.context.app.version', 80, /^[a-zA-Z0-9.+_-]+$/);
    if (app.commit !== undefined) text(app.commit, 'replay.context.app.commit', 64, /^[a-fA-F0-9]{7,64}$/);
    if (app.origin !== undefined) {
      let origin: URL;
      try {
        origin = new URL(String(app.origin));
      } catch {
        throw new Error('replay.context.app.origin is invalid');
      }
      if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== app.origin || origin.username || origin.password) {
        throw new Error('replay.context.app.origin must be a bare http(s) origin');
      }
    }
  }
  if (context.test !== undefined) {
    const test = object(context.test, 'replay.context.test', ['suite', 'case', 'runId']);
    for (const field of ['suite', 'case', 'runId']) if (test[field] !== undefined) text(test[field], `replay.context.test.${field}`, 120);
  }
  if (context.sources !== undefined) {
    if (!Array.isArray(context.sources) || context.sources.length > MAX_SOURCES)
      throw new Error(`replay.context.sources must contain at most ${MAX_SOURCES} entries`);
    for (const [index, raw] of context.sources.entries()) {
      const name = `replay.context.sources[${index}]`;
      const source = object(raw, name, ['provider', 'ref', 'url', 'label', 'attrs']);
      text(source.provider, `${name}.provider`, 40, /^[a-z0-9][a-z0-9_-]*$/);
      assertSafeUrl(source.url, `${name}.url`);
      if (source.ref !== undefined) text(source.ref, `${name}.ref`, 200, /^[^\s]+$/);
      if (source.label !== undefined) text(source.label, `${name}.label`, 80, /^[^\n\r<>]+$/);
      if (source.attrs !== undefined) {
        // Stored attrs are already capped (sourceAttrs): anything the cap would change is refused.
        const attrs = source.attrs;
        const count = attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? Object.keys(attrs).length : -1;
        const kept = sourceAttrs(attrs);
        if (count < 0 || count > MAX_SOURCE_ATTRS || JSON.stringify(kept ?? {}) !== JSON.stringify(attrs))
          throw new Error(`${name}.attrs must hold at most ${MAX_SOURCE_ATTRS} short text or number values`);
      }
    }
  }
  if (context.fields !== undefined) {
    object(context.fields, 'replay.context.fields', Object.keys(context.fields as object));
    assertPlainJson(context.fields, 'replay.context.fields');
  }
  if (JSON.stringify(context).length > MAX_CONTEXT_BYTES) throw new Error('replay.context exceeds 16 KB');
}
