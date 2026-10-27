import { PRODUCT_NAME } from '../shared/brand.ts';
import type { MalleablePolicy } from '../shared/malleable-policy.ts';

/** The deployment's branding, written into index.html by the server (src/server/base-path.ts `withBase`). */
export function productName() {
  if (typeof document === 'undefined') return PRODUCT_NAME;
  const content = document.querySelector<HTMLMetaElement>('meta[name="app-name"]')?.content;
  return content && content !== '__PRODUCT_NAME__' ? content : PRODUCT_NAME;
}

/** The configured logo (https or data: image URL), or undefined for the built-in mark. */
export function productLogo() {
  if (typeof document === 'undefined') return undefined;
  const content = document.querySelector<HTMLMetaElement>('meta[name="app-logo"]')?.content;
  return content && content !== '__PRODUCT_LOGO__' ? content : undefined;
}

/** A JSON Schema as far as the viewer reads it (the server validates with the full thing). */
export interface FieldSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  format?: string;
  enum?: unknown[];
  properties?: Record<string, FieldSchema>;
  items?: FieldSchema;
  /** Viewer hint: `signals` draws an array of `{ key, state, label? }` as tri-state chips (context-fields.ts). */
  'x-replays-widget'?: string;
  /** Viewer hint on a top-level property: the Context tab group it belongs to (its heading). */
  'x-replays-group'?: string;
  /** Viewer hint: rows sort by it, lower first (default 0), then in schema order. */
  'x-replays-order'?: number;
}

/** `GET /api/config`. */
export interface ClientConfig {
  name: string;
  logoUrl?: string;
  /** Schema of `context.fields`, when the deployment configured one. */
  contextSchema?: FieldSchema;
  sourceProviders: string[];
  auth: string;
  /** Present only when the host opted into and validated an OIDC public-client device flow. */
  cliDeviceAuth?: import('../server/auth/types.ts').CliDeviceAuthCapability;
  signIn?: import('../shared/sign-in.ts').SignInConfig;
  /** This package's version. */
  core?: string;
  /** The deployment's `distribution` config, when set. */
  distribution?: { name: string; version: string };
  /** The host's policy for user plugins (only with beta.malleable on): src/shared/malleable-policy.ts. */
  malleable?: MalleablePolicy;
  /** Plugin index filters the server matches (`api.indexFilter`); absent when there are none. */
  indexFilters?: Array<{ plugin: string; id: string; param: string }>;
  /** Effective edit write capability, with beta.editor as the outer gate. */
  editing: { enabled: boolean };
}

let betaEditorOverride: boolean | undefined;

/**
 * Whether the beta editor is on (server: `REPLAYS_BETA_EDITOR=true` or `beta.editor` in the config file). The server
 * writes it into index.html (`<meta name="app-beta" content="editor">`); off by default. With it off the viewer shows no
 * editor UI, loads no edit lists and never fetches the editor's code.
 */
export function betaEditor() {
  if (betaEditorOverride !== undefined) return betaEditorOverride;
  if (typeof document === 'undefined') return false;
  const content = document.querySelector<HTMLMetaElement>('meta[name="app-beta"]')?.content ?? '';
  return content.split(/[\s,]+/).includes('editor');
}

/** Tests only: force the flag without a document. */
export function setBetaEditorForTests(value: boolean | undefined) {
  betaEditorOverride = value;
}

/** Host write capability. Absent metadata preserves compatibility with older beta-enabled hosts. */
export function editingEnabled() {
  if (!betaEditor()) return false;
  if (typeof document === 'undefined') return true;
  return document.querySelector<HTMLMetaElement>('meta[name="app-editing"]')?.content !== 'off';
}
