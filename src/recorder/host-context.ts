import type { ReplayContext } from '../shared/context.ts';
import { redactText } from './redact.ts';

/** Explicit host-supplied context only; no browser storage or application state is inspected. */
export type RecorderHostContext = Pick<ReplayContext, 'app'> & {
  fields?: Record<string, string | number | boolean | null>;
};

/** Keeps host context small and flat before it reaches the server's authoritative validator. */
export function recorderContext(input: RecorderHostContext, capturedAt: string): ReplayContext {
  const app: NonNullable<ReplayContext['app']> = {};
  for (const key of ['name', 'environment', 'version', 'commit', 'origin'] as const) {
    const value = input.app?.[key];
    if (value !== undefined) {
      const limit = key === 'environment' ? 40 : key === 'commit' ? 64 : key === 'origin' ? 200 : 80;
      if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('Invalid recorder context app value');
      if (key === 'environment' && !/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error('Invalid recorder context environment');
      if (key === 'version' && !/^[a-zA-Z0-9.+_-]+$/.test(value)) throw new Error('Invalid recorder context version');
      if (key === 'commit' && !/^[a-fA-F0-9]{7,64}$/.test(value)) throw new Error('Invalid recorder context commit');
      if (key === 'origin') {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password)
          throw new Error('Invalid recorder context origin');
      }
      app[key] = redactText(value, limit);
    }
  }
  const fields: NonNullable<RecorderHostContext['fields']> = {};
  const entries = Object.entries(input.fields ?? {});
  if (entries.length > 40) throw new Error('Recorder context has too many fields');
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][\w.-]{0,79}$/.test(key) || /token|password|secret|cookie|authorization/i.test(key))
      throw new Error('Unsafe recorder context field');
    if (typeof value === 'string') fields[key] = redactText(value, 400);
    else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) fields[key] = value;
    else throw new Error('Recorder context fields must be scalar values');
  }
  const context: ReplayContext = {
    version: 1,
    capturedAt,
    ...(Object.keys(app).length ? { app } : {}),
    ...(entries.length ? { fields } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(context)).length > 16_384) throw new Error('Recorder context exceeds its byte limit');
  return context;
}
