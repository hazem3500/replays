import { constants } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { stepPauseMs, type CapturePacingOptions } from '../shared/capture-pacing.ts';
import { assertReplayId, type ReplayBundle, type ReplayStep } from '../shared/replay.ts';
import { assertReplayTags, type ReplayPerson } from '../shared/replay.ts';
import { parsePeopleFlags } from '../shared/people.ts';
import { isPurposeId } from '../shared/purposes.ts';
import { SourceProviders, type TemplateProviderConfig } from '../shared/source-providers.ts';
import type { ReplaySourceInput } from '../shared/context.ts';
import { compileContextSchema } from '../server/context-schema.ts';
import { loadConfig } from '../config/index.ts';
import { resolvePlugins } from '../plugin/registry.ts';
import { assertRedactionRules, mergeRedactionRules, type RedactionRules } from '../shared/redaction.ts';
import { defaultId, flagMap, prepareOutputDirectory, upload } from './bundle-io.ts';
import { buildReplayContext, readContextFile } from './context.ts';
import { agentBrowserDriver } from './drivers/agent-browser.ts';
import { playwrightDriver } from './drivers/playwright.ts';
import type { CaptureDriver, RawStep } from './drivers/types.ts';
import { networkEntries, sanitizeReplayBundle, sanitizeUrl } from './sanitize.ts';
import { RecorderSession } from './session.ts';

export type { RawStep } from './drivers/types.ts';
export { createPullGate, normalizeConsole, normalizePerformance } from './session.ts';
export { defaultId, prepareOutputDirectory } from './bundle-io.ts';

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
  context?: unknown;
  /** Source references (`github:owner/repo#12`) to add to the context. */
  sources: ReplaySourceInput[];
  tags: string[];
  /** `meta.purpose`: one of the server's purposes (it refuses others). */
  purpose?: string;
  /** `meta.people`, from repeatable `--person role:email[:handle=value]` flags. */
  people?: ReplayPerson[];
  suiteRun?: { suiteId: string; runId: string };
  /** JSON Schema file for `context.fields`; the deployment's own, so a bad context fails before the browser starts. */
  contextSchema?: unknown;
  sourceProviders?: readonly TemplateProviderConfig[];
  /** The deployment's redaction rules (config file and plugins), added to the sanitiser's defaults. */
  redaction?: RedactionRules;
}

const BOOLEAN_FLAGS = new Set(['video', 'headed']);

