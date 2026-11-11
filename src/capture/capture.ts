import { constants } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { shotDelayMs, stepPauseMs, typeDelayMs, type CapturePacingOptions } from '../shared/capture-pacing.ts';
import type { CaptureNetwork, NetworkBodyLimits } from '../shared/capture-profile.ts';
import { type ProfileConfig, profileOf, profilesOf } from '../shared/profiles.ts';
import type { ConsoleLevel } from '../shared/replay.ts';
import { captureSettings, capturedRecord, networkFlag, profileCapture, unknownProfileWarning } from './capture-settings.ts';
import { assertReplayId, REPLAY_FORMAT_VERSION, type ReplayBundle, type ReplayStep } from '../shared/replay.ts';
import { assertReplayTags, type ReplayPerson } from '../shared/replay.ts';
import { parsePeopleFlags } from '../shared/people.ts';
import { SourceProviders, type TemplateProviderConfig } from '../shared/source-providers.ts';
import type { ReplaySourceInput } from '../shared/context.ts';
import { compileContextSchema } from '../server/context-schema.ts';
import { loadConfig } from '../config/index.ts';
import { resolvePlugins } from '../plugin/registry.ts';
import { assertRedactionRules, mergeRedactionRules, type RedactionRules } from '../shared/redaction.ts';
import { defaultId, flagMap, prepareOutputDirectory, profileFlag } from './bundle-io.ts';
import { CAPTURE_USAGE } from './capture-usage.ts';
import { createTerminal, reportCliFailure } from './terminal.ts';
import { uploadConfigured } from './upload.ts';
import { uploadSummary } from './upload-report.ts';
import { buildReplayContext, readContextFile } from './context.ts';
import { agentBrowserDriver } from './drivers/agent-browser.ts';
import { readStateFile } from './drivers/storage-state.ts';
import { playwrightDriver } from './drivers/playwright.ts';
import type { CaptureDriver, RawStep } from './drivers/types.ts';
import { networkEntries, sanitizeReplayBundle, sanitizeUrl } from './sanitize.ts';
import { RecorderSession } from './session.ts';
import { assertCaptureUrl, readSteps } from './capture-steps.ts';
import { saveShot, type CapturedShot } from './capture-shots.ts';
import { labelFor } from './step-labels.ts';
import { assertPrivacyFitsProfile, inputsVisible, privacyFlag } from './capture-privacy.ts';
import { compressPacingWaits, isPacingWait, pacingClock, pacingWaitLabel, type PacingSpan } from './pacing-waits.ts';
import { waitForManualStop, type ManualStopOptions, type ManualStopReason } from './manual.ts';
import { DEFAULT_MAX_DURATION_MS, MAX_DURATION_CEILING_MS } from '../recorder/recorder-limits.ts';
import type { RecorderPrivacyMode } from '../recorder/types.ts';

export type { RawStep } from './drivers/types.ts';
export { createPullGate, normalizeConsole, normalizePerformance } from './session.ts';
export { defaultId, prepareOutputDirectory } from './bundle-io.ts';
export { validateSteps } from './capture-steps.ts';
export type { CapturedShot } from './capture-shots.ts';
export { labelFor, selectorName } from './step-labels.ts';

export type DriverName = 'playwright' | 'agent-browser';

