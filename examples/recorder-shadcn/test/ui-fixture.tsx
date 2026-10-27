import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RecorderProvider } from '@hazem3500/replays/recorder/react';
import { createDeferredUi } from '@hazem3500/replays/recorder';
import type { Recorder, RecorderState, RecorderUi } from '@hazem3500/replays/recorder';
import { RecorderUi as ReferenceUi } from '../src/RecorderUi.tsx';

function actNow<T>(run: () => T): T {
  let result!: T;
  act(() => {
    result = run();
  });
  return result;
}
export function referenceFactory(): RecorderUi {
  const deferred = createDeferredUi();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const listeners = new Set<(state: RecorderState) => void>();
  let state: RecorderState = { status: 'idle' };
  let indicator: Parameters<RecorderUi['showIndicator']>[0] | undefined;
  let retry: (() => void) | undefined;
  let disposed = false;
  const set = (next: RecorderState) =>
    actNow(() => {
      state = next;
      for (const fn of listeners) fn(next);
    });
  const recorder: Recorder = {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    respond: (decision) => {
      actNow(() => deferred.ui.respond!(decision));
    },
    request: async () => undefined,
    start: async () => {},
    stop() {
      indicator?.stop();
      return undefined;
    },
    upload: async () => ({ replayId: 'test' }),
    retryUpload: async () => {
      retry?.();
      return { replayId: 'test' };
    },
    attestStop(element) {
      return indicator?.attestStop?.(element) ?? (() => {});
    },
    getProgress: () => undefined,
    setReportContext() {},
    discard() {
      ui.dismiss?.();
    },
    destroy() {
      ui.dismiss?.();
    },
  };
  const ui: RecorderUi = {
    requestConsent(context) {
      set({ status: 'consent', trigger: context.trigger });
      return actNow(() => deferred.ui.requestConsent(context));
    },
    showIndicator(context) {
      indicator = context;
      set({ status: 'recording', trigger: { source: 'user' }, startedAt: context.startedAt, maxDurationMs: context.maxDurationMs });
      const hide = actNow(() => deferred.ui.showIndicator(context));
      return () => {
        actNow(hide);
        set({ status: 'idle' });
      };
    },
    confirmUpload(context) {
      set({ status: 'review', summary: context.summary });
      return actNow(() => deferred.ui.confirmUpload(context));
    },
    showResult(result) {
      if (result.status === 'uploaded') set({ status: 'uploaded', receipt: result.receipt });
      else {
        retry = result.retry;
        set({ status: 'error', phase: 'upload', error: result.error });
      }
    },
    dismiss() {
      if (!disposed) {
        disposed = true;
        actNow(() => {
          deferred.ui.dismiss?.();
          root.unmount();
        });
        container.remove();
      }
    },
  };
  actNow(() =>
    root.render(
      <RecorderProvider recorder={recorder} deferred={deferred}>
        <ReferenceUi />
      </RecorderProvider>,
    ),
  );
  return ui;
}
