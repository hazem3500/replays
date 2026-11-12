import { normalizeSignIn } from '../shared/sign-in.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SourceProviders, type TemplateProviderConfig } from '../shared/source-providers.ts';
import { daysFromEnv, retentionFromEnv, type RetentionPolicy } from '../shared/retention.ts';
import { type BrandingConfig, validateBranding } from './branding.ts';
import type { ContextSchema } from './context-schema.ts';
import { type HostConfig, type HostRouting, normalizeBasePath, normalizeHosts } from './base-path.ts';
import { type BetaFlags, betaFromEnv, parseFlag } from './beta.ts';
import { type CommentsSettings, commentsFromEnv } from './comments-config.ts';
import { type GithubConnectSettings, githubConnectFromEnv } from './github-connect-config.ts';
import { type EditingSettings, editingFromEnv } from './editing-config.ts';
import { type PrivacyConfig, privacyFromConfig, type PrivacySettings } from './privacy-config.ts';
import type { PluginSpec } from '../plugin/types.ts';
import { assertRedactionRules, type RedactionRules } from '../shared/redaction.ts';
import {
  type HostVersions,
  type MalleableConfig,
  type MalleablePolicy,
  parseDistribution,
  parseMalleablePolicy,
} from '../shared/malleable-policy.ts';
import type { CapturePacingOptions } from '../shared/capture-pacing.ts';
import type { ProfileConfig } from '../shared/profiles.ts';
import { configProfiles, createProfileCatalog, type ProfileCatalog } from './profiles.ts';
import type { ViewPreset } from '../shared/views.ts';
import { createViewCatalog, type ViewCatalog } from './views.ts';

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
 *     "retentionDays": 30,                         RETENTION_DAYS (0 = never); RETENTION_EXPIRED_DAYS: removed replays' records (default 30)
 *     "profiles": [{ "id": "triage", "label": "Triage", "retentionDays": 90 }],   RETENTION_PROFILE_<ID>_DAYS (src/server/profiles.ts)
 *     "contextSchemaFile": "./context.schema.json" CONTEXT_SCHEMA_FILE
 *     "githubHost": "github.example.com",          GITHUB_HOST
 *     "gitlabHost": "gitlab.example.com",          GITLAB_HOST
 *     "sourceProviders": [{ "id": "jira", "template": "https://jira.example.com/browse/{ref}" }],
 *     "beta": { "editor": false, "malleable": false },  REPLAYS_BETA_EDITOR, REPLAYS_BETA_MALLEABLE (off by default; src/server/beta.ts)
 *     "malleable": { "scopes": ["user"], "capabilities": { "export:download": "deny" }, "lockedSurfaces": [] },
 *                                                  the host's policy for user plugins (file only; src/shared/malleable-policy.ts)
 *     "distribution": { "name": "acme-replays", "version": "2.3.0" },  what this deployment is (file only)
 *     "editing": { "enabled": false },            EDITING_ENABLED (writes on by default, requires beta.editor)
 *     "comments": { "enabled": true },             REPLAYS_COMMENTS (on by default; src/server/comments-config.ts)
 *     "auth": "iap-header",                        AUTH_MODE (a built-in mode or an auth adapter a plugin registered)
 *     "storage": "gcs",                            STORAGE (fs, s3 or a storage backend a plugin registered)
 *     "plugins": ["./plugin.mjs", ["pkg", {}]]     plugins to load (src/plugin/, docs/extension-api.md)
 *     "redaction": { "jsonKeys": ["ssn", "/card_?number/i"] }   added to the sanitiser's defaults (src/shared/redaction.ts)
 *     "privacy": { "keepVisibleInputs": false }    staff uploads keep visible inputs (file only; src/server/privacy-config.ts)
 *     "privacy": { "keepCustomerChoices": false }  uploads keep a customer's chosen inputs and bodies (file only)
 *   }
 *
 * The same keys, typed, make up `defineConfig()` in a `replays.config.ts|js|json` (src/config/).
 */
