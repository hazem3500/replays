import { updateText, cleanupText } from './text-motion.ts';
import type { RecorderUi, UploadDecision } from './types.ts';
import type { IssueReportReceipt, IssueUploadErrorDetails } from './upload.ts';

import { DEFAULT_MESSAGES, type RecorderMessages } from './messages.ts';
import { formatDuration } from './format.ts';
import { focusReturn, trapFocus } from './kit/index.ts';
export { DEFAULT_MESSAGES, type RecorderMessages, formatDuration };

/** CSS colors/fonts/radii. Omitted values inherit Replays host tokens. */
export type RecorderTheme = Partial<
  Record<
    | 'background'
    | 'foreground'
    | 'secondary'
    | 'border'
    | 'borderStrong'
    | 'hover'
    | 'pressed'
    | 'primary'
    | 'primaryForeground'
    | 'danger'
    | 'font'
    | 'radius',
    string
  >
>;
export type CompletionContext = {
  result: IssueReportReceipt;
  copy(value?: string): Promise<void>;
  retry(): void;
  dismiss(): void;
};
type ActionBase = { id: string; label: string; primary?: boolean };
type ReceiptValue = string | ((result: IssueReportReceipt) => string);
export type CompletionAction = ActionBase &
  (
    | { kind: 'copy'; value?: ReceiptValue }
    | { kind: 'link'; href: ReceiptValue }
    | { kind: 'custom'; onAction(context: CompletionContext): void | Promise<void> }
  );
export type CompletionOptions = {
  message?: ReceiptValue;
  /** Explicit [] produces a message-only completion. */
  actions?: readonly CompletionAction[];
  /** Own the completion body; return a cleanup for subscriptions/listeners. */
  render?: (container: HTMLElement, context: CompletionContext) => void | (() => void);
};
export type DefaultUiOptions = {
  messages?: Partial<RecorderMessages>;
  theme?: 'dark' | 'light' | RecorderTheme;
  /** Must reflect capture policy when the host supplies its own UI. */
  privacyMode?: 'masked' | 'visible';
  completion?: CompletionOptions;
  /** Where the UI is mounted. Default `document.body`. */
  container?: () => HTMLElement;
  /** `z-index` of the overlay. Default `2147483000`. */
  zIndex?: number;
};

