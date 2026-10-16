/**
 * `@hazem3500/replays/server`: run the viewer and API from your own entry point, or compose pieces of it.
 *
 *   import { startServer } from '@hazem3500/replays/server';
 *   await startServer({ handleSignals: true });   // reads replays.config.* and the environment
 */
export { startServer, type RunningServer, type StartOptions } from './start.ts';
export { createRuntime, mergeContextSchemas, type Runtime } from './runtime.ts';
export { createApp, type AppOptions } from './app.ts';
export { ReplayStore } from './store.ts';
export { loadSettings, readConfigFile, type AppSettings, type FileConfig } from './config.ts';
export { authFromEnv, headerAuth, noneAuth, oidcAuth } from './auth/index.ts';
export type { OidcOptions } from './auth/oidc.ts';
export type { AuthAdapter, AuthPluginFactory, AuthRouteContext, Identity } from './auth/types.ts';
export { FsStorage, MemoryStorage, S3Storage, storageFromEnv } from './storage/index.ts';
export type { ObjectInfo, ObjectStorage, ListOptions, WriteOptions } from './storage/types.ts';
export { compileContextSchema, type ContextSchema } from './context-schema.ts';
export { THEME_TOKENS, validateBranding, type BrandingConfig, type ThemeTokens } from './branding.ts';
