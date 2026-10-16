import { isDeepStrictEqual } from 'node:util';

import type { AuthAdapter, AuthPluginFactory } from '../server/auth/types.ts';
import { assertThemeTokens, type ThemeTokens } from '../server/branding.ts';
import type { SourceProvider } from '../shared/source-providers.ts';
import { assertPlugin } from './define.ts';
import { PluginError } from './errors.ts';
import type {
  AfterUploadHook,
  BeforeUploadHook,
  BrandingContribution,
  ClientEntry,
  ContextAdapter,
  PluginApi,
  PrepareUploadHook,
  ReplaysPlugin,
  RequestHook,
  RequestHookOptions,
  ResponseHook,
  StorageBackend,
} from './types.ts';

/** Ids the core owns; a plugin cannot take them. */
export const BUILTIN_AUTH = ['none', 'header', 'oidc', 'plugin'] as const;
export const BUILTIN_STORAGE = ['fs', 's3', 'memory'] as const;

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const BASE = /^\/[A-Za-z0-9._~/-]*$/;

export interface Owned<T> {
  plugin: string;
  value: T;
}

export interface ResolvedClientEntry extends ClientEntry {
  plugin: string;
}

/** Everything the plugins registered, in plugin order. Built once at start by `resolvePlugins`. */
export interface PluginRegistry {
  /** Plugin names in setup order. */
  readonly order: readonly string[];
  readonly auth: ReadonlyMap<string, Owned<AuthPluginFactory>>;
  readonly contextAdapters: readonly Owned<ContextAdapter>[];
  readonly sourceProviders: readonly Owned<SourceProvider>[];
  readonly storage: ReadonlyMap<string, Owned<StorageBackend>>;
  readonly branding: BrandingContribution;
  readonly basePath: string | undefined;
  readonly hooks: {
    readonly preAuth: readonly Owned<RequestHook>[];
    readonly postAuth: readonly Owned<RequestHook>[];
    readonly response: readonly Owned<ResponseHook>[];
    readonly prepareUpload: readonly Owned<PrepareUploadHook>[];
    readonly beforeUpload: readonly Owned<BeforeUploadHook>[];
    readonly afterUpload: readonly Owned<AfterUploadHook>[];
  };
  readonly clientEntries: readonly ResolvedClientEntry[];
}

export const EMPTY_REGISTRY: PluginRegistry = Object.freeze({
  order: [],
  auth: new Map(),
  contextAdapters: [],
  sourceProviders: [],
  storage: new Map(),
  branding: {},
  basePath: undefined,
  hooks: { preAuth: [], postAuth: [], response: [], prepareUpload: [], beforeUpload: [], afterUpload: [] },
  clientEntries: [],
});

/**
 * Plugin order: dependencies first, then by `order`, then by position in the config. Throws on a missing dependency,
 * a duplicate name or a cycle.
 */
export function orderPlugins(plugins: readonly ReplaysPlugin[]): ReplaysPlugin[] {
  const byName = new Map<string, ReplaysPlugin>();
  for (const plugin of plugins) {
    if (byName.has(plugin.name)) throw new PluginError('duplicate-plugin', 'is listed twice', { plugin: plugin.name });
    byName.set(plugin.name, plugin);
  }
  for (const plugin of plugins)
    for (const dependency of plugin.dependsOn ?? [])
      if (!byName.has(dependency))
        throw new PluginError('missing-dependency', `depends on ${JSON.stringify(dependency)}, which is not in the config`, {
          plugin: plugin.name,
        });
  const position = new Map(plugins.map((plugin, index) => [plugin.name, index]));
  const rank = (plugin: ReplaysPlugin) => [plugin.order ?? 0, position.get(plugin.name)!] as const;
  const pending = [...plugins];
  const done = new Set<string>();
  const ordered: ReplaysPlugin[] = [];
  while (pending.length) {
    const ready = pending.filter((plugin) => (plugin.dependsOn ?? []).every((dependency) => done.has(dependency)));
    if (!ready.length)
      throw new PluginError('dependency-cycle', `dependency cycle among ${pending.map((plugin) => plugin.name).join(', ')}`);
    const next = ready.reduce((best, plugin) => {
      const [a, b] = [rank(plugin), rank(best)];
      return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? plugin : best;
    });
    pending.splice(pending.indexOf(next), 1);
    done.add(next.name);
    ordered.push(next);
  }
  return ordered;
}

