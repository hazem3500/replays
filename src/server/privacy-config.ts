import type { Identity } from './auth/types.ts';
import { assertShape, isBoolean } from '../shared/validate.ts';

/** Server privacy switches that relax a default (`privacy` in the config file). Each is off unless set. */
export interface PrivacyConfig {
  /**
   * Keep ordinary input values of a recording made with the browser recorder's `privacy.sanitize: false`
   * (`meta.captured.inputs: 'visible'`), when a signed-in staff session uploads it (`isStaffUpload`). Password and
   * hidden inputs stay masked. Off by default: every input value is masked.
   */
  keepVisibleInputs?: boolean;
}

export interface PrivacySettings {
  keepVisibleInputs: boolean;
}

/** The config file's `privacy`, checked; absent means every switch off. */
export function privacyFromConfig(value: unknown): PrivacySettings {
  if (value === undefined) return { keepVisibleInputs: false };
  assertShape(value, { keepVisibleInputs: [isBoolean, 'must be true or false'] }, "the config file's privacy");
  return { keepVisibleInputs: value.keepVisibleInputs === true };
}

/**
 * Whether an upload comes from a signed-in staff session rather than a customer, app-key or token ingest: the core
 * `POST /api/replays` route (no plugin upload endpoint, so no endpoint's own credential and no support or customer
 * alias), a real auth adapter (not `none`), and an unrestricted identity (no route `capabilities`, no `authScopes`).
 * invariant: it only narrows; it never decides who may upload.
 */
export function isStaffUpload(upload: { path: string; endpoint: unknown; authName: string; identity: Identity }): boolean {
  return (
    upload.path === '/api/replays' &&
    upload.endpoint === undefined &&
    upload.authName !== 'none' &&
    upload.identity.capabilities === undefined &&
    upload.identity.authScopes === undefined
  );
}
