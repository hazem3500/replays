import type { SourceProviderInfo } from '../shared/source-providers.ts';
import type { PurposeInfo } from '../shared/purposes.ts';
import type { ResolvedClientEntry } from '../plugin/registry.ts';
import { withBase } from './base-path.ts';
import { editingFromEnv, type EditingSettings } from './editing-config.ts';
import type { BetaFlags } from './beta.ts';
import { type BrandingConfig, pageBranding } from './branding.ts';
import { publicClientEntries } from './plugin-runtime.ts';

/** What index.html is stamped with: the server does it per request (per host base), `replays build-static` once. */
export interface IndexPageOptions {
  /** The public base (`''` at a domain's root, else `/a/b`). */
  base: string;
  branding: BrandingConfig;
  beta?: BetaFlags;
  /** Purposes available in this deployment, including plugin declarations. */
  purposes?: readonly PurposeInfo[];
  /** Provider icons and nouns for the source chips. */
  sources?: readonly SourceProviderInfo[];
  /** Host write policy, still gated by beta.editor. */
  editing?: EditingSettings;
  /** The comments plugin is loaded (`<meta name="app-comments" content="on">`). */
  comments?: boolean;
  /** The plugins' browser entries; served ones are listed by their URL under `base` (`<base>/_plugins/…`). */
  clientEntries?: readonly ResolvedClientEntry[];
}

/**
 * The built viewer's index.html with the deployment's settings in it: base, product name and logo, theme tokens and
 * theme-color, beta flags, comments and plugin entries (base-path.ts `withBase`). One function for both the server and
 * the static build, so a CDN-hosted viewer gets exactly what the server would have sent.
 */
export function renderIndexHtml(html: string, options: IndexPageOptions) {
  const beta = [options.beta?.editor ? 'editor' : '', options.beta?.malleable ? 'malleable' : ''].filter(Boolean).join(' ');
  const entries = options.clientEntries ?? [];
  return withBase(html, options.base, {
    ...pageBranding(options.branding),
    ...(options.sources?.length ? { sources: JSON.stringify(options.sources) } : {}),
    ...(options.purposes?.length ? { purposes: JSON.stringify(options.purposes) } : {}),
    ...(entries.length ? { plugins: JSON.stringify(publicClientEntries(entries, options.base)) } : {}),
    beta,
    editing: Boolean(options.beta?.editor) && editingFromEnv({}, options.editing).enabled,
    comments: Boolean(options.comments),
  });
}
