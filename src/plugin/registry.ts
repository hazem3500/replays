import { isDeepStrictEqual } from 'node:util';

import type { AnyAuthAdapter, AuthAdapter, AuthPluginFactory, WebAuthAdapter } from '../server/auth/types.ts';
import { assertRedactionRules, mergeRedactionRules, type RedactionRules } from '../shared/redaction.ts';
import { assertProfileConfig } from '../shared/profiles.ts';
import { assertViewPreset, BUILT_IN_VIEWS, type ViewPreset } from '../shared/views.ts';
import type { SourceProvider } from '../shared/source-providers.ts';
import { BrandingCollector } from './branding-collector.ts';
import { assertPlugin } from './define.ts';
import { orderPlugins } from './order.ts';
import {
  checkClientEntry,
  checkContextAdapter,
  checkedBasePath,
  checkIndexFilter,
  checkPeople,
  checkRender,
  checkSourceProvider,
  checkSummaryFields,
  errorMessage,
  needFunction as checkFunction,
  PLUGIN_ID,
} from './registration-checks.ts';
import type { Owned, PluginRegistry, ResolvedClientEntry } from './registry-types.ts';
import { PluginError } from './errors.ts';
import { PACKAGE_VERSION, satisfies } from './version.ts';
import { validateRequestPolicy, validateUploadEndpoint, assertDistinctPolicies } from './request-policy.ts';
import { assertDistinctRoute, validateMiddleware, validateRoute, WebRegistrationError } from './web-registry.ts';
import type { PluginMiddleware, PluginRoute } from './web-types.ts';
import type {
  AfterUploadHook,
  BeforeUploadHook,
  ContextAdapter,
  IndexFilterDefinition,
  IdentityResolver,
  PeopleOptions,
  PluginApi,
  NormalizeUploadHook,
  PrepareUploadHook,
  ProfileDefinition,
  RenderHooks,
  ReplaysPlugin,
  RequestHook,
  RequestHookOptions,
  RequestPolicy,
  UploadEndpoint,
  ResponseHook,
  RetentionRuleDefinition,
  StorageBackend,
  SummaryFieldsDefinition,
} from './types.ts';

/** Ids the core owns; a plugin cannot take them. */
export const BUILTIN_AUTH = ['none', 'header', 'oidc', 'plugin'] as const;
export const BUILTIN_STORAGE = ['fs', 's3', 'memory'] as const;

const ID = PLUGIN_ID;

export { INDEX_FILTER_PARAM } from './registration-checks.ts';
export { mergeRegistries } from './registry-merge.ts';
export { EMPTY_REGISTRY, type Owned, type PluginRegistry, type ResolvedClientEntry } from './registry-types.ts';
export { orderPlugins } from './order.ts';

type ResolveOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** What `requires` ranges are checked against; default the installed package's version. For tests. */
  packageVersion?: string;
};

/**
 * The one implementation of resolving: yields each `setup`'s result so a driver can await it (`resolvePlugins`) or insist
 * it is synchronous (`resolvePluginsSync`).
 */
