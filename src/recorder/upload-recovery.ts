import { element } from './default-ui-dom.ts';
import type { IssueUploadErrorDetails } from './upload.ts';

/** Mounts a host recovery action whose lifetime is limited to the current result. */
export function uploadRecovery(
  controls: HTMLElement,
  action: NonNullable<IssueUploadErrorDetails['action']>,
  retry: (() => void) | undefined,
  failure: (message: string) => void,
) {
  const controller = new AbortController();
  let pending = false;
  let completed = false;
  const button = element(
    'button',
    {
      type: 'button',
      onclick: async () => {
        if (pending || completed || controller.signal.aborted) return;
        pending = true;
        button.disabled = true;
        button.textContent = action.pendingLabel ?? action.label;
        try {
          await action.run({ signal: controller.signal });
          if (!controller.signal.aborted) {
            completed = true;
            retry?.();
          }
        } catch (error) {
          // why: only explicitly localized host guidance is safe to display.
          if (
            !controller.signal.aborted &&
            error &&
            typeof error === 'object' &&
            'userMessage' in error &&
            typeof error.userMessage === 'string'
          )
            failure(error.userMessage);
        } finally {
          pending = false;
          if (!controller.signal.aborted && !completed) {
            button.disabled = false;
            button.textContent = action.label;
          }
        }
      },
    },
    [action.label],
  );
  button.dataset.recorderAction = 'recover';
  controls.append(button);
  return () => controller.abort();
}
