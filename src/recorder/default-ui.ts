import type { CompletionContext, DefaultUiOptions, ReceiptValue, RecorderTheme } from './default-ui-types.ts';
import { element, link, safeHref } from './default-ui-dom.ts';
import { appendCompletionControls } from './completion-controls.ts';
import { DEFAULT_UI_STYLES } from './default-ui-styles.ts';
import { icon } from './default-ui-icons.ts';
import { RECORDER_THEME_PRESETS } from './default-ui-themes.ts';
import { createRecorderFormat } from './format.ts';
import { focusReturn, trapFocus } from './kit/index.ts';
import { resolveRecorderMessages } from './messages.ts';
import { createUploadActivity } from './upload-activity.ts';
import { createStatusSpinner } from './status-spinner.ts';
import { uploadRecovery } from './upload-recovery.ts';
import { startRecordingPulse } from './recording-pulse.ts';
import { cleanupText, updateText } from './text-motion.ts';
import { enterDialog, hideSurface as exitSurface, showSurface, type FloatingSurface } from './surface-motion.ts';
import type { RecorderUi, UploadDecision } from './types.ts';
import type { IssueUploadErrorDetails } from './upload.ts';
export * from './messages.ts';
export { createRecorderFormat, formatDuration, type RecorderFormat } from './format.ts';
export type { CompletionAction, CompletionContext, CompletionOptions, DefaultUiOptions, RecorderTheme } from './default-ui-types.ts';
/**
 * The built-in, framework-free UI: a consent dialog, a recording pill with a
 * Stop button, a review dialog and a result toast. It lives in a shadow root
 * marked `data-recorder-ui`, which the recorder never captures.
 */
