/**
 * Library entry point (`import … from 'replay-kit'`): record any browser page yourself, build and validate bundles,
 * and write server plugins against the typed interfaces. The CLI (`replay-kit capture`) and the server are built on
 * the same pieces.
 */
export { PRODUCT_NAME, PRODUCT_SLUG } from './shared/brand.ts';

// Recording
export {
  RecorderSession,
  recorderSource,
  normalizeConsole,
  normalizePerformance,
  type CdpLike,
  type RecordedTracks,
} from './capture/session.ts';
export { capture, parseArgs, type CaptureArgs, type DriverName } from './capture/capture.ts';
export { playwrightDriver, type PlaywrightDriverOptions } from './capture/drivers/playwright.ts';
export { agentBrowserDriver } from './capture/drivers/agent-browser.ts';
export type { CaptureDriver, LaunchOptions, RawStep } from './capture/drivers/types.ts';
export { buildReplayContext } from './capture/context.ts';
export { networkEntries, sanitizeReplayBundle, sanitizeUrl, sanitizeHar } from './capture/sanitize.ts';
export { buildHumanBundle } from './capture/human-bundle.ts';

// Data model
export type {
  ConsoleLevel,
  ReplayBundle,
  ReplayConsoleEntry,
  ReplayMeta,
  ReplayNetworkEntry,
  ReplayPerformanceEntry,
  ReplayPerformanceTrack,
  ReplaySource,
  ReplayStep,
  ReplaySummary,
} from './shared/replay.ts';
export { assertReplayBundle, summarizeReplay } from './shared/replay.ts';
export type { ReplayContext, ReplaySourceInput, ReplaySourceRef } from './shared/context.ts';
export { assertReplayContext } from './shared/context.ts';
export {
  SourceProviders,
  githubProvider,
  gitlabProvider,
  templateProvider,
  urlProvider,
  type SourceProvider,
} from './shared/source-providers.ts';

// Extension points for server plugins
export type { AuthAdapter, AuthPluginFactory, AuthRouteContext, Identity } from './server/auth/types.ts';
export { headerAuth } from './server/auth/header.ts';
export { noneAuth } from './server/auth/none.ts';
export { oidcAuth, type OidcOptions } from './server/auth/oidc.ts';
export type { ObjectStorage, ObjectInfo, WriteOptions, ListOptions } from './server/storage/types.ts';
export { FsStorage } from './server/storage/fs.ts';
export { S3Storage } from './server/storage/s3.ts';
export { compileContextSchema, type ContextSchema } from './server/context-schema.ts';
export { THEME_TOKENS, type BrandingConfig, type ThemeTokens } from './server/branding.ts';