export interface FileConfig {
  /** Browser sign-in recovery; explicit config also stamps a public static viewer. false overrides the adapter. */
  signIn?: import('../shared/sign-in.ts').SignInConfig | false;
  /** Capture CLI defaults, overridden by explicit flags; ignored by the server runtime. */
  capture?: CapturePacingOptions;
  name?: string;
  logoUrl?: string;
  theme?: BrandingConfig['theme'];
  /** Links to other tools; `traceUrlTemplate` (TRACE_URL_TEMPLATE) turns a request's trace ID into a link. */
  integrations?: BrandingConfig['integrations'];
  /** CLI commands for Settings › CLI & agents when the host publishes its own CLI (src/server/branding.ts `CliConfig`). */
  cli?: BrandingConfig['cli'];
  /** Where the viewer's help links point; `false` hides one (src/server/branding.ts `LinksConfig`). */
  links?: BrandingConfig['links'];
  basePath?: string;
  /** A different base per request host (`Host`, or `X-Forwarded-Host` when trusted); other hosts get `basePath`. */
  hosts?: Readonly<Record<string, HostConfig>>;
  /** Read the request host from `X-Forwarded-Host` (a gateway that rewrites `Host`). Only matters with `hosts`. */
  trustForwardedHost?: boolean;
  retentionDays?: number;
  /** Why replays are recorded (src/shared/profiles.ts); plugins can add more with `api.profile`. Core ships `performance` (BUILT_IN_PROFILES). */
  profiles?: ProfileConfig[];
  /** @deprecated Use `profiles`; read when `profiles` is absent, with a warning at start. */
  purposes?: ProfileConfig[];
  /** Views beside the built-ins (src/shared/views.ts); an entry with a built-in id retunes that view. */
  views?: ViewPreset[];
  contextSchemaFile?: string;
  githubHost?: string;
  gitlabHost?: string;
  sourceProviders?: TemplateProviderConfig[];
  beta?: { editor?: boolean; cursorCustomization?: boolean; malleable?: boolean };
  /** The host's policy for sandboxed user plugins; `malleable.enabled` is the same switch as `beta.malleable`. */
  malleable?: MalleableConfig;
  /** The deployment built on this package (`name@version`), shown in `/api/config` and recorded by kept user plugins. */
  distribution?: { name: string; version: string };
  comments?: { enabled?: boolean };
  editing?: { enabled?: boolean };
  auth?: string;
  storage?: string;
  plugins?: readonly PluginSpec[];
  /** Redaction rules added to the defaults; JSON configs write regular expressions as `"/.../flags"` strings. */
  redaction?: RedactionRules;
  /** Switches that relax a server privacy default, all off unless set (src/server/privacy-config.ts). */
  privacy?: PrivacyConfig;
}

export interface AppSettings {
  signIn?: import('../shared/sign-in.ts').SignInConfig | false;
  branding: BrandingConfig;
  basePath: string;
  /** Per-host bases (`hosts`, `trustForwardedHost`); no entries means one base for every host. */
  hosts: HostRouting;
  retention: RetentionPolicy;
  /** The config's profiles; createRuntime merges the plugins' in. */
  profiles: ProfileCatalog;
  /** @deprecated Use `profiles`; the same catalog. */
  purposes: ProfileCatalog;
  /** Built-in and config views; createRuntime merges the plugins' in. */
  views: ViewCatalog;
  sources: SourceProviders;
  contextSchema?: ContextSchema;
  beta: BetaFlags;
  /** The user-plugin policy (applies when beta.malleable is on). */
  malleable: MalleablePolicy;
  distribution?: HostVersions['distribution'];
  comments: CommentsSettings;
  /** A GitHub OAuth app for Connect GitHub, from the environment; absent means the feature is off. */
  githubConnect?: GithubConnectSettings;
  /** The config file's `redaction` rules, checked (plugins' rules are merged in by the app). */
  redaction?: RedactionRules;
  /** The config file's `privacy` switches, checked; absent means all off. */
  privacy?: PrivacySettings;
  editing: EditingSettings;
}

