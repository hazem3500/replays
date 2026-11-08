import { captureFramePacing } from './frame-pacing.ts';
import { capturePerformance } from './diagnostics.ts';
import type { ReplayPerformanceTrack } from '../shared/replay.ts';
import { captureInteractionSteps } from './interaction-steps.ts';
import type * as BodyCapture from './body-capture.ts';
import type { RawStep } from './bundle.ts';
import type { ReplayBundle, ReplayCaptured, ReplayRrwebEvent } from './bundle-types.ts';
import type { ResolvedCapture } from './capture-options.ts';
import { captureConsole, captureNetwork, type RawConsoleEntry, type RawNetworkEntry } from './capture.ts';
import { MAX_CONSOLE_ENTRIES, MAX_NETWORK_ENTRIES } from './recorder-limits.ts';
import type { RecorderPrivacy } from './recorder-privacy.ts';
import { DEFAULT_ALLOWED_HEADERS } from './redact.ts';
import { createAttributeMasker } from './sanitize-events.ts';
import type { RecorderOptions, RecorderTrigger, RecordingSummary, RrwebModule, StopReason } from './types.ts';

/** One recording in progress: what it captured so far, and what to undo when it ends. */
export type Session = {
  trigger: RecorderTrigger;
  events: ReplayRrwebEvent[];
  console: RawConsoleEntry[];
  network: RawNetworkEntry[];
  steps: RawStep[];
  bytes: number;
  startedAt: number;
  captured: ReplayCaptured;
  performance?: ReplayPerformanceTrack;
  context?: import('../shared/context.ts').ReplayContext;
  cleanups: Array<() => void>;
};

/** The optional network-body module, loaded only when bodies are captured. */
export type BodyModule = typeof BodyCapture;

export function newSession(trigger: RecorderTrigger, captured: ReplayCaptured, startedAt: number): Session {
  return {
    trigger,
    events: [],
    console: [],
    network: [],
    steps: [{ at: startedAt, kind: 'start', label: 'Recording started' }],
    bytes: 0,
    startedAt,
    captured,
    cleanups: [],
  };
}

/** What a finished recording is shown as before the user decides to upload it. */
export function recordingSummary(bundle: ReplayBundle, approxBytes: number, stopReason: StopReason): RecordingSummary {
  return {
    durationMs: bundle.meta.duration,
    eventCount: bundle.events.length,
    consoleErrors: bundle.console.filter((entry) => entry.level === 'error').length,
    failedRequests: bundle.network.filter((entry) => entry.status >= 400 || entry.status === 0).length,
    approxBytes,
    stopReason,
  };
}

/** Whether a registered Stop control can actually be seen and used. */
export const visible = (element: Element): boolean => {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    (typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
  );
};

const isElement = (node: Node | null | undefined): node is Element => node?.nodeType === Node.ELEMENT_NODE;
const matchesAny = (url: string, patterns: ReadonlyArray<string | RegExp>): boolean =>
  patterns.some((pattern) => (typeof pattern === 'string' ? url.startsWith(pattern) : pattern.test(url)));

/** Everything a session's capture is wired to: the recorder's settings and its way to stop this session. */
export interface SessionWiring {
  rrweb: RrwebModule;
  bodies: BodyModule | null | undefined;
  capture: ResolvedCapture;
  privacy: RecorderPrivacy;
  options: Pick<RecorderOptions, 'ignoreUrls' | 'privacy' | 'ui'>;
  limits: { maxDurationMs: number; maxBytes: number };
  /** True while `current` is still the recorder's session. */
  isCurrent: () => boolean;
  stop: (reason: StopReason) => void;
  attestStop: (element: Element) => () => void;
}

function wireNetwork(current: Session, wiring: SessionWiring, grow: (bytes: number) => void): void {
  const { capture, options, bodies } = wiring;
  const ignore = options.ignoreUrls ?? [];
  const bodyCapture = bodies?.createBodyCapture({ limits: capture.bodies, maskEmails: capture.maskAllText, onBytes: grow });
  current.cleanups.push(
    captureNetwork({
      allowedHeaders: options.privacy?.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
      maxEntries: MAX_NETWORK_ENTRIES,
      ignore: (url) => matchesAny(url, ignore),
      onEntry: (entry) => current.network.push(entry),
      ...(bodyCapture ? { bodies: bodyCapture } : {}),
    }),
  );
}

