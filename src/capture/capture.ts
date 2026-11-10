import { constants } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { stepPauseMs, type CapturePacingOptions } from '../shared/capture-pacing.ts';
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
import { playwrightDriver } from './drivers/playwright.ts';
import type { CaptureDriver, RawStep } from './drivers/types.ts';
import { networkEntries, sanitizeReplayBundle, sanitizeUrl } from './sanitize.ts';
import { RecorderSession } from './session.ts';
import { assertCaptureUrl, readSteps } from './capture-steps.ts';
import { labelFor } from './step-labels.ts';

export type { RawStep } from './drivers/types.ts';
export { createPullGate, normalizeConsole, normalizePerformance } from './session.ts';
export { defaultId, prepareOutputDirectory } from './bundle-io.ts';
export { validateSteps } from './capture-steps.ts';
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
}

const BOOLEAN_FLAGS = new Set(['video', 'headed', 'upload', 'login', 'performance', 'no-performance']);

export { CAPTURE_USAGE };

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

export async function parseArgs(argv = process.argv.slice(2)): Promise<CaptureArgs & { headed: boolean }> {
  const { values, lists, booleans } = flagMap(argv, BOOLEAN_FLAGS);
  if (!values.url) throw new Error('required: --url <https-url>');
  assertCaptureUrl(values.url, '--url');
  if (!values.output) throw new Error('required: --output <directory>');
  if (booleans.has('login') && !booleans.has('upload') && !values['upload-url'])
    throw new Error('--login requires --upload or --upload-url');
  const id = assertReplayId(values.id ?? defaultId(values.url));
  const driver = (values.driver ?? 'playwright') as DriverName;
  if (driver !== 'playwright' && driver !== 'agent-browser') throw new Error('--driver must be playwright or agent-browser');
  const tags = lists.tag ?? [];
  if (tags.length) assertReplayTags(tags, '--tag');
  const profile = profileFlag(values);
  const people = parsePeopleFlags(lists.person ?? []);
  if (Boolean(values['suite-id']) !== Boolean(values['run-id'])) throw new Error('--suite-id and --run-id must be used together');
  if (values['run-id'] && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(values['run-id'])) {
    throw new Error('--run-id must contain letters, digits, and hyphens');
  }
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
  const redaction = settings.maskAllText ? mergeRedactionRules(loaded.redaction, { maskSelectors: ['body'] }) : loaded.redaction;
  const pause = stepPauseMs(
    values['step-pause'] === undefined ? (own?.stepPauseMs ?? loaded.pacing?.stepPauseMs) : Number(values['step-pause']),
  );
  const args = {
    url: values.url,
    output: resolve(values.output),
    id,
    steps: await readSteps(values.steps),
    stepPauseMs: pause,
    video: booleans.has('video') || own?.video === true,
    headed: booleans.has('headed'),
    driver,
    viewport: values.viewport === undefined && own?.viewport ? own.viewport : parseViewport(values.viewport),
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

export async function capture(args: CaptureArgs, driver: CaptureDriver = createDriver(args.driver)) {
  const pause = stepPauseMs(args.stepPauseMs);
  await prepareOutputDirectory(args.output);
  const scratch = await mkdtemp(join(tmpdir(), 'replays-'));
  const harPath = join(scratch, 'session.har');
  const rawVideoPath = join(scratch, 'session.mp4');
  const rawSteps: Array<ReplayStep & { epoch: number }> = [];
  let session: RecorderSession | undefined;
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
      ...(bodiesRecorded ? { bodies: true } : {}),
      ...(args.video ? { videoPath: rawVideoPath } : {}),
    });
    session = await RecorderSession.start(cdp, args.redaction ? { redaction: args.redaction } : {});

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

    for (const step of args.steps) {
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
      await driver.step(step);
      if (step.kind !== 'wait' && pause > 0) await driver.wait(pause);
      await session.flush();
    }
    await driver.wait(900);
    const tracks = await session.stop();
    session = undefined;
    await driver.finish();

    const har: unknown = JSON.parse(await readFile(harPath, 'utf8'));
    const { origin } = tracks;
    const steps = rawSteps.map(({ epoch, ...step }) => ({ ...step, at: Math.max(0, epoch - origin) }));
    const { duration } = tracks;
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
    // why: the host's rules also cover what the steps added (labels, the title), as the server's upload pass does.
    if (args.redaction || bodiesRecorded) bundle = sanitizeReplayBundle(bundle, args.redaction);
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
      duration,
      video: args.video ? join(args.output, 'session.mp4') : undefined,
      networkRequested: args.network ?? 'headers',
      networkMode: args.network === 'off' ? 'off' : bodiesRecorded ? 'bodies' : 'headers',
      ...(uploaded ? { upload: uploaded } : {}),
    };
  } finally {
    session?.dispose();
    await driver.close().catch(() => undefined);
    await rm(scratch, { recursive: true, force: true });
  }
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
    const result = await capture(args, createDriver(args.driver, { headed: args.headed }));
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
