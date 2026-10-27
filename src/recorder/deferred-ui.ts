import type { RecorderDecision, RecorderUi } from './types.ts';

export type PendingPrompt =
  | ({ kind: 'consent' } & Parameters<RecorderUi['requestConsent']>[0])
  | ({ kind: 'review' } & Parameters<RecorderUi['confirmUpload']>[0])
  | ({ kind: 'indicator' } & Parameters<RecorderUi['showIndicator']>[0]);

function subscribe(listeners: Set<() => void>, fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function createDeferredUi() {
  let current: PendingPrompt | undefined;
  let respond: ((decision: RecorderDecision) => void) | undefined;
  let cancel: (() => void) | undefined;
  const listeners = new Set<() => void>();
  function set(prompt?: PendingPrompt): void {
    current = prompt;
    for (const fn of listeners) fn();
  }
  const ui: RecorderUi = {
    requestConsent(context) {
      cancel?.();
      return new Promise((resolve) => {
        const finish = (accepted: boolean) => {
          context.signal.removeEventListener('abort', abort);
          cancel = undefined;
          respond = undefined;
          set();
          resolve(accepted);
        };
        const abort = () => finish(false);
        cancel = abort;
        respond = (decision) => {
          if ('consent' in decision) finish(decision.consent);
        };
        if (context.signal.aborted) abort();
        else {
          context.signal.addEventListener('abort', abort, { once: true });
          set({ kind: 'consent', ...context });
        }
      });
    },
    confirmUpload(context) {
      cancel?.();
      return new Promise((resolve) => {
        const finish = (decision: RecorderDecision) => {
          if (!('upload' in decision)) return;
          context.signal.removeEventListener('abort', abort);
          cancel = undefined;
          respond = undefined;
          set();
          resolve(
            decision.upload ? { confirmed: true, ...(decision.note !== undefined ? { note: decision.note } : {}) } : { confirmed: false },
          );
        };
        const abort = () => finish({ upload: false });
        cancel = abort;
        respond = finish;
        if (context.signal.aborted) abort();
        else {
          context.signal.addEventListener('abort', abort, { once: true });
          set({ kind: 'review', ...context });
        }
      });
    },
    showIndicator(context) {
      set({ kind: 'indicator', ...context });
      return () => {
        if (current?.kind === 'indicator') set();
      };
    },
    respond(decision) {
      respond?.(decision);
    },
    dismiss() {
      cancel?.();
      set();
    },
  };
  return {
    ui,
    pending: {
      get: () => current,
      subscribe: (fn: () => void) => subscribe(listeners, fn),
    },
  };
}
