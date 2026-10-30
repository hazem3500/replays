import type { AuthPluginFactory } from '../server/auth/types.ts';
import type { RedactionRules } from '../shared/redaction.ts';
import type { SourceProvider } from '../shared/source-providers.ts';
import type { ViewPreset } from '../shared/views.ts';
import type { PluginMiddleware, PluginRoute } from './web-types.ts';
import type {
  AfterUploadHook,
  BeforeUploadHook,
  BrandingContribution,
  ClientEntry,
  ContextAdapter,
  IdentityResolver,
  IndexFilterDefinition,
  NormalizeUploadHook,
  PeopleOptions,
  PrepareUploadHook,
  ProfileDefinition,
  RenderHooks,
  RequestHook,
  RequestPolicy,
  ResponseHook,
  RetentionRuleDefinition,
  StorageBackend,
  SummaryFieldsDefinition,
  UploadEndpoint,
} from './types.ts';

/** A registration and the plugin that made it. */
export interface Owned<T> {
  plugin: string;
  value: T;
}

/** A client entry with the plugin that registered it. */
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
  readonly requestPolicies: readonly Owned<RequestPolicy>[];
  readonly uploadEndpoints: ReadonlyMap<string, Owned<UploadEndpoint>>;
  readonly branding: BrandingContribution;
  readonly basePath: string | undefined;
  /** Every plugin's `api.redaction` rules, merged (they only add). */
  readonly redaction: RedactionRules;
  readonly hooks: {
    readonly preAuth: readonly Owned<RequestHook>[];
    readonly postAuth: readonly Owned<RequestHook>[];
    readonly response: readonly Owned<ResponseHook>[];
    readonly prepareUpload: readonly Owned<PrepareUploadHook>[];
    readonly normalizeUpload: readonly Owned<NormalizeUploadHook>[];
    readonly beforeUpload: readonly Owned<BeforeUploadHook>[];
    readonly afterUpload: readonly Owned<AfterUploadHook>[];
    /** `api.middleware`, by phase, in plugin order. */
    readonly webPreAuth: readonly Owned<PluginMiddleware>[];
    readonly webPostAuth: readonly Owned<PluginMiddleware>[];
  };
  /** `api.route`, in plugin order. */
  readonly routes: readonly Owned<PluginRoute<unknown>>[];
  readonly clientEntries: readonly ResolvedClientEntry[];
  /** `api.profile`, in registration order (src/server/profiles.ts merges them with the config's). */
  readonly profiles: readonly Owned<ProfileDefinition>[];
  /** `api.view`, in registration order (src/server/views.ts merges them with the built-ins and the config's). */
  readonly views: readonly Owned<ViewPreset>[];
  /** `api.retention` rules. */
  readonly retention: readonly Owned<RetentionRuleDefinition>[];
  /** `api.render` hooks, in plugin order (src/server/render-hooks.ts runs them). */
  readonly render: readonly Owned<RenderHooks>[];
  readonly summaryFields: readonly Owned<SummaryFieldsDefinition>[];
  readonly indexFilters: readonly Owned<IndexFilterDefinition>[];
  /** `api.people`: at most one per deployment. */
  readonly people: Owned<PeopleOptions> | undefined;
  readonly identityResolvers: readonly Owned<IdentityResolver>[];
}

/** What a deployment without plugins registers. */
export const EMPTY_REGISTRY: PluginRegistry = Object.freeze({
  order: [],
  auth: new Map(),
  contextAdapters: [],
  sourceProviders: [],
  storage: new Map(),
  requestPolicies: [],
  uploadEndpoints: new Map(),
  branding: {},
  basePath: undefined,
  redaction: {},
  hooks: {
    preAuth: [],
    postAuth: [],
    response: [],
    prepareUpload: [],
    normalizeUpload: [],
    beforeUpload: [],
    afterUpload: [],
    webPreAuth: [],
    webPostAuth: [],
  },
  routes: [],
  clientEntries: [],
  profiles: [],
  views: [],
  retention: [],
  render: [],
  summaryFields: [],
  indexFilters: [],
  people: undefined,
  identityResolvers: [],
});
