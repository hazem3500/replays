/** `@hazem3500/replays/plugin`: declare server plugins. See docs/extension-api.md. */
export { definePlugin, assertPlugin } from './define.ts';
export { PluginError, rejectUpload, type PluginErrorCode } from './errors.ts';
export { mergeRegistries, orderPlugins, resolvePlugins, resolvePluginsSync, type PluginRegistry } from './registry.ts';
export { PLUGIN_API_VERSION } from './types.ts';
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
  PluginApi,
  PluginSpec,
  PrepareUploadContext,
  PrepareUploadHook,
  ReplaysPlugin,
  RequestHook,
  RequestHookContext,
  RequestHookOptions,
  ResponseHook,
  ResponseHookContext,
  StorageBackend,
  UploadHookContext,
} from './types.ts';
export type { AuthAdapter, AuthPluginFactory, Identity } from '../server/auth/types.ts';
export type { ObjectStorage } from '../server/storage/types.ts';
export type { SourceProvider } from '../shared/source-providers.ts';
export { assertRedactionRules, type RedactionPattern, type RedactionRules, type RedactionTextRule } from '../shared/redaction.ts';