export const CONFIG_KEYS = new Set([
  'capture',
  'name',
  'logoUrl',
  'theme',
  'integrations',
  'cli',
  'links',
  'basePath',
  'hosts',
  'trustForwardedHost',
  'retentionDays',
  'profiles',
  'purposes',
  'views',
  'contextSchemaFile',
  'githubHost',
  'gitlabHost',
  'sourceProviders',
  'beta',
  'malleable',
  'distribution',
  'comments',
  'editing',
  'auth',
  'signIn',
  'storage',
  'plugins',
  'redaction',
  'privacy',
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
    ...(file.cli ? { cli: file.cli } : {}),
    ...(file.links ? { links: file.links } : {}),
    ...((pick('TRACE_URL_TEMPLATE') ?? file.integrations?.traceUrlTemplate)
      ? { integrations: { traceUrlTemplate: (pick('TRACE_URL_TEMPLATE') ?? file.integrations?.traceUrlTemplate)! } }
      : {}),
  } as Partial<BrandingConfig>);
  const basePath = normalizeBasePath(pick('BASE_PATH') ?? file.basePath);
  if (file.trustForwardedHost !== undefined && typeof file.trustForwardedHost !== 'boolean')
    throw new Error("the config file's trustForwardedHost must be true or false");
  const hosts = normalizeHosts(file.hosts, parseFlag('TRUST_FORWARDED_HOST', env.TRUST_FORWARDED_HOST) ?? file.trustForwardedHost ?? false);
  const expiredDays = daysFromEnv(env, 'RETENTION_EXPIRED_DAYS');
  const retention = {
    ...(pick('RETENTION_DAYS') !== undefined || file.retentionDays === undefined
      ? retentionFromEnv(env)
      : retentionFromEnv({ RETENTION_DAYS: String(file.retentionDays) })),
    ...(expiredDays === undefined ? {} : { expiredDays }),
  };
  const githubHost = pick('GITHUB_HOST') ?? file.githubHost;
  const gitlabHost = pick('GITLAB_HOST') ?? file.gitlabHost;
  for (const host of [githubHost, gitlabHost]) if (host && !HOST.test(host)) throw new Error(`invalid host name ${JSON.stringify(host)}`);
  const sources = new SourceProviders({
    ...(githubHost ? { githubHost } : {}),
    ...(gitlabHost ? { gitlabHost } : {}),
    templates: file.sourceProviders ?? [],
  });
  const profiles = createProfileCatalog({ config: configProfiles(file), env });
  const schemaFile = pick('CONTEXT_SCHEMA_FILE') ?? file.contextSchemaFile;
  // why: the validator pulls in ajv; the capture entry loads this file for its config and never needs it unless a schema is set.
  const contextSchema = schemaFile ? await (await import('./context-schema-loader.ts')).loadSchema(resolve(cwd, schemaFile)) : undefined;
  if (file.redaction !== undefined) assertRedactionRules(file.redaction, 'config redaction');
  const privacy = privacyFromConfig(file.privacy);
  const malleable = parseMalleablePolicy(file.malleable);
  const distribution = parseDistribution(file.distribution);
  // why: `malleable.enabled` and `beta.malleable` are one switch; the environment variable still wins over both.
  const enabled = file.malleable?.enabled;
  const betaFile = file.beta;
  if (enabled !== undefined && betaFile?.malleable !== undefined && betaFile.malleable !== enabled)
    throw new Error("the config file's malleable.enabled and beta.malleable disagree: set one of them");
  const signIn = file.signIn === false ? false : normalizeSignIn(file.signIn);
  const githubConnect = githubConnectFromEnv(env);
  return {
    ...(signIn !== undefined ? { signIn } : {}),
    branding,
    basePath,
    hosts,
    retention: Object.keys(profiles.retentionDays()).length ? { ...retention, profiles: profiles.retentionDays() } : retention,
    profiles,
    purposes: profiles,
    views: createViewCatalog({ config: file.views }),
    sources,
    beta: betaFromEnv(env, enabled === undefined ? betaFile : { ...betaFile, malleable: betaFile?.malleable ?? enabled }),
    malleable,
    ...(distribution ? { distribution } : {}),
    comments: commentsFromEnv(env, file.comments),
    ...(githubConnect ? { githubConnect } : {}),
    editing: editingFromEnv(env, file.editing),
    privacy,
    ...(contextSchema ? { contextSchema } : {}),
    ...(file.redaction ? { redaction: file.redaction } : {}),
  };
}
