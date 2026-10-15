import { PRODUCT_NAME } from '../shared/brand.ts';

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
}

/** `GET /api/config`. */
export interface ClientConfig {
  name: string;
  logoUrl?: string;
  /** Schema of `context.fields`, when the deployment configured one. */
  contextSchema?: FieldSchema;
  sourceProviders: string[];
  auth: string;
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