export function createDefaultUi(
  options: DefaultUiOptions = {},
): RecorderUi & Required<Pick<RecorderUi, 'chooseOptions' | 'showUploading' | 'showResult' | 'dismiss'>> {
  const messages = resolveRecorderMessages(options.messages);
  const format = createRecorderFormat(options.locale, options.format);
  const mode = options.privacyMode ?? 'masked';
  const zIndex = String(options.zIndex ?? 2_147_483_000);
  const mount = () => {
    const host = document.createElement('div');
    host.setAttribute('data-recorder-ui', '');
    host.style.position = 'relative';
    const theme: RecorderTheme | undefined =
      typeof options.theme === 'object' ? options.theme : options.theme ? RECORDER_THEME_PRESETS[options.theme] : undefined;
    for (const [key, value] of Object.entries(theme ?? {})) host.style.setProperty(`--recorder-${key}`, value);
    host.style.zIndex = zIndex;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = DEFAULT_UI_STYLES;
    root.append(style);
    (options.container?.() ?? document.body).append(host);
    return { host, root, remove: () => host.remove() };
  };
  let floating: FloatingSurface | undefined;
  let renderCleanup: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  const clearContent = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    renderCleanup?.();
    renderCleanup = undefined;
  };
  const dismiss = () => {
    generation++;
    clearContent();
    if (floating) {
      cleanupText(floating.label);
      floating.root.querySelectorAll<HTMLElement>('.time').forEach(cleanupText);
    }
    if (floating) exitSurface(floating.shell, floating.remove);
    floating = undefined;
  };
  const surface = (phase: string, announcement: string) => {
    generation++;
    clearContent();
    if (!floating || !floating.host.isConnected) {
      const mounted = mount();
      const live = element('span', { className: 'sr-only' });
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      const content = element('div', { className: 'surface-content' });
      const shell = element('div', { className: 'pill', tabIndex: -1 }, [content]);
      mounted.root.append(shell, live);
      floating = {
        ...mounted,
        shell,
        content,
        live,
        label: element('span', { className: 'message' }),
      };
    }
    const focused = floating.root.activeElement;
    const keepFocus = focused instanceof HTMLElement && floating.shell.contains(focused);
    showSurface(floating.shell);
    floating.shell.setAttribute('aria-label', messages.recording);
    floating.shell.dataset.phase = phase;
    delete floating.shell.dataset.custom;
    delete floating.shell.dataset.warning;
    delete floating.shell.dataset.tone;
    floating.content.querySelectorAll<HTMLElement>('.time').forEach(cleanupText);
    floating.content.replaceChildren();
    floating.live.textContent = announcement;
    if (keepFocus) floating.shell.focus();
    return floating;
  };
  const hideSurface = () => {
    if (floating) exitSurface(floating.shell);
    clearContent();
  };
  const dialog = <T>(
    build: (finish: (value: T) => void) => {
      title: string;
      body: Node[];
      focus: HTMLElement;
    },
    cancelValue: T,
    signal: AbortSignal | undefined,
  ) =>
    new Promise<T>((resolve) => {
      if (signal?.aborted) {
        resolve(cancelValue);
        return;
      }
      const { root, remove } = mount();
      const previous = focusReturn();
      const trap = { release: () => {} };
      let done = false;
      const onAbort = () => finish(cancelValue);
      const finish = (value: T) => {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', onAbort);
        trap.release();
        remove();
        previous.restore();
        resolve(value);
      };
      // why: discard() or destroy() may close the dialog while it is open.
      signal?.addEventListener('abort', onAbort, { once: true });
      const { title, body, focus } = build(finish);
      const heading = element('h2', { id: 'recorder-title' }, [title]);
      const box = element('div', { className: 'dialog' }, [heading, ...body]);
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-labelledby', 'recorder-title');
      box.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') finish(cancelValue);
      });
      const backdrop = element('div', { className: 'backdrop' }, [box]);
      root.append(backdrop);
      enterDialog(backdrop, box);
      trap.release = trapFocus(box);
      focus.focus();
    });
  return {
    requestConsent: ({ maxDurationMs, signal, privacy }) =>
      dialog<boolean>(
        (finish) => {
          const accept = element(
            'button',
            {
              type: 'button',
              className: 'primary',
              onclick: () => finish(true),
            },
            [messages.consentAccept],
          );
          accept.dataset.recorderAction = 'consent-accept';
          const decline = element('button', { type: 'button', onclick: () => finish(false) }, [messages.consentDecline]);
          decline.dataset.recorderAction = 'consent-decline';
          return {
            title: messages.consentTitle,
            body: [
              element('p', {}, [
                messages.consentBody({
                  minutes: Math.max(1, Math.round(maxDurationMs / 60_000)),
                  maxDurationMs,
                  limit: format.duration(maxDurationMs),
                }),
              ]),
              element('p', { className: 'notice' }, [
                icon('shield'),
                element('span', {}, [messages.consentPrivacy(privacy ? { mode, privacy } : { mode })]),
              ]),
              element('div', { className: 'actions' }, [decline, accept]),
            ],
            // why: declining is the safe default for an accidental Enter.
            focus: decline,
          };
        },
        false,
        signal,
      ),
    dismiss,
    // why: a separate chunk, so hosts without `choices` (every customer page) never download the options step.
    chooseOptions: async (context) =>
      (await import('./default-ui-options.ts')).chooseOptions(context, {
        messages,
        dom: { element, icon },
        surface,
        hide: hideSurface,
        onCleanup: (cleanup) => (renderCleanup = cleanup),
      }),
    showIndicator: ({ startedAt, maxDurationMs, stop, attestStop }) => {
      const { content, label } = surface('recording', messages.recording);
      label.className = 'message recording-label';
      updateText(label, messages.recording);
      const time = element('span', { className: 'time' });
      updateText(time, format.elapsed(Date.now() - startedAt));
      const dot = element('span', { className: 'dot' });
      dot.setAttribute('aria-hidden', 'true');
      const square = element('span', { className: 'stop-icon' });
      square.setAttribute('aria-hidden', 'true');
      const stopButton = element(
        'button',
        { type: 'button', className: 'icon-button finish-button', title: messages.stop, onclick: stop },
        [square],
      );
      stopButton.setAttribute('aria-label', messages.stop);
      stopButton.dataset.recorderAction = 'stop';
      content.append(dot, label, time, stopButton);
      renderCleanup = startRecordingPulse(dot);
      const releaseStop = attestStop?.(stopButton);
      let warning = 'none';
      const tick = (announce: boolean) => {
        const remaining = maxDurationMs - (Date.now() - startedAt);
        const next = remaining <= 10000 ? 'final' : remaining <= 30000 ? 'soon' : 'none';
        if (floating) floating.shell.dataset.warning = next;
        if (!announce) return;
        if (next !== warning && next !== 'none' && floating)
          floating.live.textContent = next === 'final' ? messages.warningFinal({ seconds: 10 }) : messages.warningSoon({ seconds: 30 });
        warning = next;
      };
      tick(false);
      timer = setInterval(() => {
        updateText(time, format.elapsed(Date.now() - startedAt));
        tick(true);
      }, 1000);
      return () => {
        releaseStop?.();
        hideSurface();
      };
    },
    confirmUpload: ({ summary, privacy, signal }) =>
      dialog<UploadDecision>(
        (finish) => {
          const note = element('textarea', {
            id: 'recorder-note',
            maxLength: 2_000,
          });
          note.dataset.recorderField = 'note';
          const send = element(
            'button',
            {
              type: 'button',
              className: 'primary',
              onclick: () => finish({ confirmed: true, note: note.value }),
            },
            [messages.send],
          );
          send.dataset.recorderAction = 'send';
          const discard = element('button', { type: 'button', onclick: () => finish({ confirmed: false }) }, [messages.discard]);
          discard.dataset.recorderAction = 'discard';
          return {
            title: messages.reviewTitle,
            body: [
              element('p', {}, [
                messages.reviewBody({
                  summary,
                  duration: format.duration(summary.durationMs),
                  size: format.bytes(summary.approxBytes),
                }),
              ]),
              ...(privacy
                ? [element('p', { className: 'notice' }, [icon('shield'), element('span', {}, [messages.reviewPrivacy({ privacy })])])]
                : []),
              element('label', { htmlFor: 'recorder-note' }, [messages.noteLabel]),
              note,
              element('div', { className: 'actions' }, [discard, send]),
            ],
            focus: note,
          };
        },
        { confirmed: false },
        signal,
      ),
    showUploading: () => {
      const { content, label } = surface('uploading', messages.uploading);
      label.className = 'message';
      updateText(label, messages.uploading);
      const activity = createUploadActivity(messages.uploading);
      renderCleanup = activity.stop;
      content.append(label, activity.node);
      return hideSurface;
    },
    showResult: (result) => {
      const receipt = result.status === 'uploaded' ? result.receipt : undefined;
      const completion = options.completion;
      const error = result.status === 'error' ? (result.error as Error & IssueUploadErrorDetails) : undefined;
      const resolveValue = (value: ReceiptValue) =>
        typeof value === 'function' && receipt ? value(receipt) : typeof value === 'string' ? value : '';
      const failedText = () =>
        result.status === 'error' && error ? (error.userMessage ?? messages.failed({ error, canRetry: Boolean(result.retry) })) : '';
      const text = receipt
        ? completion?.message !== undefined
          ? resolveValue(completion.message)
          : messages.sent({ reference: receipt.reference ?? receipt.replayId, receipt })
        : failedText();
      const current = surface(receipt ? 'complete' : 'error', text);
      const ownGeneration = generation;
      const feedback = element('span', { className: 'sr-only' });
      const resting = new Map<HTMLElement, { label: string; timer?: ReturnType<typeof setTimeout> }>();
      const announce = (message: string, control?: HTMLElement) => {
        if (generation !== ownGeneration) return;
        const target = control ?? feedback;
        if (!control) target.className = 'copy-feedback';
        const rest = resting.get(target) ?? { label: target.textContent ?? '' };
        clearTimeout(rest.timer);
        // why: a control reads as an action again once its confirmation has been seen.
        if (control) rest.timer = setTimeout(() => generation === ownGeneration && (target.textContent = rest.label), 2000);
        resting.set(target, rest);
        target.textContent = message;
        current.live.textContent = message;
      };
      const copy = async (value?: string, control?: HTMLElement) => {
        try {
          await navigator.clipboard.writeText(value ?? receipt?.url ?? receipt?.reference ?? receipt?.replayId ?? '');
          announce(messages.copied, control);
        } catch {
          announce(messages.copyFailed, control);
        }
      };
      const context: CompletionContext = {
        result: receipt ?? { replayId: '' },
        copy,
        dismiss,
        retry: result.status === 'error' ? (result.retry ?? (() => {})) : () => {},
      };
      const controls = element('div', { className: 'surface-controls' });
      if (receipt && completion?.render) {
        current.shell.dataset.custom = 'true';
        const cleanup = completion.render(current.content, context);
        if (typeof cleanup === 'function') renderCleanup = cleanup;
      } else {
        current.label.className = 'message';
        updateText(current.label, text);
        const restingIcon = icon(receipt ? 'check' : error?.notice ? 'lock' : 'alert', 'status-icon');
        if (error?.notice) current.shell.dataset.tone = 'notice';
        let spinner: ReturnType<typeof createStatusSpinner> | undefined;
        current.content.append(restingIcon, current.label);
        if (receipt) {
          const href = receipt.url ? safeHref(receipt.url) : undefined;
          appendCompletionControls(controls, completion?.actions, { resolveValue, copy, context, href, messages });
        } else {
          if (error?.action && result.status === 'error')
            const stopRecovery = uploadRecovery(controls, error.action, result.retry, {
              failure: (message) => {
                updateText(current.label, message);
                current.live.textContent = message;
              },
              pendingStart: (message) => {
                spinner = createStatusSpinner();
                restingIcon.replaceWith(spinner.node);
                updateText(current.label, message);
                current.live.textContent = message;
              },
              pendingEnd: () => {
                spinner?.node.replaceWith(restingIcon);
                spinner?.stop();
                spinner = undefined;
              },
            });
            renderCleanup = () => {
              stopRecovery();
              spinner?.stop();
              spinner = undefined;
            };
          if (error?.link) {
            const control = link(error.link.label, error.link.url);
            if (control) controls.append(control);
          }
          if (result.status === 'error' && result.retry && !error?.action?.replacesRetry) {
            const retry = element('button', { type: 'button', className: 'primary', onclick: result.retry }, [messages.retry]);
            retry.dataset.recorderAction = 'retry';
            controls.append(retry);
          }
        }
        current.content.append(feedback);
      }
      const close = element('button', { type: 'button', className: 'icon-button', title: messages.close, onclick: dismiss }, [
        icon('close'),
      ]);
      close.dataset.recorderAction = 'dismiss';
      close.setAttribute('aria-label', messages.close);
      controls.append(close);
      current.content.append(controls);
    },
  };
}
