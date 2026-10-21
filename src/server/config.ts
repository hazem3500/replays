import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SourceProviders, type TemplateProviderConfig } from '../shared/source-providers.ts';
import { retentionFromEnv, type RetentionPolicy } from '../shared/retention.ts';
import { type BrandingConfig, validateBranding } from './branding.ts';
import { type ContextSchema, loadContextSchema } from './context-schema.ts';
import { type HostConfig, type HostRouting, normalizeBasePath, normalizeHosts } from './base-path.ts';
import { type BetaFlags, betaFromEnv, parseFlag } from './beta.ts';
import { type CommentsSettings, commentsFromEnv } from './comments-config.ts';
import type { PluginSpec } from '../plugin/types.ts';
import { assertRedactionRules, type RedactionRules } from '../shared/redaction.ts';

/**
 * The config file (`REPLAYS_CONFIG=/etc/replays/config.json`) holds the non-secret settings; every key
 * also has an environment variable, and the environment wins. Secrets (OIDC client secret, storage credentials)
 * are environment-only.
 *
 *   {
 *     "name": "Acme Replays",                      PRODUCT_NAME
 *     "logoUrl": "https://example.com/logo.svg",   LOGO_URL
 *     "theme": { "dark": { "accent": "#7aa2ff" }, "light": { "accent": "#2f55d4" } },
 *     "basePath": "/replays",                      BASE_PATH
 *     "hosts": { "replays.example.com": { "basePath": "/" } },  per-host bases (src/server/base-path.ts), else basePath
 *     "trustForwardedHost": false,                 TRUST_FORWARDED_HOST (pick the host from X-Forwarded-Host)
 *     "retentionDays": 30,                         RETENTION_DAYS (0 = never)
 *     "contextSchemaFile": "./context.schema.json" CONTEXT_SCHEMA_FILE
 *     "githubHost": "github.example.com",          GITHUB_HOST
 *     "gitlabHost": "gitlab.example.com",          GITLAB_HOST
 *     "sourceProviders": [{ "id": "jira", "template": "https://jira.example.com/browse/{ref}" }],
 *     "beta": { "editor": false, "malleable": false },  REPLAYS_BETA_EDITOR, REPLAYS_BETA_MALLEABLE (off by default; src/server/beta.ts)
 *     "comments": { "enabled": true },             REPLAYS_COMMENTS (on by default; src/server/comments-config.ts)
 *     "auth": "iap-header",                        AUTH_MODE (a built-in mode or an auth adapter a plugin registered)
 *     "storage": "gcs",                            STORAGE (fs, s3 or a storage backend a plugin registered)
 *     "plugins": ["./plugin.mjs", ["pkg", {}]]     plugins to load (src/plugin/, docs/extension-api.md)
 *     "redaction": { "jsonKeys": ["ssn", "/card_?number/i"] }   added to the sanitiser's defaults (src/shared/redaction.ts)
 *   }
 *
 * The same keys, typed, make up `defineConfig()` in a `replays.config.ts|js|json` (src/config/).
 */
export interface FileConfig {
  name?: string;
  logoUrl?: string;
  theme?: BrandingConfig['theme'];
  basePath?: string;
  /** A different base per request host (`Host`, or `X-Forwarded-Host` when trusted); other hosts get `basePath`. */
  hosts?: Readonly<Record<string, HostConfig>>;
  /** Read the request host from `X-Forwarded-Host` (a gateway that rewrites `Host`). Only matters with `hosts`. */
  trustForwardedHost?: boolean;
  retentionDays?: number;
  contextSchemaFile?: string;
  githubHost?: string;
  gitlabHost?: string;
  sourceProviders?: TemplateProviderConfig[];
  beta?: { editor?: boolean; malleable?: boolean };
  comments?: { enabled?: boolean };
  auth?: string;
  storage?: string;
  plugins?: readonly PluginSpec[];
  /** Redaction rules added to the defaults; JSON configs write regular expressions as `"/.../flags"` strings. */
  redaction?: RedactionRules;
}

export interface AppSettings {
  branding: BrandingConfig;
  basePath: string;
  /** Per-host bases (`hosts`, `trustForwardedHost`); no entries means one base for every host. */
  hosts: HostRouting;
  retention: RetentionPolicy;
  sources: SourceProviders;
  contextSchema?: ContextSchema;
  beta: BetaFlags;
  comments: CommentsSettings;
  /** The config file's `redaction` rules, checked (plugins' rules are merged in by the app). */
  redaction?: RedactionRules;
}

export const CONFIG_KEYS = new Set([
  'name',
  'logoUrl',
  'theme',
  'basePath',
  'hosts',
  'trustForwardedHost',
  'retentionDays',
  'contextSchemaFile',
  'githubHost',
  'gitlabHost',
  'sourceProviders',
  'beta',
  'comments',
  'auth',
  'storage',
  'plugins',
  'redaction',
]);

export async function readConfigFile(path: string | undefined): Promise<FileConfig> {
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read REPLAYS_CONFIG ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the config file must be a JSON object');
  const unknown = Object.keys(parsed).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length) throw new Error(`the config file has unknown keys: ${unknown.join(', ')}`);
  return parsed as FileConfig;
}

const HOST = /^[a-z0-9.-]+(:\d+)?$/i;

export async function loadSettings(env: NodeJS.ProcessEnv, file: FileConfig = {}, cwd = process.cwd()): Promise<AppSettings> {
  const pick = (name: string) => env[name]?.trim() || undefined;
  const branding = validateBranding({
    name: pick('PRODUCT_NAME') ?? file.name,
    ...((pick('LOGO_URL') ?? file.logoUrl) ? { logoUrl: (pick('LOGO_URL') ?? file.logoUrl)! } : {}),
    ...(file.theme ? { theme: file.theme } : {}),
  } as Partial<BrandingConfig>);
  const basePath = normalizeBasePath(pick('BASE_PATH') ?? file.basePath);
  if (file.trustForwardedHost !== undefined && typeof file.trustForwardedHost !== 'boolean')
    throw new Error("the config file's trustForwardedHost must be true or false");
  const hosts = normalizeHosts(file.hosts, parseFlag('TRUST_FORWARDED_HOST', env.TRUST_FORWARDED_HOST) ?? file.trustForwardedHost ?? false);
  const retention =
    pick('RETENTION_DAYS') !== undefined || file.retentionDays === undefined
      ? retentionFromEnv(env)
      : retentionFromEnv({ RETENTION_DAYS: String(file.retentionDays) });
  const githubHost = pick('GITHUB_HOST') ?? file.githubHost;
  const gitlabHost = pick('GITLAB_HOST') ?? file.gitlabHost;
  for (const host of [githubHost, gitlabHost]) if (host && !HOST.test(host)) throw new Error(`invalid host name ${JSON.stringify(host)}`);
  const sources = new SourceProviders({
    ...(githubHost ? { githubHost } : {}),
    ...(gitlabHost ? { gitlabHost } : {}),
    templates: file.sourceProviders ?? [],
  });
  const schemaFile = pick('CONTEXT_SCHEMA_FILE') ?? file.contextSchemaFile;
  const contextSchema = schemaFile ? await loadContextSchema(resolve(cwd, schemaFile)) : undefined;
  if (file.redaction !== undefined) assertRedactionRules(file.redaction, 'config redaction');
  return {
    branding,
    basePath,
    hosts,
    retention,
    sources,
    beta: betaFromEnv(env, file.beta),
    comments: commentsFromEnv(env, file.comments),
    ...(contextSchema ? { contextSchema } : {}),
    ...(file.redaction ? { redaction: file.redaction } : {}),
  };
}