function requiredString(step: Record<string, unknown>, field: string, index: number) {
  const value = step[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--steps[${index}].${field} must be a non-empty string`);
  }
  return value;
}

export function validateSteps(value: unknown): RawStep[] {
  if (!Array.isArray(value)) throw new Error('--steps must be a JSON array');
  return value.map((rawStep, index) => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
      throw new Error(`--steps[${index}] must be an object`);
    }
    const step = rawStep as Record<string, unknown>;
    const kind = requiredString(step, 'kind', index);
    if (step.label !== undefined && (typeof step.label !== 'string' || step.label.length === 0)) {
      throw new Error(`--steps[${index}].label must be a non-empty string`);
    }
    const labelled = typeof step.label === 'string' ? { label: step.label } : {};
    switch (kind) {
      case 'click':
      case 'hover':
        return { kind, selector: requiredString(step, 'selector', index), ...labelled };
      case 'type':
      case 'fill': {
        const text = step.text;
        if (typeof text !== 'string') throw new Error(`--steps[${index}].text must be a string`);
        return { kind, selector: requiredString(step, 'selector', index), text, ...labelled };
      }
      case 'press':
        return { kind, key: requiredString(step, 'key', index), ...labelled };
      case 'wait': {
        const ms = step.ms;
        if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
          throw new Error(`--steps[${index}].ms must be a non-negative number`);
        }
        return { kind, ms, ...labelled };
      }
      case 'scroll': {
        const directions = new Set(['up', 'down', 'left', 'right']);
        if (typeof step.direction !== 'string' || !directions.has(step.direction)) {
          throw new Error(`--steps[${index}].direction must be up, down, left, or right`);
        }
        if (step.pixels !== undefined && (typeof step.pixels !== 'number' || !Number.isFinite(step.pixels) || step.pixels < 0)) {
          throw new Error(`--steps[${index}].pixels must be a non-negative number`);
        }
        return {
          kind,
          direction: step.direction as 'up' | 'down' | 'left' | 'right',
          ...(typeof step.pixels === 'number' ? { pixels: step.pixels } : {}),
          ...labelled,
        };
      }
      case 'goto': {
        const url = requiredString(step, 'url', index);
        assertCaptureUrl(url, `--steps[${index}].url`);
        return { kind, url, ...labelled };
      }
      default:
        throw new Error(`--steps[${index}].kind is unsupported: ${kind}`);
    }
  });
}

async function readSteps(raw?: string): Promise<RawStep[]> {
  if (!raw) return [];
  const source = raw.startsWith('@') ? await readFile(resolve(raw.slice(1)), 'utf8') : raw;
  const steps: unknown = JSON.parse(source);
  return validateSteps(steps);
}

export const CAPTURE_USAGE = `Usage: replays capture --url <https-url> --output <dir> [options]

  --url <url>              page to open (https, or http on localhost)
  --output <dir>           empty directory for replay.json (and session.mp4)
  --steps <json|@file>     closed list of steps: click, hover, type, fill, press, wait, scroll, goto
  --step-pause <ms>        hold after non-wait actions, 0..10000 (config.capture.stepPauseMs, else 0)
  --title <text>           title shown in the viewer (default: the host name)
  --id <id>                replay id (default: <host>-<timestamp>-<random>)
  --driver <name>          playwright (default) or agent-browser
  --viewport <WxH>         default 1440x900
  --video                  also write session.mp4 (playwright driver needs ffmpeg)
  --tag <tag>              label for filtering; repeatable
  --purpose <id>           why it was recorded: one of the server's purposes (GET /api/config lists them)
  --person <spec>          someone related to it, role:email[:handle=value] (reviewer:ada@example.com); repeatable
  --source <p:ref>         link to the thing under test, e.g. github:owner/repo#12; repeatable
  --context-file <file>    JSON { app?, test?, sources?, fields? } from your test runner
  --context-schema <file>  JSON Schema that context.fields must satisfy (same file as the server's)
  --suite-id <id> --run-id <id>   attach the replay to a suite run
  --upload-url <url>       POST the finished replay to <server>/api/replays
  --header-file <file>     JSON object of headers for the upload (e.g. Authorization)
  --headed                 show the browser window (playwright driver)
  --config <file>          replays.config.* whose redaction rules apply (default: REPLAYS_CONFIG, else
                           replays.config.* in the working directory)`;

function parseViewport(value: string | undefined) {
  if (!value) return { width: 1440, height: 900 };
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(value);
  if (!match) throw new Error('--viewport must look like 1440x900');
  return { width: Number(match[1]), height: Number(match[2]) };
}

function assertCaptureUrl(value: string, flag: string) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error(`${flag} must use https (http only for localhost)`);
}

/**
 * The deployment's redaction rules, so a capture is cleaned the way the server will clean it on upload: the config's
 * `redaction` plus every plugin's `api.redaction`. The config is the server's (`--config`, else `REPLAYS_CONFIG`, else
 * `replays.config.*` in `cwd`); its plugins are imported and set up (registration only). Also reads capture defaults.
 */
async function loadCaptureSettings(
  options: { configFile?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ redaction?: RedactionRules | undefined; pacing?: CapturePacingOptions | undefined }> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig({ env: options.configFile ? { ...env, REPLAYS_CONFIG: options.configFile } : env, cwd });
  if (!config.path) return {};
  if (config.file.redaction !== undefined) assertRedactionRules(config.file.redaction, `${config.path} redaction`);
  const registry = await resolvePlugins(config.plugins, { env, cwd });
  const rules = mergeRedactionRules(config.file.redaction, registry.redaction);
  return { redaction: Object.keys(rules).length ? rules : undefined, pacing: config.file.capture };
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
  const id = assertReplayId(values.id ?? defaultId(values.url));
  const driver = (values.driver ?? 'playwright') as DriverName;
  if (driver !== 'playwright' && driver !== 'agent-browser') throw new Error('--driver must be playwright or agent-browser');
  const tags = lists.tag ?? [];
  if (tags.length) assertReplayTags(tags, '--tag');
  if (values.purpose !== undefined && !isPurposeId(values.purpose))
    throw new Error('--purpose must be a purpose id (lower-case letters, digits and "-")');
  const people = parsePeopleFlags(lists.person ?? []);
  if (Boolean(values['suite-id']) !== Boolean(values['run-id'])) throw new Error('--suite-id and --run-id must be used together');
  if (values['run-id'] && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(values['run-id'])) {
    throw new Error('--run-id must contain letters, digits, and hyphens');
  }
  const providers = new SourceProviders();
  const sources = (lists.source ?? []).map((spec) => providers.parse(spec));
  const schema: unknown = values['context-schema'] ? JSON.parse(await readFile(resolve(values['context-schema']), 'utf8')) : undefined;
  const context = await readContextFile(values['context-file']);
  const { redaction, pacing } = await loadCaptureSettings(values.config ? { configFile: values.config } : {});
  const pause = stepPauseMs(values['step-pause'] === undefined ? pacing?.stepPauseMs : Number(values['step-pause']));
  const args = {
    url: values.url,
    output: resolve(values.output),
    id,
    steps: await readSteps(values.steps),
    stepPauseMs: pause,
    video: booleans.has('video'),
    headed: booleans.has('headed'),
    driver,
    viewport: parseViewport(values.viewport),
    sources,
    tags,
    ...(values.purpose ? { purpose: values.purpose } : {}),
    ...(people.length ? { people } : {}),
    ...(values.title ? { title: values.title } : {}),
    ...(values['upload-url'] ? { uploadUrl: values['upload-url'] } : {}),
    ...(values['header-file'] ? { headerFile: values['header-file'] } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(schema !== undefined ? { contextSchema: schema } : {}),
    ...(redaction ? { redaction } : {}),
    ...(values['suite-id'] || values['run-id']
      ? { suiteRun: { suiteId: assertReplayId(values['suite-id'] ?? ''), runId: values['run-id'] ?? '' } }
      : {}),
  } satisfies CaptureArgs & { headed: boolean };
  // Fail before the browser starts: a bad context or source is a usage error, not a half-finished capture.
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

function quoted(value: string) {
  return value
    .trim()
    .replace(/^(["'])(.*)\1$/s, '$2')
    .trim();
}

/**
 * A readable name for a selector, for captions: `text=Save` → Save, `button[aria-label="Go to the Next Month"]`
 * → Go to the Next Month, `[data-tracking-id=holiday-calendar-add-date]` → holiday calendar add date. Undefined
 * when the selector names nothing a person would recognise.
 */
export function selectorName(selector: string) {
  const text = /^text=(.+)$/s.exec(selector.trim());
  if (text) return quoted(text[1]!) || undefined;
  for (const attribute of ['aria-label', 'title', 'placeholder', 'alt', 'name', 'data-tracking-id', 'data-testid']) {
    const matches = [...selector.matchAll(new RegExp(`\\[${attribute}=("[^"]*"|'[^']*'|[^\\]]*)\\]`, 'gi'))];
    const value = matches.length ? quoted(matches.at(-1)![1]!) : '';
    if (!value) continue;
    return attribute.startsWith('data-') || attribute === 'name' ? value.replace(/[-_]+/g, ' ').trim() : value;
  }
  const hasText = /:has-text\((["'])(.+?)\1\)/.exec(selector);
  return hasText?.[2]?.trim() || undefined;
}

export function labelFor(step: RawStep) {
  if (step.label) return step.label;
  const name = 'selector' in step ? selectorName(step.selector) : undefined;
  switch (step.kind) {
    case 'click':
      return name ? `Click “${name}”` : `Click ${step.selector}`;
    case 'hover':
      return `Hover ${name ? `“${name}”` : step.selector}`;
    case 'type':
      return `Type into ${name ? `“${name}”` : step.selector}`;
    case 'fill':
      return `Fill ${name ? `“${name}”` : step.selector}`;
    case 'press':
      return `Press ${step.key}`;
    case 'wait':
      return 'Wait for the page';
    case 'scroll':
      return `Scroll ${step.direction}`;
    case 'goto':
      return `Open ${new URL(step.url).hostname}`;
  }
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
    const cdp = await driver.launch({ viewport: args.viewport, harPath, ...(args.video ? { videoPath: rawVideoPath } : {}) });
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
        source: 'agent',
        ...(args.video ? { videoFile: 'session.mp4' } : {}),
        ...(args.tags.length ? { tags: args.tags } : {}),
        ...(args.purpose ? { purpose: args.purpose } : {}),
        ...(args.people?.length ? { people: args.people } : {}),
      },
      events: tracks.events,
      console: tracks.console,
      network: networkEntries(har, origin, args.redaction).sort((a, b) => a.at - b.at),
      steps,
      performance: tracks.performance,
      ...(context ? { context } : {}),
      ...(args.suiteRun ? { suiteRun: args.suiteRun } : {}),
    };
    // The host's rules over what the steps added too (labels, the title): the same pass the server runs on upload.
    if (args.redaction) bundle = sanitizeReplayBundle(bundle, args.redaction);
    const replayPath = join(args.output, 'replay.json');
    await writeFile(replayPath, `${JSON.stringify(bundle)}\n`, { flag: 'wx' });
    if (args.video) await copyFile(rawVideoPath, join(args.output, 'session.mp4'), constants.COPYFILE_EXCL);
    if (args.uploadUrl) await upload(bundle, args.output, args.uploadUrl, args.headerFile);
    return {
      replayPath,
      eventCount: tracks.events.length,
      requestCount: bundle.network.length,
      consoleCount: bundle.console.length,
      performanceCount: bundle.performance?.entries.length ?? 0,
      duration,
      video: args.video ? join(args.output, 'session.mp4') : undefined,
    };
  } finally {
    session?.dispose();
    await driver.close().catch(() => undefined);
    await rm(scratch, { recursive: true, force: true });
  }
}

/** `replays capture …`: prints one JSON line on success or failure (machine-readable for agents and CI). */
export async function runCaptureCli(argv: string[]) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${CAPTURE_USAGE}\n`);
    return;
  }
  try {
    const args = await parseArgs(argv);
    const result = await capture(args, createDriver(args.driver, { headed: args.headed }));
    process.stdout.write(`${JSON.stringify({ success: true, ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