function mergeScalar(
  merged: Record<string, string>,
  owners: Map<string, string>,
  key: string,
  value: string,
  plugin: string,
  label: string,
) {
  const previous = merged[key];
  if (previous !== undefined && previous !== value)
    throw new PluginError(
      'conflict',
      `sets ${label} to ${JSON.stringify(value)}, but ${owners.get(key)} already set ${JSON.stringify(previous)}`,
      { plugin },
    );
  merged[key] = value;
  owners.set(key, plugin);
}

type ResolveOptions = { env?: NodeJS.ProcessEnv; cwd?: string };

/**
 * The one implementation of resolving: yields each `setup`'s result so a driver can await it (`resolvePlugins`) or insist
 * it is synchronous (`resolvePluginsSync`).
 */
function* collect(plugins: readonly ReplaysPlugin[], options: ResolveOptions): Generator<void | Promise<void>, PluginRegistry> {
  plugins.forEach((plugin, index) => assertPlugin(plugin, `plugins[${index}]`));
  const ordered = orderPlugins(plugins);

  const auth = new Map<string, Owned<AuthPluginFactory>>();
  const contextAdapters: Owned<ContextAdapter>[] = [];
  const sourceProviders: Owned<SourceProvider>[] = [];
  const storage = new Map<string, Owned<StorageBackend>>();
  const hooks = {
    preAuth: [] as Owned<RequestHook>[],
    postAuth: [] as Owned<RequestHook>[],
    response: [] as Owned<ResponseHook>[],
    prepareUpload: [] as Owned<PrepareUploadHook>[],
    beforeUpload: [] as Owned<BeforeUploadHook>[],
    afterUpload: [] as Owned<AfterUploadHook>[],
  };
  const clientEntries: ResolvedClientEntry[] = [];
  const brandScalars: Record<string, string> = {};
  const brandOwners = new Map<string, string>();
  const theme = { dark: {} as Record<string, string>, light: {} as Record<string, string> };
  const themeOwners = { dark: new Map<string, string>(), light: new Map<string, string>() };
  let basePath: { value: string; plugin: string } | undefined;

  for (const plugin of ordered) {
    function fail(message: string, code: 'invalid-registration' | 'conflict' = 'invalid-registration'): never {
      throw new PluginError(code, message, { plugin: plugin.name });
    }
    function needFunction(value: unknown, what: string) {
      if (typeof value !== 'function') fail(`${what} must be a function`);
    }
    const api: PluginApi = {
      pluginName: plugin.name,
      env: options.env ?? process.env,
      cwd: options.cwd ?? process.cwd(),
      auth(registration) {
        const adapter = registration as Partial<AuthAdapter> & { create?: AuthPluginFactory };
        const factory = adapter?.create;
        const name = adapter?.name;
        if (typeof name !== 'string' || (typeof factory !== 'function' && typeof adapter.authenticate !== 'function'))
          fail('auth needs an adapter { name, authenticate() } or { name, create(env) }');
        if (!ID.test(name)) fail(`auth adapter names look like "iap-header" (got ${JSON.stringify(name)})`);
        if ((BUILTIN_AUTH as readonly string[]).includes(name)) fail(`auth adapter name ${JSON.stringify(name)} is built in`, 'conflict');
        const taken = auth.get(name);
        if (taken) fail(`auth adapter ${JSON.stringify(name)} is already registered by ${taken.plugin}`, 'conflict');
        auth.set(name, { plugin: plugin.name, value: factory ?? (() => registration as AuthAdapter) });
      },
      contextAdapter(adapter) {
        if (!adapter || typeof adapter.name !== 'string' || !ID.test(adapter.name)) fail('contextAdapter needs a name like "build-info"');
        if (adapter.normalize !== undefined) needFunction(adapter.normalize, 'contextAdapter.normalize');
        if (adapter.schema && (adapter.schema.type !== 'object' || typeof adapter.schema !== 'object'))
          fail(`contextAdapter ${adapter.name}: schema must be a JSON Schema with "type": "object"`);
        const taken = contextAdapters.find((entry) => entry.value.name === adapter.name);
        if (taken) fail(`context adapter ${JSON.stringify(adapter.name)} is already registered by ${taken.plugin}`, 'conflict');
        if (adapter.schema?.properties) {
          for (const [key, definition] of Object.entries(adapter.schema.properties)) {
            for (const other of contextAdapters) {
              const existing = other.value.schema?.properties?.[key];
              if (existing !== undefined && !isDeepStrictEqual(existing, definition))
                fail(
                  `context field ${JSON.stringify(key)} is defined differently by ${other.plugin} (${other.value.name}) and ${adapter.name}`,
                  'conflict',
                );
            }
          }
        }
        contextAdapters.push({ plugin: plugin.name, value: adapter });
      },
      sourceProvider(provider) {
        if (!provider || typeof provider.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(provider.id))
          fail('sourceProvider needs an id like "jira"');
        needFunction(provider.resolve, 'sourceProvider.resolve');
        if (['github', 'gitlab', 'url'].includes(provider.id))
          fail(`source provider ${JSON.stringify(provider.id)} is built in`, 'conflict');
        const taken = sourceProviders.find((entry) => entry.value.id === provider.id);
        if (taken) fail(`source provider ${JSON.stringify(provider.id)} is already registered by ${taken.plugin}`, 'conflict');
        sourceProviders.push({ plugin: plugin.name, value: provider });
      },
      storage(backend) {
        if (!backend || typeof backend.id !== 'string' || !ID.test(backend.id)) fail('storage needs an id like "gcs"');
        needFunction(backend.create, 'storage.create');
        if ((BUILTIN_STORAGE as readonly string[]).includes(backend.id))
          fail(`storage id ${JSON.stringify(backend.id)} is built in`, 'conflict');
        const taken = storage.get(backend.id);
        if (taken) fail(`storage backend ${JSON.stringify(backend.id)} is already registered by ${taken.plugin}`, 'conflict');
        storage.set(backend.id, { plugin: plugin.name, value: backend });
      },
      branding(contribution) {
        if (!contribution || typeof contribution !== 'object') fail('branding needs an object');
        for (const key of ['name', 'logoUrl'] as const) {
          const value = contribution[key];
          if (value === undefined) continue;
          if (typeof value !== 'string' || !value.trim()) fail(`branding.${key} must be a non-empty string`);
          mergeScalar(brandScalars, brandOwners, key, value.trim(), plugin.name, `branding.${key}`);
        }
        for (const scheme of ['dark', 'light'] as const) {
          const tokens = contribution.theme?.[scheme];
          if (!tokens) continue;
          try {
            assertThemeTokens(tokens, `branding.theme.${scheme}`);
          } catch (error) {
            fail((error as Error).message);
          }
          for (const [token, value] of Object.entries(tokens as ThemeTokens))
            mergeScalar(theme[scheme], themeOwners[scheme], token, value, plugin.name, `theme.${scheme}.${token}`);
        }
      },
      basePath(path) {
        if (typeof path !== 'string' || (path !== '/' && (!BASE.test(path) || path.includes('//') || /(^|\/)\.\.?(\/|$)/.test(path))))
          fail(`basePath must be "/" or an absolute path like "/replays" (got ${JSON.stringify(path)})`);
        const normalized = path === '/' ? '' : path.replace(/\/+$/, '');
        if (basePath && basePath.value !== normalized)
          fail(
            `sets basePath ${JSON.stringify(normalized || '/')}, but ${basePath.plugin} already set ${JSON.stringify(basePath.value || '/')}`,
            'conflict',
          );
        basePath = { value: normalized, plugin: plugin.name };
      },
      onRequest(hook: RequestHook, hookOptions: RequestHookOptions = {}) {
        needFunction(hook, 'onRequest hook');
        const phase = hookOptions.phase ?? 'post-auth';
        if (phase !== 'pre-auth' && phase !== 'post-auth') fail(`onRequest phase must be "pre-auth" or "post-auth"`);
        (phase === 'pre-auth' ? hooks.preAuth : hooks.postAuth).push({ plugin: plugin.name, value: hook });
      },
      onResponse(hook) {
        needFunction(hook, 'onResponse hook');
        hooks.response.push({ plugin: plugin.name, value: hook });
      },
      prepareUpload(hook) {
        needFunction(hook, 'prepareUpload hook');
        hooks.prepareUpload.push({ plugin: plugin.name, value: hook });
      },
      beforeUpload(hook) {
        needFunction(hook, 'beforeUpload hook');
        hooks.beforeUpload.push({ plugin: plugin.name, value: hook });
      },
      afterUpload(hook) {
        needFunction(hook, 'afterUpload hook');
        hooks.afterUpload.push({ plugin: plugin.name, value: hook });
      },
      client(entry) {
        if (!entry || typeof entry.id !== 'string' || !ID.test(entry.id)) fail('client entry needs an id like "main"');
        for (const key of ['script', 'style'] as const) {
          const value = entry[key];
          if (value === undefined) continue;
          if (typeof value !== 'string' || !(value.startsWith('https://') || /^(\/|[A-Za-z]:[\\/])/.test(value)))
            fail(`client ${entry.id}: ${key} must be an absolute file path or an https URL (got ${JSON.stringify(value)})`);
        }
        if (typeof entry.script !== 'string') fail(`client ${entry.id}: script is required`);
        if (clientEntries.some((existing) => existing.plugin === plugin.name && existing.id === entry.id))
          fail(`client entry ${JSON.stringify(entry.id)} is registered twice`, 'conflict');
        clientEntries.push({ ...entry, plugin: plugin.name });
      },
    };
    try {
      yield plugin.setup(api);
    } catch (error) {
      if (error instanceof PluginError) throw error;
      throw new PluginError('setup-failed', `setup failed: ${error instanceof Error ? error.message : String(error)}`, {
        plugin: plugin.name,
        cause: error,
      });
    }
  }

  const branding: BrandingContribution = { ...brandScalars };
  const themeOut: NonNullable<BrandingContribution['theme']> = {};
  for (const scheme of ['dark', 'light'] as const) if (Object.keys(theme[scheme]).length) themeOut[scheme] = theme[scheme] as ThemeTokens;
  if (themeOut.dark || themeOut.light) branding.theme = themeOut;

  return {
    order: ordered.map((plugin) => plugin.name),
    auth,
    contextAdapters,
    sourceProviders,
    storage,
    branding,
    basePath: basePath?.value,
    hooks,
    clientEntries,
  };
}