/** invariant: rrweb masks text nodes only; attributes of masked elements get the same mask before an event is kept. */
function wireRrweb(current: Session, wiring: SessionWiring, grow: (bytes: number) => void): void {
  const { rrweb, privacy, options } = wiring;
  const mirror = rrweb.record.mirror;
  const maskAttributes = createAttributeMasker({
    element: (id) => {
      const node = mirror?.getNode(id);
      return isElement(node) ? node : undefined;
    },
    textMasked: privacy.textMasked,
    sanitize: privacy.sanitize,
    ...(options.privacy?.unmaskAttributes ? { allowed: options.privacy.unmaskAttributes } : {}),
  });
  const stopRrweb = rrweb.record({
    emit(raw: ReplayRrwebEvent) {
      if (!wiring.isCurrent()) return;
      const event = maskAttributes(raw);
      current.events.push(event);
      grow(JSON.stringify(event).length);
    },
    ...privacy.rrwebOptions(),
    recordCanvas: false,
    recordCrossOriginIframes: false,
    collectFonts: false,
    inlineImages: false,
    sampling: { input: 'last', scroll: 150, mousemove: 50 },
  });
  if (stopRrweb) current.cleanups.push(stopRrweb);
}

/** why: leaving the page ends the recording; it is never resumed or stored. */
function wireEnds(current: Session, wiring: SessionWiring): void {
  const { limits, options } = wiring;
  const stopIfCurrent = (reason: StopReason) => () => {
    if (wiring.isCurrent()) wiring.stop(reason);
  };
  const timer = setTimeout(stopIfCurrent('max-duration'), limits.maxDurationMs);
  current.cleanups.push(() => clearTimeout(timer));
  const onPageHide = stopIfCurrent('page-hidden');
  addEventListener('pagehide', onPageHide);
  current.cleanups.push(() => removeEventListener('pagehide', onPageHide));
  if (options.ui) {
    const stop = stopIfCurrent('user');
    current.cleanups.push(
      options.ui.showIndicator({ startedAt: current.startedAt, maxDurationMs: limits.maxDurationMs, attestStop: wiring.attestStop, stop }),
    );
  }
}

/** Starts the session's console, network and DOM capture, its limits and its indicator; each pushes its cleanup. */
export function wireSession(current: Session, wiring: SessionWiring): void {
  const grow = (bytes: number) => {
    // oxlint-disable-next-line eslint/no-param-reassign -- why: the session is the recorder's running tally of this recording.
    current.bytes += bytes;
    if (current.bytes <= wiring.limits.maxBytes) return;
    queueMicrotask(() => {
      if (wiring.isCurrent()) wiring.stop('max-size');
    });
  };
  if (wiring.capture.performance) {
    const diagnostic = capturePerformance((entry) => {
      if (!wiring.isCurrent()) return;
      diagnostic.track.entries.push(entry);
      grow(JSON.stringify(entry).length);
    }, grow);
    current.performance = diagnostic.track;
    current.cleanups.push(diagnostic.stop, captureFramePacing(diagnostic.track, grow));
  }
  if (wiring.capture.consoleLevels.length) {
    current.cleanups.push(
      captureConsole({
        debugging: wiring.capture.debugging && !wiring.privacy.sanitize,
        levels: wiring.capture.consoleLevels,
        maxEntries: MAX_CONSOLE_ENTRIES,
        onEntry: (entry) => current.console.push(entry),
      }),
    );
  }
  if (wiring.capture.network !== 'off') wireNetwork(current, wiring, grow);
  wireRrweb(current, wiring, grow);
  current.cleanups.push(
    captureInteractionSteps(wiring.privacy, (step) => {
      if (!wiring.isCurrent()) return;
      current.steps.push(step);
      grow(JSON.stringify(step).length);
    }),
  );
  wireEnds(current, wiring);
}
