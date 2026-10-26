/**
 * `@hazem3500/replays/server`: run the viewer and API from your own entry point, or compose pieces of it.
 *
 *   import { startServer } from '@hazem3500/replays/server';
 *   await startServer({ handleSignals: true });   // reads replays.config.* and the environment
 */
export { startServer, type RunningServer, type StartOptions } from './start.ts';
export type { ApplicationOptions, ApplicationRuntime } from './agent-native/runtime.ts';
export type { AgentCredential, AgentScope } from './agent-native/credentials.ts';
export { createRuntime, mergeContextSchemas, resolveSettings, type Runtime, type RuntimeOptions } from './runtime.ts';
export { createApp, type AppOptions } from './app.ts';
export { ReplayStore } from './store.ts';
export { createPurposeCatalog, PurposeCatalog } from './purposes.ts';
export { loadSettings, readConfigFile, type AppSettings, type FileConfig } from './config.ts';
export { authFromEnv, headerAuth, noneAuth, oidcAuth } from './auth/index.ts';
export type { OidcOptions } from './auth/oidc.ts';
export { verifyJwt, type JsonWebKeySet, type JwtAlgorithm, type JwtClaims, type VerifyJwtOptions } from './auth/jwt.ts';
export type { AuthAdapter, AuthPluginFactory, AuthRouteContext, Identity, SignInConfig } from './auth/types.ts';
export {
  assertKey,
  FsStorage,
  globToRegExp,
  MemoryStorage,
  NotFoundError,
  ObjectExistsError,
  PreconditionFailedError,
  S3Storage,
  storageFromEnv,
} from './storage/index.ts';
export type { ObjectInfo, ObjectStorage, ListOptions, WriteOptions } from './storage/types.ts';
export { compileContextSchema, type ContextSchema } from './context-schema.ts';
export { THEME_TOKENS, validateBranding, type BrandingConfig, type ThemeTokens } from './branding.ts';
export { normalizeHosts, withBase, type HostConfig, type HostRouting, type PageBranding } from './base-path.ts';
export { renderIndexHtml, type IndexPageOptions } from './index-page.ts';
export { buildStatic, type BuildStaticOptions, type StaticBuild } from './static.ts';
export {
  compareStores,
  migrateStore,
  type ComparableSummary,
  type MigratedEntry,
  type MigrateInfo,
  type MigrateKind,
  type MigrateOptions,
  type MigrateProgress,
  type MigrateReport,
  type MigrateTranslate,
  type StoreComparison,
} from './migrate.ts';