export interface CaptureArgs extends CapturePacingOptions {
  url: string;
  output: string;
  id: string;
  title?: string;
  steps: RawStep[];
  video: boolean;
  driver: DriverName;
  viewport: { width: number; height: number };
  /** A Playwright storage state file (`--state`) the browser starts with, to record pages behind a sign-in. */
  state?: string;
  uploadUrl?: string;
  headerFile?: string;
  upload?: boolean;
  login?: boolean;
  serverName?: string;
  context?: unknown;
  /** Source references (`github:owner/repo#12`) to add to the context. */
  sources: ReplaySourceInput[];
  tags: string[];
  /** `meta.profile`: one of the server's profiles (it refuses others). */
  profile?: string;
  /** @deprecated Use `profile`. */
  purpose?: string;
  /** `meta.people`, from repeatable `--person role:email[:handle=value]` flags. */
  people?: ReplayPerson[];
  suiteRun?: { suiteId: string; runId: string };
  /** JSON Schema file for `context.fields`; the deployment's own, so a bad context fails before the browser starts. */
  contextSchema?: unknown;
  sourceProviders?: readonly TemplateProviderConfig[];
  /** The deployment's redaction rules (config file and plugins), added to the sanitiser's defaults. */
  redaction?: RedactionRules;
  /** Default `'headers'`; `'bodies'` keeps redacted request and response bodies under `bodies` limits. */
  network?: CaptureNetwork;
  /** Body limits with `network: 'bodies'`; they can only narrow the defaults. */
  bodies?: NetworkBodyLimits;
  /** Default true. */
  performance?: boolean;
  /** Performance was asked for on purpose; the bundle then records it as the reason for the capture. */
  performanceChosen?: boolean;
  /** Console levels kept; default all. */
  console?: readonly ConsoleLevel[];
  /** The recorder's privacy mode (`--privacy`); default `inputs-masked`, typed values hidden and page text shown. */
  privacy?: RecorderPrivacyMode;
  /** CSS selectors hidden from the first frame, in the recording and in a `shot` (`--hide`, repeatable). */
  hide?: readonly string[];
  /** Per-character delay of a `type` step in ms (`--type-delay`); default 80. */
  typeDelayMs?: number;
  /** Hold after a `shot` step in ms (`--shot-delay`); default the step pause. */
  shotDelayMs?: number;
  /** Compress unlabelled fixed waits over 5 s to 2 s of replay time (`--compress-waits`); not with a video. */
  compressWaits?: boolean;
  /** A manual recording: the person drives the browser and `steps` is empty; it ends at `maxDurationMs` at the latest. */
  manual?: { maxDurationMs: number };
}

/** What a manual recording listens to and tells the person; tests swap each for a fake. */
export interface ManualHooks extends Pick<ManualStopOptions, 'stdin' | 'signals' | 'abort'> {
  onRecording?: () => void;
  onTick?: (elapsedMs: number) => void;
  onStopped?: (reason: ManualStopReason) => void;
}

const BOOLEAN_FLAGS = new Set(['video', 'headed', 'manual', 'upload', 'login', 'performance', 'no-performance', 'compress-waits']);

export { CAPTURE_USAGE };

/** `--max-duration`: seconds, or a number with `s` or `m`; at most the recorder's ten minutes, default its three. */
export function parseMaxDuration(value?: string): number {
  if (value === undefined) return DEFAULT_MAX_DURATION_MS;
  const match = /^(\d+(?:\.\d+)?)([sm]?)$/.exec(value);
  const ms = match ? Number(match[1]) * (match[2] === 'm' ? 60_000 : 1000) : 0;
  if (!(ms >= 1000 && ms <= MAX_DURATION_CEILING_MS))
    throw new Error(`--max-duration must be 1 to ${MAX_DURATION_CEILING_MS / 1000} seconds (for example 90, 90s or 2m)`);
  return ms;
}