const STYLES = `
:host { all: initial; --r-bg: var(--recorder-background, var(--surface-raised, var(--background, #1a1e26))); --r-fg: var(--recorder-foreground, var(--text, var(--foreground, #eef0f5))); --r-secondary: var(--recorder-secondary, var(--text-secondary, #b2b8c5)); --r-border: var(--recorder-border, var(--line, var(--border, #262b35))); --r-strong: var(--recorder-borderStrong, var(--line-strong, #3a4150)); --r-hover: var(--recorder-hover, var(--surface-hover, #232832)); --r-pressed: var(--recorder-pressed, var(--surface-pressed, #2c323d)); --r-primary: var(--recorder-primary, var(--accent, var(--primary, #8b9dff))); --r-primary-fg: var(--recorder-primaryForeground, #10131b); }
* { box-sizing: border-box; font-family: var(--recorder-font, var(--sans, Inter, ui-sans-serif, system-ui, sans-serif)); }
.backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / .4); display: flex; align-items: center; justify-content: center; padding: 16px; }
.dialog, .pill { background: var(--r-bg); color: var(--r-fg); border: 1px solid var(--r-border); box-shadow: 0 4px 16px rgb(0 0 0 / .12); font-size: 13px; font-weight: 500; line-height: 20px; }
.dialog { width: min(420px, 100%); border-radius: var(--recorder-radius, var(--radius, 6px)); padding: 24px; }
h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; line-height: 24px; }
p { margin: 0 0 8px; color: var(--r-secondary); }
label { display: block; margin: 16px 0 4px; color: var(--r-secondary); }
textarea { width: 100%; min-height: 80px; resize: vertical; font: inherit; padding: 8px; background: var(--r-bg); color: var(--r-fg); border: 1px solid var(--r-strong); border-radius: var(--recorder-radius, var(--radius, 6px)); }
.actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
button, a { font: inherit; }
button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; min-height: 32px; font-weight: 600; white-space: nowrap; padding: 5px 12px; border-radius: var(--recorder-radius, var(--radius, 6px)); border: 1px solid var(--r-strong); background: var(--r-bg); color: var(--r-fg); cursor: pointer; }
button:hover { background: var(--r-hover); }
button:active { background: var(--r-pressed); }
button.primary { background: var(--r-primary); border-color: transparent; color: var(--r-primary-fg); }
button:focus-visible, textarea:focus-visible, a:focus-visible { outline: 2px solid var(--r-primary); outline-offset: 2px; }
.pill { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; inline-size: max-content; max-inline-size: calc(100vw - 32px); min-block-size: 38px; padding: 4px 6px 4px 12px; border-radius: 20px; box-shadow: 0 2px 8px rgb(0 0 0 / .08); }
.pill[hidden] { display: none; }
.pill[data-custom=true] { inline-size: min(440px, calc(100vw - 32px)); border-radius: var(--recorder-radius, var(--radius, 6px)); }
.surface-content { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; flex-wrap: wrap; }
.surface-content > .message { flex: 0 0 auto; max-inline-size: 100%; overflow-wrap: break-word; }
.surface-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-inline-start: auto; }
.recording-label { white-space: nowrap; }
.dot { flex: 0 0 6px; height: 6px; border-radius: 50%; background: var(--recorder-danger, #e06c75); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.time { display: inline-block; flex: 0 0 5ch; width: 5ch; text-align: right; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
.pill button { min-height: 28px; padding: 2px 5px; border: 0; border-radius: 12px; background: transparent; color: var(--r-secondary); }
.pill button:hover { background: var(--r-hover); color: var(--r-fg); }
.pill .icon-button { width: 28px; padding: 0; }
.pill button.primary { color: var(--r-primary); }
.stop-icon { width: 8px; height: 8px; flex-shrink: 0; border-radius: 2px; background: currentColor; }
.pill a { color: var(--r-primary); text-decoration: none; white-space: nowrap; }
.pill a:hover { text-decoration: underline; }
@media (pointer: coarse) { button, .pill button { min-height: 44px; } .pill .icon-button { width: 44px; } }
@media (prefers-reduced-motion: no-preference) { .pill { transition: inline-size 180ms ease, border-radius 180ms ease, background-color 180ms ease; } .surface-content { animation: reveal 140ms ease; } .dot { animation: pulse 1.6s ease-in-out infinite; } }
@keyframes reveal { from { opacity: .4; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
@keyframes pulse { 50% { opacity: .35; } }
`;

function format(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/**
 * The built-in, framework-free UI: a consent dialog, a recording pill with a
 * Stop button, a review dialog and a result toast. It lives in a shadow root
 * marked `data-recorder-ui`, which the recorder never captures.
 */
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
};

