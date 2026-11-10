import { PRODUCT_NAME } from '../shared/brand.ts';
import type { BetaFlags } from '../shared/beta-flags.ts';
import type { MalleablePolicy } from '../shared/malleable-policy.ts';
import { betaAllowed, betaEnabled } from './settings/labs.ts';
import { pageMeta } from './page-meta.ts';

/** The deployment's branding, written into index.html by the server (src/server/base-path.ts `withBase`). */
export function productName() {
  const content = pageMeta('app-name');
  return content && content !== '__PRODUCT_NAME__' ? content : PRODUCT_NAME;
}

/** The configured logo (https or data: image URL), or undefined for the built-in mark. */
export function productLogo() {
  const content = pageMeta('app-logo');
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
  /** Links to the deployment's other tools. */
  integrations?: { traceUrlTemplate?: string };
  /** Host CLI commands for Settings (src/shared/help-links.ts `CliConfig`). */
  cli?: import('../shared/help-links.ts').CliConfig;
  /** Host help links; `false` hides one, unset keeps the project's own (src/shared/help-links.ts `LinksConfig`). */
  links?: import('../shared/help-links.ts').LinksConfig;
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
  /** What the server allows (the ceiling); each person can opt out under Settings › Labs (src/shared/beta-flags.ts). */
  beta?: BetaFlags;
  /** The loaded plugins' names, built-ins included (`github-connect` when the host set a GitHub OAuth app). */
  plugins?: string[];
  /** Plugin index filters the server matches (`api.indexFilter`); absent when there are none. */
  indexFilters?: Array<{ plugin: string; id: string; param: string }>;
  /** Effective edit write capability, with beta.editor as the outer gate. */
  editing: { enabled: boolean };
}

let betaEditorOverride: boolean | undefined;

/**
 * Whether this server allows the beta editor (`REPLAYS_BETA_EDITOR=true` or `beta.editor` in the config file; written into
 * index.html as `<meta name="app-beta" content="editor">`; off by default). Saved edits load and play whenever it is allowed:
 * they are content. Whether this person sees the editing UI is `editingEnabled()`.
 */
export function betaEditor() {
  if (betaEditorOverride !== undefined) return betaEditorOverride;
  return betaAllowed('editor');
}

/** Tests only: force the flag without a document. */
export function setBetaEditorForTests(value: boolean | undefined) {
  betaEditorOverride = value;
}

/** Host write capability. Absent metadata preserves compatibility with older beta-enabled hosts. */
export function editingEnabled() {
  if (!betaEditor()) return false;
  // why: a person who opted out under Settings › Labs sees no editing UI; saved edits still play.
  if (betaEditorOverride === undefined && !betaEnabled('editor')) return false;
  return pageMeta('app-editing') !== 'off';
}
