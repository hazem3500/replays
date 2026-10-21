/**
 * `@hazem3500/replays/capture`: record a browser page, build and validate replay bundles, resolve source links. No server code.
 */
export { PRODUCT_NAME, PRODUCT_SLUG } from '../shared/brand.ts';
export {
  RecorderSession,
  recorderSource,
  normalizeConsole,
  normalizePerformance,
  type CdpLike,
  type RecordedTracks,
} from './session.ts';
export { capture, parseArgs, type CaptureArgs, type DriverName } from './capture.ts';
export { playwrightDriver, type PlaywrightDriverOptions } from './drivers/playwright.ts';
export { agentBrowserDriver } from './drivers/agent-browser.ts';
export type { CaptureDriver, LaunchOptions, RawStep } from './drivers/types.ts';
export { buildReplayContext } from './context.ts';
export { networkEntries, sanitizeReplayBundle, sanitizeUrl, sanitizeHar } from './sanitize.ts';
export { assertRedactionRules, type RedactionPattern, type RedactionRules, type RedactionTextRule } from '../shared/redaction.ts';
export { buildHumanBundle } from './human-bundle.ts';
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
} from '../shared/replay.ts';
export { assertReplayBundle, summarizeReplay } from '../shared/replay.ts';
export {
  assertReplayPeople,
  parsePeopleFlags,
  personMatch,
  type PersonIdentity,
  type ReplayPerson,
  type ReplayPersonSummary,
} from '../shared/people.ts';
export type { ReplayContext, ReplaySourceInput, ReplaySourceRef } from '../shared/context.ts';
export { assertReplayContext } from '../shared/context.ts';
export {
  SourceProviders,
  githubProvider,
  gitlabProvider,
  templateProvider,
  urlProvider,
  type SourceProvider,
} from '../shared/source-providers.ts';
