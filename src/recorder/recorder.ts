import { buildReplayBundle } from './bundle.ts';
import type { ReplayBundle } from './bundle-types.ts';
import { capturedRecord } from './capture-options.ts';
import { activationCheck, createWarner } from './recorder-checks.ts';
import { BLOCK_ATTRIBUTE, UI_ATTRIBUTE } from './privacy.ts';
import { recorderLimits } from './recorder-limits.ts';
import type { RecordingSettings } from './recorder-choices.ts';
import type { RecorderPrivacy } from './recorder-privacy.ts';
import { recordingSettings } from './recorder-settings.ts';
import { newSession, recordingSummary, type Session, visible, wireSession } from './recorder-session.ts';
import type { Recorder, RecorderOptions, RecorderState, RecordingChoice, RecordingSummary, RrwebModule } from './types.ts';
import type { IssueReport, IssueReportReceipt } from './upload.ts';
import { createUploadProgress } from './upload-progress.ts';
import { toUpload } from './http-upload.ts';
import { annotateSession, finishSessionExtras, snapshotContext } from './session-extras.ts';

export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_DURATION_MS,
  MAX_BYTES_CEILING,
  MAX_DURATION_CEILING_MS,
  MIN_DURATION_MS,
} from './recorder-limits.ts';
export { MASK_INPUT_OPTIONS } from './recorder-privacy.ts';
export { UI_ATTRIBUTE, BLOCK_ATTRIBUTE };

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

type Recording = {
  bundle: ReplayBundle;
  summary: RecordingSummary;
};

/**
 * Creates the recorder. Nothing is loaded or recorded until `start()` (or the
 * consent step of `request()`); rrweb is imported lazily at that point.
 */