const safeHref = (value: string): string | undefined => {
  try {
    const url = new URL(value, document.baseURI);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const link = (label: string, href: string) => {
  const safe = safeHref(href);
  return safe ? element('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, [label]) : undefined;
};

export function createDefaultUi(options: DefaultUiOptions = {}): RecorderUi {
  const messages = {
    ...DEFAULT_MESSAGES,
    ...(options.privacyMode === 'visible'
      ? {
          consentPrivacy:
            'Visible page content and ordinary typed values will be recorded. Passwords and hidden fields stay masked. Nothing is sent until you review it.',
        }
      : {}),
    ...options.messages,
  };
  const zIndex = String(options.zIndex ?? 2_147_483_000);

  const mount = () => {
    const host = document.createElement('div');
    host.setAttribute('data-recorder-ui', '');
    host.style.position = 'relative';
    const theme: RecorderTheme | undefined =
      typeof options.theme === 'object'
        ? options.theme
        : options.theme === 'light'
          ? {
              background: '#ffffff',
              foreground: '#181b22',
              secondary: '#434a59',
              border: '#dde0e7',
              borderStrong: '#c1c6d1',
              hover: '#eceef3',
              pressed: '#e3e6ed',
              primary: '#3d4fd1',
              primaryForeground: '#ffffff',
            }
          : options.theme === 'dark'
            ? {
                background: '#1a1e26',
                foreground: '#eef0f5',
                secondary: '#b2b8c5',
                border: '#262b35',
                borderStrong: '#3a4150',
                hover: '#232832',
                pressed: '#2c323d',
                primary: '#8b9dff',
                primaryForeground: '#10131b',
              }
            : undefined;
    for (const [key, value] of Object.entries(theme ?? {})) host.style.setProperty(`--recorder-${key}`, value);
    host.style.zIndex = zIndex;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    root.append(style);
    (options.container?.() ?? document.body).append(host);
    return { host, root, remove: () => host.remove() };
  };

  let floating:
    | {
        host: HTMLElement;
        root: ShadowRoot;
        remove: () => void;
        shell: HTMLElement;
        content: HTMLElement;
        live: HTMLElement;
        label: HTMLElement;
      }
    | undefined;
  let renderCleanup: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let previousWidth = 0;
  let resizeAnimation: Animation | undefined;
  const settleSurface = () => {
    if (!floating) return;
    resizeAnimation?.cancel();
    const width = floating.shell.getBoundingClientRect().width;
    if (
      previousWidth &&
      width &&
      previousWidth !== width &&
      typeof floating.shell.animate === 'function' &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      resizeAnimation = floating.shell.animate([{ inlineSize: `${previousWidth}px` }, { inlineSize: `${width}px` }], {
        duration: 220,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }
    void resizeAnimation?.finished?.catch(() => {});
    previousWidth = width;
  };
  const clearContent = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    renderCleanup?.();
    renderCleanup = undefined;
  };
  const dismiss = () => {
    generation++;
    resizeAnimation?.cancel();
    previousWidth = 0;
    clearContent();
    if (floating) {
      cleanupText(floating.label);
      floating.root.querySelectorAll<HTMLElement>('.time').forEach(cleanupText);
    }
    floating?.remove();
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
      shell.setAttribute('aria-label', messages.recording);
      mounted.root.append(shell, live);
      floating = { ...mounted, shell, content, live, label: element('span', { className: 'message' }) };
    }
    const focused = floating.root.activeElement;
    const keepFocus = focused instanceof HTMLElement && floating.shell.contains(focused);
    floating.shell.hidden = false;
    floating.shell.dataset.phase = phase;
    delete floating.shell.dataset.custom;
    floating.content.querySelectorAll<HTMLElement>('.time').forEach(cleanupText);
    floating.content.replaceChildren();
    floating.live.textContent = announcement;
    if (keepFocus) floating.shell.focus();
    return floating;
  };
  const hideSurface = () => {
    if (floating) floating.shell.hidden = true;
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
      let releaseTrap: (() => void) | undefined;
      let done = false;
      const onAbort = () => finish(cancelValue);
      const finish = (value: T) => {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', onAbort);
        releaseTrap?.();
        remove();
        previous.restore();
        resolve(value);
      };
      // discard() or destroy() while the dialog is open.
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
      root.append(element('div', { className: 'backdrop' }, [box]));
      releaseTrap = trapFocus(box);
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
                format(messages.consentBody, {
                  minutes: String(Math.max(1, Math.round(maxDurationMs / 60_000))),
                }),
              ]),
              element('p', {}, [
                options.messages?.consentPrivacy ??
                  (privacy
                    ? `${privacy.captures.pageText ? 'Visible page text is recorded.' : 'Page text is masked.'} ${privacy.captures.inputs ? 'Ordinary inputs are recorded; passwords stay masked.' : 'Inputs are masked.'} ${privacy.captures.media ? 'Media may be recorded.' : 'Media is blocked.'} ${privacy.reviewRequired ? 'Review before sending.' : 'Sent when you stop.'}`
                    : messages.consentPrivacy),
              ]),
              element('div', { className: 'actions' }, [decline, accept]),
            ],
            // Declining is the safe default for an accidental Enter.
            focus: decline,
          };
        },
        false,
        signal,
      ),

    dismiss,
    showIndicator: ({ startedAt, maxDurationMs, stop, attestStop }) => {
      const { content, label } = surface('recording', messages.recording);
      label.className = 'message recording-label';
      updateText(label, messages.recording);
      const time = element('span', { className: 'time' });
      updateText(time, formatDuration(Date.now() - startedAt));
      const dot = element('span', { className: 'dot' });
      dot.setAttribute('aria-hidden', 'true');
      const icon = element('span', { className: 'stop-icon' });
      icon.setAttribute('aria-hidden', 'true');
      const stopButton = element('button', { type: 'button', className: 'icon-button', title: messages.stop, onclick: stop }, [
        icon,
        element('span', { className: 'sr-only' }, [messages.stop]),
      ]);
      stopButton.dataset.recorderAction = 'stop';
      content.append(dot, label, time, stopButton);
      const releaseStop = attestStop?.(stopButton);
      settleSurface();
      let warning = 'none';
      timer = setInterval(() => {
        updateText(time, formatDuration(Date.now() - startedAt));
        const remaining = maxDurationMs - (Date.now() - startedAt);
        const next = remaining <= 10000 ? 'final' : remaining <= 30000 ? 'soon' : 'none';
        if (next !== warning && next !== 'none' && floating)
          floating.live.textContent =
            next === 'final' ? (messages.warningFinal ?? '10 seconds left') : (messages.warningSoon ?? '30 seconds left');
        warning = next;
      }, 1000);
      return () => {
        releaseStop?.();
        hideSurface();
      };
    },

    confirmUpload: ({ summary, signal }) =>
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
                format(messages.reviewBody, {
                  duration: formatDuration(summary.durationMs),
                }),
              ]),
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
      content.append(label);
      settleSurface();
      return hideSurface;
    },

    showResult: (result) => {
      const receipt = result.status === 'uploaded' ? result.receipt : undefined;
      const completion = options.completion;
      const error = result.status === 'error' ? (result.error as Error & IssueUploadErrorDetails) : undefined;
      const resolveValue = (value: ReceiptValue) =>
        typeof value === 'function' && receipt ? value(receipt) : typeof value === 'string' ? value : '';
      const text = receipt
        ? completion?.message !== undefined
          ? resolveValue(completion.message)
          : format(messages.sent, { reference: receipt.reference ?? receipt.replayId })
        : (error?.userMessage ?? messages.failed);
      const current = surface(receipt ? 'complete' : 'error', text);
      const ownGeneration = generation;
      const feedback = element('span', { className: 'sr-only' });
      const copy = async (value?: string, control?: HTMLElement) => {
        try {
          await navigator.clipboard.writeText(value ?? receipt?.url ?? receipt?.reference ?? receipt?.replayId ?? '');
          if (generation === ownGeneration) {
            if (control) control.textContent = messages.copied ?? 'Copied';
            else {
              feedback.className = 'copy-feedback';
              feedback.textContent = messages.copied ?? 'Copied';
            }
            current.live.textContent = messages.copied ?? 'Copied';
          }
        } catch {
          if (generation === ownGeneration) {
            if (control) control.textContent = messages.copyFailed ?? 'Could not copy';
            else {
              feedback.className = 'copy-feedback';
              feedback.textContent = messages.copyFailed ?? 'Could not copy';
            }
            current.live.textContent = messages.copyFailed ?? 'Could not copy';
          }
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
        current.content.append(current.label);
        if (receipt) {
          const actions: readonly CompletionAction[] =
            completion?.actions ??
            (receipt.url && safeHref(receipt.url)
              ? [{ id: 'copy-link', label: messages.copyLink ?? 'Copy link', kind: 'copy', value: safeHref(receipt.url)! }]
              : []);
          for (const action of actions) {
            let control: HTMLElement | undefined;
            if (action.kind === 'link') control = link(action.label, resolveValue(action.href));
            else
              control = element(
                'button',
                {
                  type: 'button',
                  className: action.primary ? 'primary' : '',
                  onclick: () => {
                    if (action.kind === 'copy') void copy(action.value === undefined ? undefined : resolveValue(action.value), control);
                    else void action.onAction(context);
                  },
                },
                [action.label],
              );
            if (control) {
              control.dataset.action = action.id;
              controls.append(control);
            }
          }
        } else {
          if (error?.link) {
            const control = link(error.link.label, error.link.url);
            if (control) controls.append(control);
          }
          if (result.status === 'error' && result.retry) {
            const retry = element('button', { type: 'button', onclick: result.retry }, [messages.retry]);
            retry.dataset.recorderAction = 'retry';
            controls.append(retry);
          }
        }
        current.content.append(feedback);
      }
      const close = element('button', { type: 'button', className: 'icon-button', title: messages.close, onclick: dismiss }, ['×']);
      close.dataset.recorderAction = 'dismiss';
      close.setAttribute('aria-label', messages.close);
      controls.append(close);
      current.content.append(controls);
      settleSurface();
    },
  };
}
