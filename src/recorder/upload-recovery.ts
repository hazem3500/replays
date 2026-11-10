import { element } from './default-ui-dom.ts';
import type { IssueUploadErrorDetails } from './upload.ts';

type RecoveryAction = NonNullable<IssueUploadErrorDetails['action']>;

/** Only explicitly localized host guidance is safe to display. */
function guidanceOf(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'userMessage' in error && typeof error.userMessage === 'string'
    ? error.userMessage
    : undefined;
}

/** Mounts a host recovery action whose lifetime is limited to the current result. */
export function uploadRecovery(
  controls: HTMLElement,
  action: RecoveryAction,
  retry: (() => void) | undefined,
  ui: { failure: (message: string) => void; pendingStart?: (message: string) => void; pendingEnd?: () => void },
) {
  const controller = new AbortController();
  let running = false;
  let failed = false;
  let completed = false;
  const button = element('button', { type: 'button', onclick: () => void click() }, [action.label]);
  const rest = () => {
    running = false;
    if (controller.signal.aborted || completed) return;
    button.disabled = false;
    button.textContent = failed ? (action.failedLabel ?? action.label) : action.label;
  };
  const fail = (error: unknown) => {
    failed = true;
    ui.pendingEnd?.();
    const guidance = guidanceOf(error);
    if (guidance) ui.failure(guidance);
  };
  async function click() {
    if (running || completed || controller.signal.aborted) return;
    running = true;
    button.disabled = true;
    button.textContent = action.pendingLabel ?? action.label;
    if (action.pendingMessage) ui.pendingStart?.(action.pendingMessage);
    try {
      await action.run({ signal: controller.signal });
      if (controller.signal.aborted) return;
      completed = true;
      retry?.();
    } catch (error) {
      if (!controller.signal.aborted) fail(error);
    } finally {
      rest();
    }
  }
  button.dataset.recorderAction = 'recover';
  controls.append(button);
  return () => controller.abort();
}
