import { isDeepStrictEqual } from 'node:util';

import { type LoadedConfig, loadConfig } from '../config/index.ts';
import { PluginError } from '../plugin/errors.ts';
import { type PluginRegistry, resolvePlugins } from '../plugin/registry.ts';
import type { ReplaysPlugin } from '../plugin/types.ts';
import { type AppSettings, type FileConfig, loadSettings } from './config.ts';
import { authFromEnv } from './auth/index.ts';
import type { AnyAuthAdapter, AuthAdapter } from './auth/types.ts';
import { toNodeAuthAdapter } from './auth/web.ts';
import { type ContextSchema, compileContextSchema } from './context-schema.ts';
import { configProfiles, createProfileCatalog, wrapRetentionRules } from './profiles.ts';
import { createViewCatalog } from './views.ts';
import { storageFromEnv } from './storage/index.ts';
import type { ObjectStorage } from './storage/types.ts';

export interface Runtime {
  settings: AppSettings;
  registry: PluginRegistry;
  config: LoadedConfig;
  auth: AuthAdapter;
}

const BUILTIN_AUTH_MODES = ['none', 'header', 'oidc', 'plugin'];

/** Plugin contributions as config-file values, under what the file itself says (the file wins, token by token). */
const warnLine = (line: string) => console.warn(line);

function withPluginDefaults(file: FileConfig, registry: PluginRegistry): FileConfig {
  const { branding } = registry;
  const theme = { ...branding.theme, ...file.theme };
  for (const scheme of ['dark', 'light'] as const) {
    const merged = { ...branding.theme?.[scheme], ...file.theme?.[scheme] };
    if (Object.keys(merged).length) theme[scheme] = merged;
  }
  return {
    ...(branding.name ? { name: branding.name } : {}),
    ...(branding.logoUrl ? { logoUrl: branding.logoUrl } : {}),
    ...(registry.basePath !== undefined ? { basePath: registry.basePath } : {}),
    ...Object.fromEntries(Object.entries(file).filter(([, value]) => value !== undefined)),
    ...(Object.keys(theme).length ? { theme } : {}),
  };
}

/** The deployment's schema plus the fields the context adapters own. Redefining a field differently is a conflict. */
export function mergeContextSchemas(base: ContextSchema | undefined, registry: PluginRegistry): ContextSchema | undefined {
  const adapters = registry.contextAdapters.filter((adapter) => adapter.value.schema);
  if (!adapters.length) return base;
  const schema: Record<string, unknown> & { properties: Record<string, unknown>; required: string[] } = {
    ...base?.schema,
    type: 'object',
    properties: { ...(base?.schema.properties as Record<string, unknown> | undefined) },
    required: [...((base?.schema.required as string[] | undefined) ?? [])],
  };
  for (const adapter of adapters) {
    for (const [key, definition] of Object.entries(adapter.value.schema!.properties ?? {})) {
      if (key in schema.properties && !isDeepStrictEqual(schema.properties[key], definition))
        throw new PluginError(
          'conflict',
          `context field ${JSON.stringify(key)} is defined by the context schema file and by adapter ${adapter.value.name}`,
          {
            plugin: adapter.plugin,
          },
        );
      schema.properties[key] = definition;
    }
    for (const key of adapter.value.schema!.required ?? []) if (!schema.required.includes(key)) schema.required.push(key);
  }
  if (!schema.required.length) delete (schema as { required?: string[] }).required;
  return compileContextSchema(schema);
}

async function chooseAuth(env: NodeJS.ProcessEnv, file: FileConfig, registry: PluginRegistry): Promise<AuthAdapter> {
  return toNodeAuthAdapter(await chooseAnyAuth(env, file, registry));
}

async function chooseAnyAuth(env: NodeJS.ProcessEnv, file: FileConfig, registry: PluginRegistry): Promise<AnyAuthAdapter> {
  const requested = env.AUTH_MODE?.trim().toLowerCase() || file.auth?.trim().toLowerCase() || undefined;
  const names = [...registry.auth.keys()];
  if (requested && registry.auth.has(requested)) return await registry.auth.get(requested)!.value(env);
  if (requested && !BUILTIN_AUTH_MODES.includes(requested))
    throw new Error(
      `auth ${JSON.stringify(requested)} is neither built in (${BUILTIN_AUTH_MODES.join(', ')}) nor registered by a plugin (${names.join(', ') || 'none'})`,
    );
  if (!requested && names.length === 1) return await registry.auth.get(names[0]!)!.value(env);
  if (!requested && names.length > 1)
    throw new PluginError(
      'conflict',
      `several plugins registered an auth adapter (${names.join(', ')}); choose one with AUTH_MODE or "auth" in the config`,
    );
  return authFromEnv(requested ? { ...env, AUTH_MODE: requested } : env);
}

async function chooseStorage(env: NodeJS.ProcessEnv, file: FileConfig, registry: PluginRegistry, dataDir: string): Promise<ObjectStorage> {
  const requested = env.STORAGE?.trim().toLowerCase() || file.storage?.trim().toLowerCase() || undefined;
  const backend = requested ? registry.storage.get(requested) : undefined;
  if (backend) return await backend.value.create({ env, dataDir });
  return storageFromEnv(requested ? { ...env, STORAGE: requested } : env, dataDir);
}

export interface RuntimeOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Skip discovery and use this config (tests, programmatic starts). */
  config?: LoadedConfig;
  /** Plugins in addition to the config's. */
  plugins?: readonly ReplaysPlugin[];
}

/**
 * Config file + environment + plugins, merged into the settings, without choosing auth or storage (so it needs none of
 * their secrets): what `replays build-static` stamps into index.html, and the first half of `createRuntime`.
 */
export async function resolveSettings(options: RuntimeOptions): Promise<Omit<Runtime, 'auth'>> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? (await loadConfig({ env, cwd }));
  const registry = await resolvePlugins([...config.plugins, ...(options.plugins ?? [])], { env, cwd });
  const file = withPluginDefaults(config.file, registry);
  const settings = await loadSettings(env, file, cwd);
  for (const provider of registry.sourceProviders) {
    if (settings.sources.ids.includes(provider.value.id))
      throw new PluginError('conflict', `source provider ${JSON.stringify(provider.value.id)} is already defined by the config`, {
        plugin: provider.plugin,
      });
    settings.sources.register(provider.value);
  }
  // Profiles: the config's merged with the plugins' (src/server/profiles.ts); their windows and the plugins' rules join retention.
  const profiles = createProfileCatalog({ config: configProfiles(file, warnLine), plugins: registry.profiles, env, log: warnLine });
  Object.assign(settings, { profiles, purposes: profiles });
  settings.views = createViewCatalog({ config: file.views, plugins: registry.views, profiles: profiles.list });
  settings.retention = {
    ...settings.retention,
    ...(Object.keys(profiles.retentionDays()).length ? { profiles: profiles.retentionDays() } : {}),
    ...(registry.retention.length ? { rules: wrapRetentionRules(registry.retention) } : {}),
  };
  const contextSchema = mergeContextSchemas(settings.contextSchema, registry);
  if (contextSchema) settings.contextSchema = contextSchema;
  return { settings, registry, config };
}

/**
 * Everything the server needs besides the data and the sockets: config file + environment + plugins, merged.
 * Precedence for a setting: environment, then the config file, then plugins, then the built-in default.
 */
export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const env = options.env ?? process.env;
  const resolved = await resolveSettings(options);
  const auth = await chooseAuth(env, resolved.config.file, resolved.registry);
  return { ...resolved, auth };
}

export { chooseStorage };