export function createRecorder(options: RecorderOptions): Recorder {
  const ui = options.ui;
  const upload = toUpload(options.upload);
  const askForConsent = options.prompts?.consent !== false;
  const askToReview = options.prompts?.review !== false;
  const { maxDurationMs, maxBytes } = recorderLimits(options);
  const settings = recordingSettings(options);
  // invariant: replaced at each start() by that recording's own choice; nothing carries over.
  let active = settings.base;
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
  const warn = createWarner();
  const checkActivation = activationCheck(options, warn);
  const stops = new Map<Element, () => void>();

  // why: a function, so TypeScript does not narrow `state` across awaits.
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
        // why: a failing cleanup must not keep the others from running.
      }
    }
    session = undefined;
    for (const cleanup of stops.values()) cleanup();
    stops.clear();
  };

  // invariant: `discard()` and `destroy()` can close the open prompt.
  const openPrompt = () => {
    promptAbort?.abort();
    const abort = new AbortController();
    promptAbort = abort;
    return abort.signal;
  };

  const recorder: Recorder = {
    getState: () => state,
    annotateStep(step) {
      if (destroyed || state.status !== 'recording' || active.privacy.sanitize) return false;
      return annotateSession(session, step?.label, maxBytes);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async start(startOptions) {
      // why: checked at runtime too, since JavaScript callers can pass anything.
      if ((startOptions as { consent?: unknown }).consent !== true) {
        throw new Error('Recording needs the user’s explicit consent');
      }
      if (destroyed) throw new Error('The recorder was destroyed');
      checkActivation();
      settings.base.privacy.checkSelectors();
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

      // why: a failed body module only narrows the capture to headers; meta.captured says so.
      const bodyModule = settings.base.capture.network === 'bodies' ? import('./body-capture.ts').catch(() => null) : undefined;
      let rrweb: RrwebModule;
      let chosen: RecordingSettings;
      try {
        [chosen, rrweb] = await Promise.all([settings.resolve(startOptions.choice), loadRrweb()]);
      } catch (error) {
        if (generation !== lifecycleGeneration) return;
        setState({
          status: 'error',
          phase: 'start',
          error: toError(error),
        });
        throw error;
      }
      const bodies = await bodyModule;
      // why: discard() or destroy() may have run while rrweb was loading.
      if (generation !== lifecycleGeneration || currentState().status !== 'starting') return;
      active = chosen;
      const { capture, privacy } = chosen;

      const startedAt = Date.now();
      const current = newSession(
        trigger,
        capturedRecord(capture, Boolean(bodies), !privacy.sanitize, chosen.by === 'customer' ? chosen.mode : undefined),
        startedAt,
      );
      if (!privacy.sanitize) {
        const context = snapshotContext(options.context, startedAt, warn);
        if (context) current.context = context;
      }
      session = current;
      try {
        wireSession(current, {
          rrweb,
          bodies,
          capture,
          privacy,
          options,
          limits: { maxDurationMs, maxBytes },
          isCurrent: () => session === current,
          stop: (reason) => recorder.stop(reason),
          attestStop: (element) => recorder.attestStop(element),
        });
      } catch (error) {
        teardownSession();
        setState({
          status: 'error',
          phase: 'start',
          error: toError(error),
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
        // invariant: never upload something the user did not get to review.
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
          captured: current.captured,
          ...(active.profile ? { profile: active.profile } : {}),
        });
        finishSessionExtras(bundle, current);
        const summary = recordingSummary(bundle, current.bytes, reason);
        recording = { bundle, summary };
        setState({ status: 'review', summary });
        return summary;
      } catch (error) {
        recording = undefined;
        setState({
          status: 'error',
          phase: 'start',
          error: toError(error),
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
        const receipt: IssueReportReceipt = await upload(reviewedReport, {
          signal: abort.signal,
          onProgress: (value) => progress.update(value),
        });
        if (abort.signal.aborted || generation !== lifecycleGeneration) throw new Error('Upload was discarded');
        recording = undefined;
        reviewedReport = undefined;
        setState({ status: 'uploaded', receipt });
        return receipt;
      } catch (error) {
        const failure = toError(error);
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
      // why: in the one-click flow a failed upload stays behind a Retry toast; pressing Record again drops it and starts over.
      if (!askToReview && state.status === 'error' && state.phase === 'upload') recorder.discard();
      if (destroyed || !['idle', 'uploaded', 'error'].includes(state.status) || (state.status === 'error' && state.phase === 'upload')) {
        return;
      }
      const generation = ++requestGeneration;
      const ownsRequest = () => generation === requestGeneration;
      const product = options.app?.name;
      const facts = (privacy: RecorderPrivacy) => ({ ...privacy.facts(maxDurationMs, askToReview), ...(product ? { product } : {}) });
      // why: hosts without `choices` keep a synchronous move to the consent state.
      const choices = options.choices ? await settings.choices() : undefined;
      if (!ownsRequest()) return;
      const offer = ui.chooseOptions && choices?.offer(facts);
      let choice: RecordingChoice | undefined;
      if (offer && ui.chooseOptions) {
        setState({ status: 'consent', trigger });
        const picked = await ui.chooseOptions({ trigger, offer, signal: openPrompt() }).catch(() => undefined);
        if (!ownsRequest() || currentState().status !== 'consent') return;
        if (!picked) {
          setState({ status: 'idle' });
          return;
        }
        choice = choices?.accept(picked);
      }
      if (askForConsent) {
        if (currentState().status !== 'consent') setState({ status: 'consent', trigger });
        const agreed = await ui
          .requestConsent({
            trigger,
            maxDurationMs,
            privacy: facts((choices?.settings(choice) ?? settings.base).privacy),
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
        await recorder.start({ consent: true, trigger, ...(choice ? { choice } : {}) });
      } catch (error) {
        if (!ownsRequest()) return;
        resolveStopWaiters();
        if (currentState().status !== 'error') setState({ status: 'error', phase: 'start', error: toError(error) });
        ui.showResult?.({
          status: 'error',
          error: toError(error),
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

      // why: a failed upload shows a Retry that sends the same reviewed payload again.
      const withRetry = (send: () => Promise<IssueReportReceipt | undefined>): Promise<IssueReportReceipt | undefined> =>
        send().catch((error: unknown): IssueReportReceipt | undefined => {
          if (!ownsRequest() || currentState().status !== 'error') return;
          ui.showResult?.({ status: 'error', error: toError(error), retry: () => void withRetry(send) });
          return;
        });

      if (!askToReview) {
        if (!ownsRequest()) return;
        const current = currentState();
        if (current.status !== 'review') {
          if (current.status === 'error') ui.showResult?.({ status: 'error', error: current.error });
          recorder.discard();
          return;
        }
        // why: finishing the recording is the upload confirmation.
        return withRetry(() => sendReviewed());
      }

      const current = currentState();
      if (!ownsRequest() || current.status !== 'review') return;
      const decision = await ui
        .confirmUpload({ summary: current.summary, privacy: facts(active.privacy), signal: openPrompt() })
        .catch(() => ({ confirmed: false }) as const);
      if (!ownsRequest()) return;
      if (!decision.confirmed) {
        recorder.discard();
        return;
      }
      // why: the upload was already reviewed, so a network retry sends the same payload and note without asking again.
      return withRetry(() => sendReviewed(decision.note));
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