/**
 * Runs every plugin's `setup` (in order) and collects what they registered. Registrations are validated as they
 * are made; conflicts between plugins (the same id, the same branding field with different values) throw a
 * `PluginError` naming both sides.
 */
export async function resolvePlugins(plugins: readonly ReplaysPlugin[], options: ResolveOptions = {}): Promise<PluginRegistry> {
  const run = collect(plugins, options);
  let step = run.next();
  while (!step.done) {
    try {
      await step.value;
    } catch (error) {
      step = run.throw(error);
      continue;
    }
    step = run.next();
  }
  return step.value;
}

/** Like `resolvePlugins` for plugins whose `setup` is synchronous (the built-in ones); an async `setup` is an error. */
export function resolvePluginsSync(plugins: readonly ReplaysPlugin[], options: ResolveOptions = {}): PluginRegistry {
  const run = collect(plugins, options);
  let step = run.next();
  while (!step.done) {
    if (step.value) throw new PluginError('setup-failed', 'an asynchronous setup cannot be used here');
    step = run.next();
  }
  return step.value;
}

function union<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>, what: string) {
  for (const key of a.keys()) if (b.has(key)) throw new PluginError('conflict', `${what} ${JSON.stringify(key)} is registered twice`);
  return new Map([...a, ...b]);
}

