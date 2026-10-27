import { buildReplayBundle, type RawStep } from './bundle.ts';
import type { ReplayBundle, ReplayRrwebEvent } from './bundle-types.ts';
import { captureConsole, captureNetwork, type RawConsoleEntry, type RawNetworkEntry } from './capture.ts';
import { DEFAULT_ALLOWED_HEADERS, maskText } from './redact.ts';
import { createAttributeMasker } from './sanitize-events.ts';
import type { Recorder, RecorderOptions, RecorderState, RecorderTrigger, RecordingSummary, RrwebModule } from './types.ts';
import type { IssueReport, IssueReportReceipt } from './upload.ts';

import { UI_ATTRIBUTE, BLOCK_ATTRIBUTE } from './privacy.ts';

import { createUploadProgress } from './upload-progress.ts';

export const DEFAULT_MAX_DURATION_MS = 3 * 60_000;
export const MAX_DURATION_CEILING_MS = 10 * 60_000;
export const MIN_DURATION_MS = 5_000;
export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
export const MAX_BYTES_CEILING = 20 * 1024 * 1024;
const MAX_CONSOLE_ENTRIES = 500;
const MAX_NETWORK_ENTRIES = 1_000;

export { UI_ATTRIBUTE, BLOCK_ATTRIBUTE };

const MEDIA_SELECTOR = 'img, picture, video, audio, canvas, iframe, object, embed';

/**
 * Rrweb's `maskAllInputs` set plus hidden inputs (CSRF tokens). Same set as
 * Replays' `MASK_INPUT_OPTIONS`.
 */
