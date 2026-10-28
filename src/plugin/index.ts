/** `@hazem3500/replays/plugin`: declare server plugins. See docs/extension-api.md. */
export { definePlugin, assertPlugin } from './define.ts';
export { PluginError, rejectUpload, type PluginErrorCode } from './errors.ts';
export { HttpError, tooManyRequests } from '../shared/http-error.ts';
export { mergeRegistries, orderPlugins, resolvePlugins, resolvePluginsSync, type PluginRegistry } from './registry.ts';
export { PLUGIN_API_VERSION } from './types.ts';
export { SUMMARY_FIELD_LIMITS } from '../server/summary-fields.ts';
export type {
  PluginMiddleware,
  PluginMiddlewareContext,
  PluginRoute,
  PluginRouteContext,
  PluginRouteMethod,
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
} from './web-types.ts';
export type {
  AfterUploadContext,
  AfterUploadHook,
  AuthRegistration,
  BeforeUploadHook,
  BrandingContribution,
  ClientEntry,
  ContextAdapter,
  ContextFieldsSchema,
  ContextInfo,
  IdentityCapabilities,
  IndexFilterDefinition,
  IdentityResolver,
  PeopleOptions,
  NormalizeUploadContext,
  NormalizeUploadHook,
  PersonHandle,
  PluginApi,
  PluginSpec,
  PrepareUploadContext,
  PrepareUploadHook,
  PurposeDefinition,
  PurposeInferInput,
  RateLimitDecision,
  RenderedFile,
  RenderHooks,
  RenderJob,
  RenderJobOptions,
  RenderKind,
  ReplaysPlugin,
  RequestHook,
  RequestHookContext,
  RequestHookOptions,
  RequestPolicy,
  UploadEndpoint,
  ResponseHook,
  ResponseHookContext,
  RetentionRuleDefinition,
  RouteGrant,
  StorageBackend,
  SummaryFieldsDefinition,
  UploadEndpointContext,
  UploadHookContext,
  UploadReceiptContext,
} from './types.ts';
export type { ReplaySummary, SummaryFieldValue } from '../shared/replay.ts';
export type { AuthAdapter, AuthPluginFactory, Identity } from '../server/auth/types.ts';
export type { ObjectStorage } from '../server/storage/types.ts';
export type { SourceProvider } from '../shared/source-providers.ts';
export { assertRedactionRules, type RedactionPattern, type RedactionRules, type RedactionTextRule } from '../shared/redaction.ts';
export type { PosterMoment, PurposeConfig, PurposeInfo, PurposeOpenAt, PurposeViewerDefaults } from '../shared/purposes.ts';
export type { ReplayPerson } from '../shared/people.ts';