export function parseViewport(value: string | undefined) {
  if (!value) return { width: 1440, height: 900 };
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(value);
  if (!match) throw new Error('--viewport must look like 1440x900');
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * The deployment's redaction rules, so a capture is cleaned the way the server will clean it on upload: the config's
 * `redaction` plus every plugin's `api.redaction`. The config is the server's (`--config`, else `REPLAYS_CONFIG`, else
 * `replays.config.*` in `cwd`); its plugins are imported and set up (registration only). Also reads capture defaults.
 */
async function loadCaptureSettings(options: { configFile?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{
  redaction?: RedactionRules | undefined;
  pacing?: CapturePacingOptions | undefined;
  profiles?: { config?: readonly ProfileConfig[] | undefined; plugins: readonly ProfileConfig[] };
}> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig({ env: options.configFile ? { ...env, REPLAYS_CONFIG: options.configFile } : env, cwd });
  if (!config.path) return {};
  if (config.file.redaction !== undefined) assertRedactionRules(config.file.redaction, `${config.path} redaction`);
  const registry = await resolvePlugins(config.plugins, { env, cwd });
  const rules = mergeRedactionRules(config.file.redaction, registry.redaction);
  return {
    redaction: Object.keys(rules).length ? rules : undefined,
    pacing: config.file.capture,
    profiles: { config: profilesOf(config.file), plugins: registry.profiles.map(({ value }) => value) },
  };
}

/** The config and plugins' additive redaction rules, also used by other producers. */
export async function loadCaptureRedaction(
  options: { configFile?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RedactionRules | undefined> {
  return (await loadCaptureSettings(options)).redaction;
}

function assertFlagCombinations(values: Record<string, string>, booleans: Set<string>) {
  const manual = booleans.has('manual');
  if (manual && !booleans.has('headed')) throw new Error('--manual requires --headed');
  if (manual && values.steps !== undefined) throw new Error('--manual cannot be combined with --steps');
  if (manual && values.driver !== undefined && values.driver !== 'playwright') throw new Error('--manual needs the playwright driver');
  if (!manual && values['max-duration'] !== undefined) throw new Error('--max-duration requires --manual');
  if (!values.output && !manual) throw new Error('required: --output <directory>');
  if (booleans.has('login') && !booleans.has('upload') && !values['upload-url'])
    throw new Error('--login requires --upload or --upload-url');
  if (Boolean(values['suite-id']) !== Boolean(values['run-id'])) throw new Error('--suite-id and --run-id must be used together');
  if (values['run-id'] && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(values['run-id'])) {
    throw new Error('--run-id must contain letters, digits, and hyphens');
  }
}

export async function parseArgs(argv = process.argv.slice(2)): Promise<CaptureArgs & { headed: boolean }> {
  const { values, lists, booleans } = flagMap(argv, BOOLEAN_FLAGS);
  if (!values.url) throw new Error('required: --url <https-url>');
  assertCaptureUrl(values.url, '--url');
  const manual = booleans.has('manual');
  assertFlagCombinations(values, booleans);
  const id = assertReplayId(values.id ?? defaultId(values.url));
  const driver = (values.driver ?? 'playwright') as DriverName;
  if (driver !== 'playwright' && driver !== 'agent-browser') throw new Error('--driver must be playwright or agent-browser');
  const tags = lists.tag ?? [];
  if (tags.length) assertReplayTags(tags, '--tag');
  const profile = profileFlag(values);
  const people = parsePeopleFlags(lists.person ?? []);
  const providers = new SourceProviders();
  const sources = (lists.source ?? []).map((spec) => providers.parse(spec));
  const schema: unknown = values['context-schema'] ? JSON.parse(await readFile(resolve(values['context-schema']), 'utf8')) : undefined;
  const context = await readContextFile(values['context-file']);
  const loaded = await loadCaptureSettings(values.config ? { configFile: values.config } : {});
  const own = profileCapture(profile, loaded.profiles ?? {});
  const unknownProfile = unknownProfileWarning(profile, loaded.profiles ?? {});
  if (unknownProfile) process.stderr.write(`${unknownProfile}\n`);
  const settings = captureSettings(own, {
    ...(values.network === undefined ? {} : { network: networkFlag(values.network) }),
    ...(booleans.has('no-performance') ? { performance: false } : booleans.has('performance') ? { performance: true } : {}),
  });
  const privacy = privacyFlag(values.privacy);
  assertPrivacyFitsProfile(privacy, settings.maskAllText);
  const redaction = settings.maskAllText ? mergeRedactionRules(loaded.redaction, { maskSelectors: ['body'] }) : loaded.redaction;
  if (values['step-pause'] !== undefined && values['step-delay'] !== undefined)
    throw new Error('--step-delay is the same flag as --step-pause; use one');
  const stepFlag = values['step-pause'] ?? values['step-delay'];
  const pause = stepPauseMs(stepFlag === undefined ? (own?.stepPauseMs ?? loaded.pacing?.stepPauseMs) : Number(stepFlag));
  const typeDelay = values['type-delay'] === undefined ? undefined : typeDelayMs(Number(values['type-delay']));
  const shotDelay = values['shot-delay'] === undefined ? undefined : shotDelayMs(Number(values['shot-delay']));
  const video = booleans.has('video') || own?.video === true;
  if (booleans.has('compress-waits') && video)
    throw new Error('--compress-waits cannot be combined with --video; the video keeps real time');
  const state = values.state ? await readStateFile(values.state) : undefined;
  const args = {
    url: values.url,
    output: resolve(values.output ?? id),
    id,
    steps: await readSteps(values.steps),
    stepPauseMs: pause,
    video,
    headed: booleans.has('headed'),
    driver,
    viewport: values.viewport === undefined && own?.viewport ? own.viewport : parseViewport(values.viewport),
    ...(state ? { state } : {}),
    ...(privacy ? { privacy } : {}),
    ...(lists.hide?.length ? { hide: lists.hide } : {}),
    ...(typeDelay === undefined ? {} : { typeDelayMs: typeDelay }),
    ...(shotDelay === undefined ? {} : { shotDelayMs: shotDelay }),
    ...(booleans.has('compress-waits') ? { compressWaits: true } : {}),
    network: settings.network,
    ...(settings.bodies ? { bodies: settings.bodies } : {}),
    performance: settings.performance,
    performanceChosen: settings.performanceChosen,
    ...(settings.console ? { console: settings.console } : {}),
    sources,
    tags,
    ...(profile ? { profile } : {}),
    ...(people.length ? { people } : {}),
    ...(values.title ? { title: values.title } : {}),
    ...(values['upload-url'] ? { uploadUrl: values['upload-url'] } : {}),
    ...(values['header-file'] ? { headerFile: values['header-file'] } : {}),
    ...(booleans.has('upload') ? { upload: true } : {}),
    ...(booleans.has('login') ? { login: true } : {}),
    ...(manual ? { manual: { maxDurationMs: parseMaxDuration(values['max-duration']) } } : {}),
    ...(values.server ? { serverName: values.server } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(schema !== undefined ? { contextSchema: schema } : {}),
    ...(redaction ? { redaction } : {}),
    ...(values['suite-id'] || values['run-id']
      ? { suiteRun: { suiteId: assertReplayId(values['suite-id'] ?? ''), runId: values['run-id'] ?? '' } }
      : {}),
  } satisfies CaptureArgs & { headed: boolean };
  // why: a bad context or source is a usage error, so it fails before the browser starts, not as a half-finished capture.
  buildContext(args, new Date(0).toISOString());
  return args;
}

/** The bundle's context: the runner's file plus `--source` flags, checked against the schema. */
function buildContext(args: CaptureArgs, capturedAt: string) {
  if (args.context === undefined && !args.sources.length) return undefined;
  const base = args.context === undefined ? {} : (args.context as Record<string, unknown>);
  const merged = {
    ...base,
    ...(args.sources.length ? { sources: [...((base.sources as unknown[] | undefined) ?? []), ...args.sources] } : {}),
  };
  return buildReplayContext(merged, capturedAt, {
    sources: new SourceProviders({ templates: args.sourceProviders ?? [] }),
    ...(args.contextSchema ? { schema: compileContextSchema(args.contextSchema) } : {}),
  });
}

/** The driver chosen by name; tests pass their own through `capture()`. */
export function createDriver(name: DriverName, options: { headed?: boolean } = {}): CaptureDriver {
  return name === 'agent-browser' ? agentBrowserDriver() : playwrightDriver({ headless: !options.headed });
}

export async function capture(args: CaptureArgs, driver: CaptureDriver = createDriver(args.driver), hooks: ManualHooks = {}) {
  const pause = stepPauseMs(args.stepPauseMs);
  const typeDelay = typeDelayMs(args.typeDelayMs);
  const shotHold = shotDelayMs(args.shotDelayMs) ?? pause;
  // why: a raw video runs on the real clock, so a capture that keeps one keeps real time too.
  const compressWaits = args.compressWaits === true && !args.video;
  const pacingSpans: PacingSpan[] = [];
  await prepareOutputDirectory(args.output);
  const scratch = await mkdtemp(join(tmpdir(), 'replays-'));
  const harPath = join(scratch, 'session.har');
  const rawVideoPath = join(scratch, 'session.mp4');
  const rawSteps: Array<ReplayStep & { epoch: number }> = [];
  const shotFiles: Array<{ name: string; file: string; step: number }> = [];
  const stepEnds: Array<{ label: string; epoch: number }> = [];
  let session: RecorderSession | undefined;
  let release: (() => void) | undefined;
  try {
    const wantsBodies = args.network === 'bodies';
    const bodiesRecorded = wantsBodies && driver.recordsBodies === true;
    if (wantsBodies && !bodiesRecorded)
      process.stderr.write(
        `warning: --network bodies was requested but the ${driver.name} driver cannot record bodies; this capture keeps headers only\n`,
      );
    const cdp = await driver.launch({
      viewport: args.viewport,
      harPath,
      typeDelayMs: typeDelay,
      ...(args.state ? { state: args.state } : {}),
      ...(bodiesRecorded ? { bodies: true } : {}),
      ...(args.video ? { videoPath: rawVideoPath } : {}),
    });
    session = await RecorderSession.start(cdp, {
      ...(args.redaction ? { redaction: args.redaction } : {}),
      ...(args.manual ? { steps: true } : {}),
      ...(args.privacy ? { privacy: args.privacy } : {}),
      ...(args.hide?.length ? { hide: args.hide } : {}),
    });

    rawSteps.push({
      at: 0,
      epoch: Date.now(),
      kind: 'open',
      label: `Open ${new URL(args.url).hostname}`,
      url: sanitizeUrl(args.url),
    });
    await driver.open(args.url);
    await driver.wait(700);
    await session.flush();

    let stoppedBy: ManualStopReason | undefined;
    for (const step of args.manual ? [] : args.steps) {
      await session.flush();
      if (step.kind !== 'wait' || step.label?.trim())
        rawSteps.push({
          at: 0,
          epoch: Date.now(),
          kind: step.kind,
          label: labelFor(step),
          ...(step.label ? {} : { auto: true as const }),
          ...('selector' in step ? { selector: step.selector } : {}),
          ...('url' in step ? { url: sanitizeUrl(step.url) } : {}),
        });
      const startedAt = Date.now();
      if (step.kind === 'shot')
        shotFiles.push({ name: step.name, file: await saveShot(driver, args.output, step.name), step: rawSteps.length });
      else await driver.step(step);
      if (step.label) stepEnds.push({ label: step.label, epoch: Date.now() });
      if (compressWaits && isPacingWait(step)) {
        const span = { from: startedAt, to: Date.now() };
        pacingSpans.push(span);
        rawSteps.push({ at: 0, epoch: startedAt, kind: 'wait', label: pacingWaitLabel(span) });
      }
      const hold = step.kind === 'shot' ? shotHold : pause;
      if (step.kind !== 'wait' && hold > 0) await driver.wait(hold);
      await session.flush();
    }
    if (args.manual) {
      if (!driver.closed) throw new Error(`--manual needs a driver that reports when the window closes; ${driver.name} does not`);
      const waiting = waitForManualStop({
        closed: driver.closed(),
        maxDurationMs: args.manual.maxDurationMs,
        ...hooks,
      });
      release = waiting.release;
      hooks.onRecording?.();
      stoppedBy = await waiting.reason;
      hooks.onStopped?.(stoppedBy);
    }
    // why: a closed window has no page left to wait on.
    if (stoppedBy !== 'closed') await driver.wait(900);
    const tracks = await session.stop();
    session = undefined;
    await driver.finish();

    const har: unknown = JSON.parse(await readFile(harPath, 'utf8'));
    const { origin } = tracks;
    const steps = [
      ...rawSteps.map(({ epoch, ...step }) => ({ ...step, at: Math.max(0, epoch - origin) })),
      ...tracks.steps.map((step) => ({ ...step, at: Math.max(0, step.at - origin) })),
    ].sort((a, b) => a.at - b.at);
    const { duration } = tracks;
    const spans = pacingSpans.map(({ from, to }) => ({ from: from - origin, to: to - origin }));
    const replayClock = pacingClock(spans);
    const shots: CapturedShot[] = shotFiles.map(({ step, ...shot }) => ({
      ...shot,
      label: rawSteps[step - 1]!.label,
      step,
      at: replayClock(Math.max(0, rawSteps[step - 1]!.epoch - origin)),
    }));
    const context = buildContext(args, new Date(origin).toISOString());
    const profile = profileOf(args);
    let bundle: ReplayBundle = {
      meta: {
        id: args.id,
        title: args.title ?? new URL(args.url).hostname,
        url: sanitizeUrl(args.url),
        capturedAt: new Date(origin).toISOString(),
        duration,
        viewport: args.viewport,
        eventCount: tracks.events.length,
        version: 1,
        formatVersion: REPLAY_FORMAT_VERSION,
        source: 'agent',
        ...(args.video ? { videoFile: 'session.mp4' } : {}),
        ...(args.tags.length ? { tags: args.tags } : {}),
        ...(profile ? { profile } : {}),
        ...(args.people?.length ? { people: args.people } : {}),
        captured: capturedRecord(
          {
            network: args.network ?? 'headers',
            performance: args.performance ?? true,
            performanceChosen: args.performanceChosen === true,
            ...(args.console ? { console: args.console } : {}),
            inputsVisible: inputsVisible(args.privacy),
          },
          args.video,
          bodiesRecorded,
        ),
      },
      events: tracks.events,
      console: args.console ? tracks.console.filter((entry) => args.console?.includes(entry.level)) : tracks.console,
      network:
        args.network === 'off'
          ? []
          : networkEntries(har, origin, args.redaction, bodiesRecorded ? (args.bodies ?? {}) : undefined).sort((a, b) => a.at - b.at),
      steps,
      ...(args.performance === false ? {} : { performance: tracks.performance }),
      ...(context ? { context } : {}),
      ...(args.suiteRun ? { suiteRun: args.suiteRun } : {}),
    };
    bundle = compressPacingWaits(bundle, spans);
    const keepVisibleInputs = inputsVisible(args.privacy);
    // why: the host's rules also cover what the steps added (labels, the title), as the server's upload pass does.
    if (args.redaction || bodiesRecorded || keepVisibleInputs) bundle = sanitizeReplayBundle(bundle, args.redaction, { keepVisibleInputs });
    const replayPath = join(args.output, 'replay.json');
    await writeFile(replayPath, `${JSON.stringify(bundle)}\n`, { flag: 'wx' });
    if (args.video) await copyFile(rawVideoPath, join(args.output, 'session.mp4'), constants.COPYFILE_EXCL);
    const uploaded =
      args.upload || args.uploadUrl
        ? await uploadConfigured(bundle, args.output, {
            ...(args.uploadUrl ? { uploadUrl: args.uploadUrl } : {}),
            ...(args.serverName ? { serverName: args.serverName } : {}),
            ...(args.headerFile ? { headerFile: args.headerFile } : {}),
            ...(args.login ? { forceLogin: true } : {}),
          })
        : undefined;
    return {
      replayPath,
      eventCount: tracks.events.length,
      requestCount: bundle.network.length,
      consoleCount: bundle.console.length,
      performanceCount: bundle.performance?.entries.length ?? 0,
      duration: bundle.meta.duration,
      video: args.video ? join(args.output, 'session.mp4') : undefined,
      ...(shots.length ? { shots } : {}),
      // why: a labelled step's completion on the recording's clock, before the pause that follows it (the suite's `measure`).
      ...(stepEnds.length
        ? { stepEnds: stepEnds.map(({ label, epoch }) => ({ label, at: replayClock(Math.max(0, epoch - origin)) })) }
        : {}),
      ...(stoppedBy ? { stoppedBy } : {}),
      networkRequested: args.network ?? 'headers',
      networkMode: args.network === 'off' ? 'off' : bodiesRecorded ? 'bodies' : 'headers',
      ...(uploaded ? { upload: uploaded } : {}),
    };
  } finally {
    release?.();
    session?.dispose();
    await driver.close().catch(() => undefined);
    await rm(scratch, { recursive: true, force: true });
  }
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** The line a manual recording prints once the browser is up, with a running timer for a person at a terminal. */
function manualHooks(args: CaptureArgs, { json, spinner }: { json: boolean; spinner: { stop(): void } }): ManualHooks {
  if (!args.manual) return {};
  const enter = Boolean(process.stdin.isTTY);
  const line = `Recording… do your thing in the browser, then ${enter ? 'press Enter here (or close the window)' : 'close the window'} to stop`;
  const live = Boolean(process.stdout.isTTY) && !json;
  return {
    stdin: process.stdin,
    signals: process,
    onRecording: () => {
      spinner.stop();
      process.stderr.write(live ? `${line} [0:00]` : `${line}\n`);
    },
    ...(live
      ? { onTick: (ms: number) => process.stderr.write(`\r${line} [${clock(ms)}]`), onStopped: () => process.stderr.write('\n') }
      : {}),
  };
}

/** `replays capture …`: one JSON line on success or failure for agents and CI; a spinner and summary for a person at a terminal. */
export async function runCaptureCli(argv: string[], env: NodeJS.ProcessEnv = {}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${CAPTURE_USAGE}\n`);
    return;
  }
  const json = argv.includes('--json');
  const spinner = createTerminal({ env, stream: process.stderr, json }).spinner('Recording the page');
  try {
    const args = await parseArgs(argv.filter((arg) => arg !== '--json'));
    const result = await capture(args, createDriver(args.driver, { headed: args.headed }), manualHooks(args, { json, spinner }));
    spinner.stop();
    const out = createTerminal({ env, stream: process.stdout, json });
    if (out.fancy) {
      const seconds = (result.duration / 1000).toFixed(1);
      const rows: Array<[string, string]> = [
        ['Replay', result.replayPath],
        ['Events', String(result.eventCount)],
        ['Requests', String(result.requestCount)],
        ['Console', String(result.consoleCount)],
        [
          'Network',
          result.networkMode === result.networkRequested
            ? result.networkMode
            : `${result.networkMode} (${result.networkRequested} was requested but this driver cannot record it)`,
        ],
        ...(result.video ? ([['Video', result.video]] as Array<[string, string]>) : []),
        ...(result.shots ? ([['Shots', `${result.shots.length} in ${join(args.output, 'shots')}`]] as Array<[string, string]>) : []),
      ];
      const receipt = result.upload ? `\n\n${uploadSummary(out, result.upload)}` : '';
      process.stdout.write(
        `${out.header()}\n\n${out.ok(`Captured ${result.eventCount} events in ${seconds}s`)}\n\n${out.keyValue(rows)}${receipt}\n`,
      );
    } else process.stdout.write(`${JSON.stringify({ success: true, ...result })}\n`);
  } catch (error) {
    spinner.stop();
    process.exitCode = reportCliFailure(error, { env, stream: process.stderr, json });
  }
}