export const MASK_INPUT_OPTIONS = {
  color: true,
  date: true,
  'datetime-local': true,
  email: true,
  hidden: true,
  month: true,
  number: true,
  password: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
  textarea: true,
  select: true,
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Throws on an invalid selector. rrweb swallows the error `matches()` throws,
 * so an invalid privacy selector would silently block or mask nothing.
 */
function assertSelector(option: string, selector: string | undefined) {
  if (!selector) return;
  try {
    document.createDocumentFragment().querySelector(selector);
  } catch {
    throw new Error(`privacy.${option} is not a valid CSS selector: ${selector}`);
  }
}

function matchesAny(url: string, patterns: (string | RegExp)[]) {
  return patterns.some((pattern) => (typeof pattern === 'string' ? url.startsWith(pattern) : pattern.test(url)));
}

type Session = {
  trigger: RecorderTrigger;
  events: ReplayRrwebEvent[];
  console: RawConsoleEntry[];
  network: RawNetworkEntry[];
  steps: RawStep[];
  bytes: number;
  startedAt: number;
  cleanups: (() => void)[];
};

type Recording = {
  bundle: ReplayBundle;
  summary: RecordingSummary;
};

const visible = (element: Element) => {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    (typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
  );
};

/**
 * Creates the recorder. Nothing is loaded or recorded until `start()` (or the
 * consent step of `request()`); rrweb is imported lazily at that point.
 */
export function createRecorder(options: RecorderOptions): Recorder {
  const ui = options.ui;
  const askForConsent = options.prompts?.consent !== false;
  const askToReview = options.prompts?.review !== false;
  const maxDurationMs = clamp(options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS, MIN_DURATION_MS, MAX_DURATION_CEILING_MS);
  const maxBytes = clamp(options.maxBytes ?? DEFAULT_MAX_BYTES, 1024, MAX_BYTES_CEILING);
  const privacy = options.privacy ?? {};
  const loadRrweb = options.loadRrweb ?? (() => import('rrweb'));
  const title = options.title ?? (options.app ? `Issue report from ${options.app.name}` : 'Issue report from Replays');

  let state: RecorderState = { status: 'idle' };
  const listeners = new Set<(state: RecorderState) => void>();
  let session: Session | undefined;
  let recording: Recording | undefined;
  let reportContext: Pick<IssueReport, 'crisp' | 'metadata'> = {};
  let uploadAbort: AbortController | undefined;
  let promptAbort: AbortController | undefined;
  let stopWaiters: (() => void)[] = [];
  let destroyed = false;
  let lifecycleGeneration = 0;
  let requestGeneration = 0;
  let reviewedReport: IssueReport | undefined;
  const warnings = new Set<string>();
  const warn = (message: string) => {
    if (!warnings.has(message)) {
      warnings.add(message);
      console.warn(`[replays recorder] ${message}`);
    }
  };
  const checkActivation = () => {
    const activation =
      options.activation ??
      (typeof navigator !== 'undefined' && navigator?.userActivation ? () => navigator.userActivation.isActive : undefined);
    if (!activation) {
      warn('User activation API unavailable; check skipped');
      return;
    }
    if (!activation()) {
      if (options.strictInvariants) throw new Error('A user activation is required');
      warn('A user activation is required (warn-only migration)');
    }
  };
  const stops = new Map<Element, () => void>();

  // A function, so TypeScript does not narrow `state` across awaits.
  const currentState = (): RecorderState => state;
  const setState = (next: RecorderState) => {
    state = next;
    for (const listener of Array.from(listeners)) listener(next);
  };

  const resolveStopWaiters = () => {
    const waiters = stopWaiters;
    stopWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const teardownSession = () => {
    if (!session) return;
    for (const cleanup of session.cleanups.splice(0).toReversed()) {
      try {
        cleanup();
      } catch {
        // A failing cleanup must not keep the others from running.
      }
    }
    session = undefined;
    for (const cleanup of stops.values()) cleanup();
    stops.clear();
  };

  const blockSelector = [
    `[${UI_ATTRIBUTE}]`,
    `[${BLOCK_ATTRIBUTE}]`,
    ...(privacy.blockMedia === false ? [] : [MEDIA_SELECTOR]),
    ...(privacy.blockSelector ? [privacy.blockSelector] : []),
  ].join(', ');
  const sanitize = privacy.sanitize !== false;
  const maskAllText = sanitize && privacy.maskAllText !== false;
  const unmask = privacy.unmaskTextSelector;
  const maskSelector = privacy.maskTextSelector;
  // Same rule as rrweb's text masking; an unknown element is masked.
  const textMasked = (element: Element | undefined) => {
    if (maskAllText) {
      if (!unmask || !element) return true;
      return element.closest(unmask) === null;
    }
    if (!maskSelector) return false;
    if (!element) return true;
    return element.closest(maskSelector) !== null;
  };

  let selectorsChecked = false;
  const checkSelectors = () => {
    // Without a DOM (server rendering) the check runs on the first start().
    if (selectorsChecked || typeof document === 'undefined') return;
    assertSelector('blockSelector', privacy.blockSelector);
    assertSelector('maskTextSelector', privacy.maskTextSelector);
    assertSelector('unmaskTextSelector', privacy.unmaskTextSelector);
    selectorsChecked = true;
  };
  checkSelectors();

  /** A prompt `discard()` and `destroy()` can close. */
  const openPrompt = () => {
    promptAbort?.abort();
    const abort = new AbortController();
    promptAbort = abort;
    return abort.signal;
  };

  const recorder: Recorder = {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async start(startOptions) {
      // Checked at runtime too: JavaScript callers can pass anything.
      if ((startOptions as { consent?: unknown }).consent !== true) {
        throw new Error('Recording needs the user’s explicit consent');
      }
      if (destroyed) throw new Error('The recorder was destroyed');
      checkActivation();
      checkSelectors();
      if (
        state.status !== 'idle' &&
        state.status !== 'consent' &&
        state.status !== 'uploaded' &&
        !(state.status === 'error' && state.phase === 'start')
      ) {
        throw new Error(`Cannot start while ${state.status}`);
      }
      const trigger = startOptions.trigger ?? { source: 'user' };
      const generation = ++lifecycleGeneration;
      recording = undefined;
      reviewedReport = undefined;
      setState({ status: 'starting', trigger });

      let rrweb: RrwebModule;
      try {
        rrweb = await loadRrweb();
      } catch (error) {
        if (generation !== lifecycleGeneration) return;
        setState({
          status: 'error',
          phase: 'start',
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }
      // discard() or destroy() while rrweb was loading.
      if (generation !== lifecycleGeneration || currentState().status !== 'starting') return;

      const startedAt = Date.now();
      const current: Session = {
        trigger,
        events: [],
        console: [],
        network: [],
        steps: [{ at: startedAt, kind: 'start', label: 'Recording started' }],
        bytes: 0,
        startedAt,
        cleanups: [],
      };
      session = current;

      try {
        const levels = privacy.consoleLevels ?? ['warn', 'error'];
        if (levels.length) {
          current.cleanups.push(
            captureConsole({
              levels,
              maxEntries: MAX_CONSOLE_ENTRIES,
              onEntry: (entry) => current.console.push(entry),
            }),
          );
        }
        if (privacy.captureNetwork !== false) {
          const ignore = options.ignoreUrls ?? [];
          current.cleanups.push(
            captureNetwork({
              allowedHeaders: privacy.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
              maxEntries: MAX_NETWORK_ENTRIES,
              ignore: (url) => matchesAny(url, ignore),
              onEntry: (entry) => current.network.push(entry),
            }),
          );
        }

        const mirror = rrweb.record.mirror;
        // rrweb masks text nodes only; attributes get the same mask here.
        const maskAttributes = createAttributeMasker({
          element: (id) => {
            const node = mirror?.getNode(id);
            return node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : undefined;
          },
          textMasked,
          sanitize,
          ...(privacy.unmaskAttributes ? { allowed: privacy.unmaskAttributes } : {}),
        });

        const stopRrweb = rrweb.record({
          emit(raw: ReplayRrwebEvent) {
            if (session !== current) return;
            const event = maskAttributes(raw);
            current.events.push(event);
            current.bytes += JSON.stringify(event).length;
            if (current.bytes > maxBytes) {
              queueMicrotask(() => {
                if (session === current) recorder.stop('max-size');
              });
            }
          },
          maskAllInputs: sanitize,
          maskInputOptions: sanitize ? MASK_INPUT_OPTIONS : { password: true, hidden: true },
          // Every character, spaces included (same as Replays' server pass).
          maskInputFn: (text: string) => '*'.repeat(text.length),
          ...(maskAllText ? { maskTextSelector: '*' } : privacy.maskTextSelector ? { maskTextSelector: privacy.maskTextSelector } : {}),
          maskTextFn: (text: string, element: HTMLElement | null) => (unmask && element?.closest(unmask) ? text : maskText(text)),
          blockSelector,
          recordCanvas: false,
          recordCrossOriginIframes: false,
          collectFonts: false,
          inlineImages: false,
          sampling: { input: 'last', scroll: 150, mousemove: 50 },
        });
        if (stopRrweb) current.cleanups.push(stopRrweb);

        const timer = setTimeout(() => {
          if (session === current) recorder.stop('max-duration');
        }, maxDurationMs);
        current.cleanups.push(() => clearTimeout(timer));

        // Leaving the page ends the recording; it is never resumed or stored.
        const onPageHide = () => {
          if (session === current) recorder.stop('page-hidden');
        };
        addEventListener('pagehide', onPageHide);
        current.cleanups.push(() => removeEventListener('pagehide', onPageHide));

        if (ui)
          current.cleanups.push(
            ui.showIndicator({
              startedAt,
              maxDurationMs,
              attestStop: (element) => recorder.attestStop(element),
              stop: () => {
                if (session === current) recorder.stop('user');
              },
            }),
          );
      } catch (error) {
        teardownSession();
        setState({
          status: 'error',
          phase: 'start',
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }

      setState({ status: 'recording', trigger, startedAt, maxDurationMs });
      const checkStop = () => {
        if (session !== current || [...stops.keys()].some(visible)) return;
        if (options.strictInvariants) recorder.stop('no-indicator');
        else warn('Register a visible Stop control with attestStop (warn-only migration)');
      };
      const grace = setTimeout(() => {
        checkStop();
        if (session === current) {
          const monitor = setInterval(checkStop, 2000);
          current.cleanups.push(() => clearInterval(monitor));
        }
      }, options.indicatorGraceMs ?? 1000);
      current.cleanups.push(() => clearTimeout(grace));
    },

    stop(requestedReason = 'user') {
      let reason = requestedReason;
      const current = session;
      if (!current || state.status !== 'recording') return;
      // invariant: A quick stop must not bypass the grace-period evidence check.
      if (![...stops.keys()].some(visible) && reason !== 'page-hidden') {
        if (options.strictInvariants) reason = 'no-indicator';
        else warn('Register a visible Stop control with attestStop (warn-only migration)');
      }
      const stoppedAt = Date.now();
      current.steps.push({
        at: stoppedAt,
        kind: 'stop',
        label: reason === 'user' ? 'Recording stopped' : `Recording stopped (${reason})`,
      });
      teardownSession();

      if (reason === 'page-hidden' || reason === 'no-indicator') {
        // Never upload something the user did not get to review.
        recording = undefined;
        setState({ status: 'idle' });
        resolveStopWaiters();
        return;
      }

      try {
        const bundle = buildReplayBundle({
          title,
          events: current.events,
          console: current.console,
          network: current.network,
          steps: current.steps,
        });
        const summary: RecordingSummary = {
          durationMs: bundle.meta.duration,
          eventCount: bundle.events.length,
          consoleErrors: bundle.console.filter((entry) => entry.level === 'error').length,
          failedRequests: bundle.network.filter((entry) => entry.status >= 400 || entry.status === 0).length,
          approxBytes: current.bytes,
          stopReason: reason,
        };
        recording = { bundle, summary };
        setState({ status: 'review', summary });
        return summary;
      } catch (error) {
        recording = undefined;
        setState({
          status: 'error',
          phase: 'start',
          error: error instanceof Error ? error : new Error(String(error)),
        });
        return;
      } finally {
        resolveStopWaiters();
      }
    },

    async upload(uploadOptions) {
      if ((uploadOptions as { confirmed?: unknown }).confirmed !== true) {
        throw new Error('Uploading needs the user’s explicit confirmation');
      }
      checkActivation();
      const current = recording;
      if (!current || (state.status !== 'review' && !(state.status === 'error' && state.phase === 'upload'))) {
        throw new Error('There is no recording to upload');
      }
      const note = uploadOptions.note?.trim().slice(0, 2_000);
      const generation = lifecycleGeneration;
      const abort = new AbortController();
      uploadAbort = abort;
      setState({ status: 'uploading', summary: current.summary });
      const progress = createUploadProgress({
        summary: current.summary,
        state: currentState,
        setState,
        valid: () => !abort.signal.aborted && generation === lifecycleGeneration,
      });
      reviewedReport ??= {
        bundle: current.bundle,
        ...(note ? { note } : {}),
        ...reportContext,
        ...(options.app ? { app: options.app } : {}),
      };
      try {
        const receipt: IssueReportReceipt = await options.upload(reviewedReport, {
          signal: abort.signal,
          onProgress: (value) => progress.update(value),
        });
        if (abort.signal.aborted || generation !== lifecycleGeneration) throw new Error('Upload was discarded');
        recording = undefined;
        reviewedReport = undefined;
        setState({ status: 'uploaded', receipt });
        return receipt;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (!abort.signal.aborted && generation === lifecycleGeneration) {
          setState({
            status: 'error',
            phase: 'upload',
            error: failure,
            summary: current.summary,
          });
        }
        throw failure;
      } finally {
        progress.dispose();
        if (uploadAbort === abort) uploadAbort = undefined;
      }
    },

    discard() {
      lifecycleGeneration++;
      requestGeneration++;
      ui?.dismiss?.();
      uploadAbort?.abort();
      uploadAbort = undefined;
      promptAbort?.abort();
      promptAbort = undefined;
      teardownSession();
      recording = undefined;
      reviewedReport = undefined;
      if (state.status !== 'idle') setState({ status: 'idle' });
      resolveStopWaiters();
    },

    respond(decision) {
      ui?.respond?.(decision);
    },
    retryUpload() {
      return recorder.upload({ confirmed: true });
    },
    getProgress() {
      return session ? { bytes: session.bytes, maxBytes, events: session.events.length } : undefined;
    },
    attestStop(element) {
      if (!session) throw new Error('Stop controls can only be registered while recording');
      const owner = session;
      const onClick = () => {
        if (session === owner) recorder.stop('user');
      };
      stops.get(element)?.();
      element.addEventListener('click', onClick);
      const cleanup = () => {
        element.removeEventListener('click', onClick);
        if (stops.get(element) === cleanup) stops.delete(element);
      };
      stops.set(element, cleanup);
      return cleanup;
    },

    async request(trigger = { source: 'user' }) {
      if (!ui) throw new Error('Pass ui (from @hazem3500/replays/recorder/ui) or use createGuidedRecorder');
      // In the one-click flow a failed upload stays behind a Retry toast;
      // pressing Record again drops it and starts over.
      if (!askToReview && state.status === 'error' && state.phase === 'upload') recorder.discard();
      if (destroyed || !['idle', 'uploaded', 'error'].includes(state.status) || (state.status === 'error' && state.phase === 'upload')) {
        return;
      }
      const generation = ++requestGeneration;
      const ownsRequest = () => generation === requestGeneration;
      if (askForConsent) {
        setState({ status: 'consent', trigger });
        const agreed = await ui
          .requestConsent({
            trigger,
            maxDurationMs,
            privacy: {
              mode: sanitize && maskAllText ? 'masked' : 'visible',
              maxDurationMs,
              reviewRequired: askToReview,
              captures: {
                pageText: !maskAllText || !!unmask,
                inputs: !sanitize,
                media: privacy.blockMedia === false,
                console: (privacy.consoleLevels?.length ?? 2) > 0,
                network: privacy.captureNetwork !== false,
              },
            },
            signal: openPrompt(),
          })
          .catch(() => false);
        if (!ownsRequest() || currentState().status !== 'consent') return;
        if (!agreed) {
          setState({ status: 'idle' });
          return;
        }
      }

      const stopped = new Promise<void>((resolve) => stopWaiters.push(resolve));
      try {
        await recorder.start({ consent: true, trigger });
      } catch (error) {
        if (!ownsRequest()) return;
        resolveStopWaiters();
        if (currentState().status !== 'error')
          setState({ status: 'error', phase: 'start', error: error instanceof Error ? error : new Error(String(error)) });
        ui.showResult?.({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        });
        return;
      }
      if (!ownsRequest()) return;
      await stopped;
      if (!ownsRequest()) return;

      const sendReviewed = async (note?: string) => {
        if (!ownsRequest()) return;
        const hide = ui.showUploading?.();
        try {
          const receipt = await recorder.upload({
            confirmed: true,
            ...(note ? { note } : {}),
          });
          if (ownsRequest()) {
            hide?.();
            ui.showResult?.({ status: 'uploaded', receipt });
          }
          return receipt;
        } catch (error) {
          if (ownsRequest()) hide?.();
          throw error;
        }
      };

      if (!askToReview) {
        if (!ownsRequest()) return;
        const current = currentState();
        if (current.status !== 'review') {
          if (current.status === 'error') ui.showResult?.({ status: 'error', error: current.error });
          recorder.discard();
          return;
        }
        // Finishing the recording is the upload confirmation.
        const attempt = (): Promise<IssueReportReceipt | undefined> =>
          sendReviewed().catch((error: unknown): IssueReportReceipt | undefined => {
            if (!ownsRequest() || currentState().status !== 'error') return;
            ui.showResult?.({
              status: 'error',
              error: error instanceof Error ? error : new Error(String(error)),
              retry: () => void attempt(),
            });
            return;
          });
        return attempt();
      }

      const current = currentState();
      if (!ownsRequest() || current.status !== 'review') return;
      const decision = await ui
        .confirmUpload({ summary: current.summary, signal: openPrompt() })
        .catch(() => ({ confirmed: false }) as const);
      if (!ownsRequest()) return;
      if (!decision.confirmed) {
        recorder.discard();
        return;
      }
      // The upload was already reviewed. A network retry sends the same
      // payload/note without requiring consent or review a second time.
      const attempt = (): Promise<IssueReportReceipt | undefined> =>
        sendReviewed(decision.note).catch((error: unknown): IssueReportReceipt | undefined => {
          if (!ownsRequest() || currentState().status !== 'error') return;
          ui.showResult?.({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
            retry: () => void attempt(),
          });
          return;
        });
      return attempt();
    },

    setReportContext(context) {
      reportContext = structuredClone({ ...reportContext, ...context });
    },

    destroy() {
      recorder.discard();
      destroyed = true;
      listeners.clear();
    },
  };

  return recorder;
}
