import type { ReplayContext } from '../shared/context.ts';
import { redactText } from './redact.ts';

/** Explicit host-supplied context only; no browser storage or application state is inspected. */
export type RecorderHostContext = Pick<ReplayContext, 'app'> & {
  fields?: Record<string, string | number | boolean | null>;
};

const APP_LIMITS = { name: 80, environment: 40, version: 80, commit: 64, origin: 200 };
const APP_PATTERNS = {
  environment: /^[a-zA-Z0-9._-]+$/,
  version: /^[a-zA-Z0-9.+_-]+$/,
  commit: /^[a-fA-F0-9]{7,64}$/,
};

function appValue(key: keyof typeof APP_LIMITS, value: string): string {
  const limit = APP_LIMITS[key];
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('Invalid recorder context app value');
  const sanitized = redactText(value, limit);
  if (key in APP_PATTERNS && !APP_PATTERNS[key as keyof typeof APP_PATTERNS].test(sanitized)) {
    throw new Error('Invalid recorder context app value');
  }
  if (key === 'origin') {
    const url = new URL(sanitized);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== sanitized || url.username || url.password) {
      throw new Error('Invalid recorder context origin');
    }
  }
  return sanitized;
}

function contextFields(input: RecorderHostContext['fields']) {
  const entries = Object.entries(input ?? {});
  if (entries.length > 40) throw new Error('Recorder context has too many fields');
  const fields: NonNullable<RecorderHostContext['fields']> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][\w.-]{0,79}$/.test(key) || /token|password|secret|cookie|authorization|^(?:constructor|prototype)$/i.test(key)) {
      throw new Error('Unsafe recorder context field');
    }
    if (typeof value === 'string') fields[key] = redactText(value, 400);
    else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) fields[key] = value;
    else throw new Error('Recorder context fields must be scalar values');
  }
  return fields;
}

/** Keeps host context small and flat before it reaches the server's authoritative validator. */
export function recorderContext(input: RecorderHostContext, capturedAt: string): ReplayContext {
  const app: NonNullable<ReplayContext['app']> = {};
  for (const key of ['name', 'environment', 'version', 'commit', 'origin'] as const) {
    const value = input.app?.[key];
    if (value !== undefined) app[key] = appValue(key, value);
  }
  const fields = contextFields(input.fields);
  const context: ReplayContext = {
    version: 1,
    capturedAt,
    ...(Object.keys(app).length ? { app } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(context)).length > 16_384) throw new Error('Recorder context exceeds its byte limit');
  return context;
}
