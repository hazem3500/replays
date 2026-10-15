import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SourceProviders, type TemplateProviderConfig } from '../shared/source-providers.ts';
import { retentionFromEnv, type RetentionPolicy } from '../shared/retention.ts';
import { type BrandingConfig, validateBranding } from './branding.ts';
import { type ContextSchema, loadContextSchema } from './context-schema.ts';
import { normalizeBasePath } from './base-path.ts';
import { type BetaFlags, betaFromEnv } from './beta.ts';

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
 *     "retentionDays": 30,                         RETENTION_DAYS (0 = never)
 *     "contextSchemaFile": "./context.schema.json" CONTEXT_SCHEMA_FILE
 *     "githubHost": "github.example.com",          GITHUB_HOST
 *     "gitlabHost": "gitlab.example.com",          GITLAB_HOST
 *     "sourceProviders": [{ "id": "jira", "template": "https://jira.example.com/browse/{ref}" }],
 *     "beta": { "editor": false }                  REPLAYS_BETA_EDITOR (off by default; src/server/beta.ts)
 *   }
 */
export interface FileConfig {
  name?: string;
  logoUrl?: string;
  theme?: BrandingConfig['theme'];
  basePath?: string;
  retentionDays?: number;
  contextSchemaFile?: string;
  githubHost?: string;
  gitlabHost?: string;
  sourceProviders?: TemplateProviderConfig[];
  beta?: { editor?: boolean };
}

export interface AppSettings {
  branding: BrandingConfig;
  basePath: string;
  retention: RetentionPolicy;
  sources: SourceProviders;
  contextSchema?: ContextSchema;
  beta: BetaFlags;
}

const KEYS = new Set([
  'name',
  'logoUrl',
  'theme',
  'basePath',
  'retentionDays',
  'contextSchemaFile',
  'githubHost',
  'gitlabHost',
  'sourceProviders',
  'beta',
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
  const unknown = Object.keys(parsed).filter((key) => !KEYS.has(key));
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
  return { branding, basePath, retention, sources, beta: betaFromEnv(env, file.beta), ...(contextSchema ? { contextSchema } : {}) };
}