/**
 * One registry from two: `first`'s plugins are set up and their hooks run before `second`'s. The built-in plugins are
 * merged under the user's, so the user's branding and base path win. Names that appear in both are a conflict.
 */
export function mergeRegistries(first: PluginRegistry, second: PluginRegistry): PluginRegistry {
  const clash = first.order.find((name) => second.order.includes(name));
  if (clash) throw new PluginError('duplicate-plugin', 'is listed twice', { plugin: clash });
  return {
    order: [...first.order, ...second.order],
    auth: union(first.auth, second.auth, 'auth adapter'),
    contextAdapters: [...first.contextAdapters, ...second.contextAdapters],
    sourceProviders: [...first.sourceProviders, ...second.sourceProviders],
    storage: union(first.storage, second.storage, 'storage backend'),
    branding: { ...first.branding, ...second.branding },
    basePath: second.basePath ?? first.basePath,
    hooks: {
      preAuth: [...first.hooks.preAuth, ...second.hooks.preAuth],
      postAuth: [...first.hooks.postAuth, ...second.hooks.postAuth],
      response: [...first.hooks.response, ...second.hooks.response],
      prepareUpload: [...first.hooks.prepareUpload, ...second.hooks.prepareUpload],
      beforeUpload: [...first.hooks.beforeUpload, ...second.hooks.beforeUpload],
      afterUpload: [...first.hooks.afterUpload, ...second.hooks.afterUpload],
    },
    clientEntries: [...first.clientEntries, ...second.clientEntries],
  };
}
