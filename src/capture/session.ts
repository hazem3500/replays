import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { ReplayConsoleEntry, ReplayPerformanceEntry, ReplayPerformanceTrack } from '../shared/replay.ts';
import { MAX_PERFORMANCE_ENTRIES } from '../shared/replay.ts';
import { compileRedaction, type RedactionRules } from '../shared/redaction.ts';
import { redactConsoleMessage, redactEvents, sanitizeEmbeddedUrls, sanitizeUrl, sanitizeUrlFields } from './sanitize.ts';

/** What the recorder needs from a Chrome DevTools Protocol connection: a Playwright `CDPSession` fits, and so does `CdpClient`. */
export interface CdpLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: Record<string, unknown>) => void): void;
  off(event: string, handler: (params: Record<string, unknown>) => void): void;
}

export interface RecorderChunk {
  events?: Array<Record<string, unknown> & { timestamp: number }>;
  console?: Array<{ at: number; level: string; message: string; url?: string }>;
  performance?: Array<{ at: number; kind: string; value: number; eventType?: string }>;
  performanceSupported?: string[];
}

const BINDING = '__replaysNavigationFlush';

/** The recorder page script (rrweb plus console, error and performance capture), bundled for the browser. */
export async function recorderSource() {
  // A built CLI ships the bundle next to itself (scripts/build-cli.mjs), the library in dist/lib (scripts/build-lib.mjs; its
  // shared chunks sit one level down); a checkout bundles it on demand.
  const prebuilt = ['./recorder.iife.js', '../recorder.iife.js']
    .map((relative) => fileURLToPath(new URL(relative, import.meta.url)))
    .find((candidate) => existsSync(candidate));
  if (prebuilt) return readFile(prebuilt, 'utf8');
  const file = fileURLToPath(new URL('./injected-recorder.ts', import.meta.url));
  const result = await build({
    entryPoints: [file],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: ['chrome120'],
    minify: true,
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('failed to build the rrweb recorder');
  return output.text;
}

/**
 * One pull at a time. A final flush requested while a pull is in flight runs
 * after that pull, instead of returning early and dropping the flush.
 */
export function createPullGate(run: (final: boolean) => Promise<void>) {
  let current: Promise<void> | undefined;
  let finalPending = false;
  return (final = false) => {
    if (final) finalPending = true;
    current ??= (async () => {
      try {
        do {
          const isFinal = finalPending;
          finalPending = false;
          await run(isFinal);
        } while (finalPending);
      } finally {
        current = undefined;
      }
    })();
    return current;
  };
}

/** The default URL pass, then the host's rules, then the default pass again (as sanitizeReplayBundle does). */
function consoleMessage(message: string, redaction: RedactionRules | undefined) {
  const clean = sanitizeEmbeddedUrls(message, redaction);
  return redaction ? sanitizeEmbeddedUrls(redactConsoleMessage(clean, redaction), redaction) : clean;
}

/** `redaction`: the host's rules (JSON keys and text patterns in the message, extra query parameters in URLs). */
export function normalizeConsole(entries: RecorderChunk['console'], origin: number, redaction?: RedactionRules): ReplayConsoleEntry[] {
  const levels = new Set(['debug', 'info', 'log', 'warn', 'error']);
  return (entries ?? []).map((entry) => ({
    at: Math.max(0, entry.at - origin),
    level: levels.has(entry.level) ? (entry.level as ReplayConsoleEntry['level']) : 'log',
    message: consoleMessage(entry.message.slice(0, 20_000), redaction),
    ...(entry.url ? { url: sanitizeUrl(entry.url, redaction) } : {}),
  }));
}

/**
 * The page script with the host's mask selectors set before it runs (rrweb `maskTextSelector`). The selector list is a
 * JSON string literal, never code.
 */
export function recorderScript(source: string, redaction?: RedactionRules) {
  const selectors = compileRedaction(redaction).maskSelectors;
  return selectors.length ? `window.__REPLAYS_MASK_TEXT__=${JSON.stringify(selectors.join(', '))};\n${source}` : source;
}

const performanceKinds = new Set<ReplayPerformanceEntry['kind']>([
  'first-contentful-paint',
  'largest-contentful-paint',
  'long-task',
  'slow-interaction',
]);
const performanceTypes = new Set(['paint', 'largest-contentful-paint', 'longtask', 'event']);
const performanceEventTypes = new Set(['click', 'keydown', 'keyup', 'input', 'beforeinput', 'pointerdown', 'pointerup', 'compositionend']);

export function normalizePerformance(
  entries: RecorderChunk['performance'],
  origin: number,
  limit = MAX_PERFORMANCE_ENTRIES,
): ReplayPerformanceEntry[] {
  return (entries ?? [])
    .filter(
      (entry) =>
        performanceKinds.has(entry.kind as ReplayPerformanceEntry['kind']) &&
        Number.isFinite(entry.at) &&
        Number.isFinite(entry.value) &&
        entry.value >= 0 &&
        (entry.eventType === undefined || performanceEventTypes.has(entry.eventType)),
    )
    .slice(0, Math.min(Math.max(0, limit), MAX_PERFORMANCE_ENTRIES))
    .map((entry) => ({
      at: Math.max(0, entry.at - origin),
      kind: entry.kind as ReplayPerformanceEntry['kind'],
      value: entry.value,
      ...(entry.eventType ? { eventType: entry.eventType } : {}),
    }))
    .sort((a, b) => a.at - b.at);
}

export interface RecordedTracks {
  events: Array<Record<string, unknown> & { timestamp: number }>;
  console: ReplayConsoleEntry[];
  performance: ReplayPerformanceTrack;
  /** The epoch (ms) of the first rrweb event: every other track is relative to it. */
  origin: number;
  duration: number;
}

/**
 * Records one browser page: registers the recorder with CDP before the first navigation, pulls event chunks every
 * second, and flushes a final chunk when the page hides. Works with any CDP connection (`CdpLike`), so it can sit
 * behind the capture CLI or inside a Playwright test:
 *
 *   const session = await RecorderSession.start(await context.newCDPSession(page));
 *   await page.goto(url);
 *   const tracks = await session.stop();
 */
export class RecorderSession {
  private readonly events: RecordedTracks['events'] = [];
  private readonly consoleEntries: NonNullable<RecorderChunk['console']> = [];
  private readonly performanceEntries: NonNullable<RecorderChunk['performance']> = [];
  private readonly performanceSupported = new Set<string>();
  private readonly pull: (final?: boolean) => Promise<void>;
  private timer: NodeJS.Timeout | undefined;
  private readonly onBinding = (params: Record<string, unknown>) => {
    if (params.name !== BINDING || typeof params.payload !== 'string') return;
    try {
      this.add(JSON.parse(params.payload) as RecorderChunk);
    } catch {
      /* a malformed page payload is ignored */
    }
  };

  private readonly cdp: CdpLike;
  private readonly redaction: RedactionRules | undefined;

  private constructor(cdp: CdpLike, redaction?: RedactionRules) {
    this.cdp = cdp;
    this.redaction = redaction;
    this.pull = createPullGate(async (final) => {
      try {
        const result = (await this.cdp.send('Runtime.evaluate', {
          expression: `window.__REPLAYS_FLUSH__?.(${final ? 'true' : ''})`,
          returnByValue: true,
        })) as { result?: { value?: RecorderChunk }; exceptionDetails?: unknown };
        if (!result.exceptionDetails) this.add(result.result?.value);
      } catch {
        // A navigation can replace the execution context between the timer tick and evaluate.
      }
    });
  }

  /**
   * `redaction`: the host's rules (src/shared/redaction.ts). Mask selectors go to the recorder in the page; the other
   * rules apply to the events and console entries as they are collected.
   */
  static async start(cdp: CdpLike, options: { pullIntervalMs?: number; redaction?: RedactionRules } = {}) {
    if (options.redaction) compileRedaction(options.redaction);
    const session = new RecorderSession(cdp, options.redaction);
    cdp.on('Runtime.bindingCalled', session.onBinding);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.addBinding', { name: BINDING });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: recorderScript(await recorderSource(), options.redaction) });
    session.timer = setInterval(() => void session.pull(), options.pullIntervalMs ?? 1000);
    return session;
  }

  private add(chunk: RecorderChunk | undefined) {
    if (!chunk) return;
    const events = (chunk.events ?? []).map((event) => sanitizeUrlFields(event, this.redaction));
    this.events.push(...(this.redaction ? sanitizeUrlFields(redactEvents(events, this.redaction), this.redaction) : events));
    this.consoleEntries.push(...(chunk.console ?? []));
    const remaining = Math.max(0, MAX_PERFORMANCE_ENTRIES - this.performanceEntries.length);
    this.performanceEntries.push(...(chunk.performance ?? []).slice(0, remaining));
    for (const type of chunk.performanceSupported ?? []) if (performanceTypes.has(type)) this.performanceSupported.add(type);
  }

  /** Pulls what the page has buffered now (call between steps so the events land on the right side of them). */
  flush(final = false) {
    return this.pull(final);
  }

  /** Final flush, then the three page-side tracks on one timeline. Throws when rrweb recorded nothing. */
  async stop(): Promise<RecordedTracks> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.pull(true);
    this.cdp.off('Runtime.bindingCalled', this.onBinding);
    this.events.sort((a, b) => a.timestamp - b.timestamp);
    if (this.events.length < 2) {
      const probe = (await this.cdp
        .send('Runtime.evaluate', {
          expression:
            '({ href: location.href, running: window.__REPLAYS_RUNNING__, flush: typeof window.__REPLAYS_FLUSH__, error: window.__REPLAYS_ERROR__ })',
          returnByValue: true,
        })
        .catch(() => undefined)) as { result?: { value?: unknown } } | undefined;
      throw new Error(`rrweb recorded fewer than two events (${JSON.stringify(probe?.result?.value ?? { context: 'unavailable' })})`);
    }
    const origin = this.events[0]!.timestamp;
    return {
      events: this.events,
      console: normalizeConsole(this.consoleEntries, origin, this.redaction).sort((a, b) => a.at - b.at),
      performance: {
        supported: [...this.performanceSupported].sort(),
        entries: normalizePerformance(this.performanceEntries, origin),
      },
      origin,
      duration: Math.max(1, this.events.at(-1)!.timestamp - origin),
    };
  }

  /** Stops timers and listeners without collecting (error paths). */
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.cdp.off('Runtime.bindingCalled', this.onBinding);
  }
}