function* collect(plugins: readonly ReplaysPlugin[], options: ResolveOptions): Generator<void | Promise<void>, PluginRegistry> {
  plugins.forEach((plugin, index) => assertPlugin(plugin, `plugins[${index}]`));
  const version = options.packageVersion ?? PACKAGE_VERSION;
  for (const plugin of plugins)
    if (plugin.requires !== undefined && !satisfies(version, plugin.requires))
      throw new PluginError('version-range', `needs @hazem3500/replays ${plugin.requires}, this is ${version}`, { plugin: plugin.name });
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
    normalizeUpload: [] as Owned<NormalizeUploadHook>[],
    beforeUpload: [] as Owned<BeforeUploadHook>[],
    afterUpload: [] as Owned<AfterUploadHook>[],
    webPreAuth: [] as Owned<PluginMiddleware>[],
    webPostAuth: [] as Owned<PluginMiddleware>[],
  };
  const routes: Owned<PluginRoute<unknown>>[] = [];
  const requestPolicies: Owned<RequestPolicy>[] = [];
  const uploadEndpoints = new Map<string, Owned<UploadEndpoint>>();
  const clientEntries: ResolvedClientEntry[] = [];
  const profiles: Owned<ProfileDefinition>[] = [];
  const views: Owned<ViewPreset>[] = [];
  const retention: Owned<RetentionRuleDefinition>[] = [];
  const render: Owned<RenderHooks>[] = [];
  const summaryFields: Owned<SummaryFieldsDefinition>[] = [];
  const indexFilters: Owned<IndexFilterDefinition>[] = [];
  let people: Owned<PeopleOptions> | undefined;
  const identityResolvers: Owned<IdentityResolver>[] = [];
  const brandingCollector = new BrandingCollector();
  let basePath: { value: string; plugin: string } | undefined;
  const redaction: RedactionRules[] = [];

  for (const plugin of ordered) {
    function fail(message: string, code: 'invalid-registration' | 'conflict' = 'invalid-registration'): never {
      throw new PluginError(code, message, { plugin: plugin.name });
    }
    function web<T>(check: () => T): T {
      try {
        return check();
      } catch (error) {
        if (error instanceof WebRegistrationError) fail(error.message, error.code);
        throw error;
      }
    }
    const needFunction = (value: unknown, what: string) => checkFunction(value, what, fail);
    let warnedPurpose = false;
    const legacy = {
      purpose(definition: ProfileDefinition) {
        if (!warnedPurpose) {
          warnedPurpose = true;
          console.warn(`plugin ${plugin.name}: api.purpose is deprecated; call api.profile with the same definition`);
        }
        addProfile(definition);
      },
    };
    function addProfile(definition: ProfileDefinition) {
      try {
        assertProfileConfig(definition, 'profile', ['infer']);
      } catch (error) {
        fail(errorMessage(error));
      }
      if (definition.infer !== undefined) needFunction(definition.infer, `profile ${definition.id}: infer`);
      const taken = profiles.find((entry) => entry.value.id === definition.id);
      if (taken) fail(`profile ${JSON.stringify(definition.id)} is already registered by ${taken.plugin}`, 'conflict');
      profiles.push({ plugin: plugin.name, value: definition });
    }
    const api: PluginApi = {
      ...legacy,
      pluginName: plugin.name,
      env: options.env ?? process.env,
      cwd: options.cwd ?? process.cwd(),
      auth(registration) {
        const adapter = registration as Partial<AuthAdapter & WebAuthAdapter> & { create?: AuthPluginFactory };
        const factory = adapter?.create;
        const name = adapter?.name;
        if (
          typeof name !== 'string' ||
          (typeof factory !== 'function' && typeof adapter.authenticate !== 'function' && typeof adapter.authenticateRequest !== 'function')
        )
          fail('auth needs an adapter { name, authenticate() }, a web adapter { name, authenticateRequest() } or { name, create(env) }');
        if (!ID.test(name)) fail(`auth adapter names look like "iap-header" (got ${JSON.stringify(name)})`);
        if ((BUILTIN_AUTH as readonly string[]).includes(name)) fail(`auth adapter name ${JSON.stringify(name)} is built in`, 'conflict');
        const taken = auth.get(name);
        if (taken) fail(`auth adapter ${JSON.stringify(name)} is already registered by ${taken.plugin}`, 'conflict');
        auth.set(name, { plugin: plugin.name, value: factory ?? (() => registration as AnyAuthAdapter) });
      },
      contextAdapter(adapter) {
        checkContextAdapter(adapter, fail);
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
        checkSourceProvider(provider, fail);
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
        brandingCollector.add(contribution, plugin.name, fail);
      },
      basePath(path) {
        const normalized = checkedBasePath(path, fail);
        if (basePath && basePath.value !== normalized)
          fail(
            `sets basePath ${JSON.stringify(normalized || '/')}, but ${basePath.plugin} already set ${JSON.stringify(basePath.value || '/')}`,
            'conflict',
          );
        basePath = { value: normalized, plugin: plugin.name };
      },
      requestPolicy(policy) {
        const value = validateRequestPolicy(policy);
        assertDistinctPolicies(requestPolicies, [{ plugin: plugin.name, value }]);
        requestPolicies.push({ plugin: plugin.name, value });
      },
      uploadEndpoint(endpoint) {
        const value = validateUploadEndpoint(endpoint);
        const taken = uploadEndpoints.get(value.path);
        if (taken) fail(`upload endpoint ${value.path} is already registered by ${taken.plugin}`, 'conflict');
        uploadEndpoints.set(value.path, { plugin: plugin.name, value });
      },
      onRequest(hook: RequestHook, hookOptions: RequestHookOptions = {}) {
        needFunction(hook, 'onRequest hook');
        const phase = hookOptions.phase ?? 'post-auth';
        if (phase !== 'pre-auth' && phase !== 'post-auth') fail(`onRequest phase must be "pre-auth" or "post-auth"`);
        (phase === 'pre-auth' ? hooks.preAuth : hooks.postAuth).push({ plugin: plugin.name, value: hook });
      },
      middleware(middleware) {
        const value = web(() => validateMiddleware(middleware));
        (value.phase === 'pre-auth' ? hooks.webPreAuth : hooks.webPostAuth).push({ plugin: plugin.name, value });
      },
      route(route) {
        const value = web(() => validateRoute(route as PluginRoute<unknown>, plugin.name));
        web(() =>
          assertDistinctRoute(
            routes.filter((owned) => owned.plugin === plugin.name).map((owned) => owned.value),
            value,
          ),
        );
        routes.push({ plugin: plugin.name, value });
      },
      onResponse(hook) {
        needFunction(hook, 'onResponse hook');
        hooks.response.push({ plugin: plugin.name, value: hook });
      },
      prepareUpload(hook) {
        needFunction(hook, 'prepareUpload hook');
        hooks.prepareUpload.push({ plugin: plugin.name, value: hook });
      },
      normalizeUpload(hook) {
        needFunction(hook, 'normalizeUpload hook');
        hooks.normalizeUpload.push({ plugin: plugin.name, value: hook });
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
        checkClientEntry(entry, fail);
        if (clientEntries.some((existing) => existing.plugin === plugin.name && existing.id === entry.id))
          fail(`client entry ${JSON.stringify(entry.id)} is registered twice`, 'conflict');
        clientEntries.push({ ...entry, plugin: plugin.name });
      },
      redaction(rules) {
        try {
          assertRedactionRules(rules);
        } catch (error) {
          fail(errorMessage(error));
        }
        redaction.push(rules);
      },
      profile(definition) {
        addProfile(definition);
      },
      view(preset) {
        try {
          assertViewPreset(preset, 'view');
        } catch (error) {
          fail(errorMessage(error));
        }
        if (BUILT_IN_VIEWS.some((view) => view.id === preset.id))
          fail(`view ${JSON.stringify(preset.id)} is built in; retune it with a views entry in the config file`, 'conflict');
        const taken = views.find((entry) => entry.value.id === preset.id);
        if (taken) fail(`view ${JSON.stringify(preset.id)} is already registered by ${taken.plugin}`, 'conflict');
        views.push({ plugin: plugin.name, value: preset });
      },
      retention(rule) {
        if (!rule || typeof rule !== 'object') fail('retention needs { days(summary) }');
        needFunction(rule.days, 'retention.days');
        retention.push({ plugin: plugin.name, value: rule });
      },
      render(definition) {
        checkRender(definition, fail);
        render.push({ plugin: plugin.name, value: definition });
      },
      summaryFields(definition) {
        checkSummaryFields(definition, fail);
        if (summaryFields.some((entry) => entry.plugin === plugin.name && entry.value.name === definition.name))
          fail(`summaryFields ${JSON.stringify(definition.name)} is registered twice`, 'conflict');
        summaryFields.push({ plugin: plugin.name, value: definition });
      },
      indexFilter(definition) {
        checkIndexFilter(definition, fail);
        if (indexFilters.some((entry) => entry.plugin === plugin.name && entry.value.id === definition.id))
          fail(`indexFilter ${JSON.stringify(definition.id)} is registered twice`, 'conflict');
        const taken = indexFilters.find((entry) => entry.value.param === definition.param);
        if (taken) fail(`index filter param ${JSON.stringify(definition.param)} is already registered by ${taken.plugin}`, 'conflict');
        indexFilters.push({ plugin: plugin.name, value: definition });
      },
      people(config) {
        if (!config || typeof config !== 'object') fail('people needs an object');
        if (people) fail(`people is already registered by ${people.plugin}; a deployment has one`, 'conflict');
        checkPeople(config, fail);
        people = { plugin: plugin.name, value: config };
      },
      identity(resolver) {
        if (!resolver || typeof resolver !== 'object') fail('identity needs { resolve(identity, { request }) }');
        needFunction(resolver.resolve, 'identity.resolve');
        identityResolvers.push({ plugin: plugin.name, value: resolver });
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

  const branding = brandingCollector.result();

  return {
    order: ordered.map((plugin) => plugin.name),
    auth,
    contextAdapters,
    sourceProviders,
    storage,
    branding,
    requestPolicies,
    uploadEndpoints,
    basePath: basePath?.value,
    redaction: mergeRedactionRules(...redaction),
    hooks,
    routes,
    clientEntries,
    profiles,
    views,
    retention,
    render,
    summaryFields,
    indexFilters,
    people,
    identityResolvers,
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
